import assert from 'node:assert/strict';
import { constants } from 'node:fs';
import { access } from 'node:fs/promises';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import axe from 'axe-core';
import { chromium } from 'playwright-core';
import { build, preview } from 'vite';

const MODES = ['running', 'cycling'];
const MOBILE_WIDTHS = [375, 390, 768];
const VIEWPORT_HEIGHT = 900;
const MIN_TOUCH_TARGET_PX = 44;
const DEFAULT_TIMEOUT_MS = 30_000;

const EMPTY_MAP_STYLE = JSON.stringify({
  version: 8,
  name: 'Browser regression test',
  sources: {},
  layers: [],
});

let browser;
let origin;
let vite;

const chromeCandidates = () => {
  const programFiles = [
    process.env.PROGRAMFILES,
    process.env['PROGRAMFILES(X86)'],
    process.env.LOCALAPPDATA,
  ].filter(Boolean);

  return [
    process.env.BROWSER_BIN,
    process.env.CHROME_PATH,
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    ...programFiles.map((directory) =>
      join(directory, 'Google', 'Chrome', 'Application', 'chrome.exe')
    ),
  ].filter(Boolean);
};

const findChromeExecutable = async () => {
  for (const candidate of chromeCandidates()) {
    try {
      await access(candidate, constants.X_OK);
      return candidate;
    } catch {
      // Continue until an executable Chrome/Chromium installation is found.
    }
  }

  throw new Error(
    `Chrome/Chromium was not found. Set BROWSER_BIN to an executable path. Checked:\n${chromeCandidates().join('\n')}`
  );
};

const waitForAnimationFrames = (page) =>
  page.evaluate(
    () =>
      new Promise((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(resolve));
      })
  );

const createBrowserPage = async (width) => {
  const context = await browser.newContext({
    viewport: { width, height: VIEWPORT_HEIGHT },
    deviceScaleFactor: 1,
    hasTouch: true,
    isMobile: true,
  });

  // The map layout itself is under test, while the third-party tile service is
  // deliberately replaced with a valid empty style to keep CI deterministic.
  await context.route('https://basemaps.cartocdn.com/**', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: EMPTY_MAP_STYLE,
    })
  );
  await context.route('https://events.mapbox.com/**', (route) =>
    route.fulfill({ status: 204, body: '' })
  );
  await context.route('https://api.mapbox.com/map-sessions/**', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: '{}',
    })
  );
  await context.route('https://encrypted-tbn0.gstatic.com/**', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'image/svg+xml',
      body: '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect width="64" height="64" rx="32" fill="#1b365d"/></svg>',
    })
  );
  await context.route('https://image-cdn-ak.spotifycdn.com/**', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'image/svg+xml',
      body: '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect width="64" height="64" fill="#1b365d"/></svg>',
    })
  );
  await context.route('https://open.spotify.com/embed/**', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'text/html',
      body: '<!doctype html><html lang="zh-CN"><body>Spotify test embed</body></html>',
    })
  );

  const page = await context.newPage();
  page.setDefaultTimeout(DEFAULT_TIMEOUT_MS);
  page.setDefaultNavigationTimeout(DEFAULT_TIMEOUT_MS);

  const consoleErrors = [];
  const pageErrors = [];
  const requestUrls = [];

  page.on('console', (message) => {
    if (message.type() === 'error') {
      const sourceUrl = message.location().url;
      consoleErrors.push(
        `${message.text()}${sourceUrl ? ` (${sourceUrl})` : ''}`
      );
    }
  });
  page.on('pageerror', (error) => {
    pageErrors.push(error.stack ?? error.message);
  });
  page.on('request', (request) => {
    requestUrls.push(request.url());
  });

  return {
    context,
    page,
    requestUrls,
    clearRuntimeErrors() {
      consoleErrors.length = 0;
      pageErrors.length = 0;
    },
    assertNoRuntimeErrors() {
      assert.deepEqual(
        pageErrors,
        [],
        `Page errors:\n${pageErrors.join('\n')}`
      );
      assert.deepEqual(
        consoleErrors,
        [],
        `Console errors:\n${consoleErrors.join('\n')}`
      );
    },
  };
};

const openActivityPage = async (page, mode) => {
  const response = await page.goto(`${origin}/${mode}?year=2025&view=map`, {
    waitUntil: 'domcontentloaded',
  });

  assert.equal(response?.ok(), true, `Failed to load /${mode}`);
  await page
    .locator(`[data-app-ready="${mode}"]`)
    .waitFor({ state: 'visible' });
  await page
    .locator('#map-container canvas.mapboxgl-canvas')
    .waitFor({ state: 'visible' });
  await page
    .locator('tbody button[type="button"][aria-pressed]')
    .first()
    .waitFor({ state: 'visible' });
  await waitForAnimationFrames(page);
};

const auditViewport = (page) =>
  page.evaluate((minimumTouchTarget) => {
    const root = document.documentElement;
    const body = document.body;
    const mapContainer = document.querySelector('#map-container');
    if (!mapContainer) {
      throw new Error('#map-container was not rendered');
    }

    const interactiveSelector = [
      'a[href]',
      'button:not([disabled])',
      'input:not([disabled])',
      'select:not([disabled])',
      'textarea:not([disabled])',
      '[role="button"]',
      '[tabindex]:not([tabindex="-1"])',
    ].join(',');

    const undersizedTargets = [
      ...document.querySelectorAll(interactiveSelector),
    ]
      .filter((element) => {
        const style = getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        const rendered =
          style.display !== 'none' &&
          style.visibility !== 'hidden' &&
          Number(style.opacity) !== 0 &&
          rect.width > 0 &&
          rect.height > 0;
        const intersectsViewport =
          rect.bottom > 0 &&
          rect.right > 0 &&
          rect.top < window.innerHeight &&
          rect.left < window.innerWidth;
        return rendered && intersectsViewport;
      })
      .map((element) => {
        const rect = element.getBoundingClientRect();
        return {
          element:
            element.getAttribute('aria-label') ||
            element.textContent?.trim().replace(/\s+/g, ' ').slice(0, 80) ||
            element.tagName.toLowerCase(),
          height: Number(rect.height.toFixed(2)),
          width: Number(rect.width.toFixed(2)),
        };
      })
      .filter(
        ({ height, width }) =>
          height < minimumTouchTarget || width < minimumTouchTarget
      );

    const clippedText = [...document.body.querySelectorAll('*')]
      .filter((element) => {
        const rect = element.getBoundingClientRect();
        const style = getComputedStyle(element);
        const hasDirectText = [...element.childNodes].some(
          (node) =>
            node.nodeType === Node.TEXT_NODE &&
            Boolean(node.textContent?.trim())
        );
        const visible =
          style.display !== 'none' &&
          style.visibility !== 'hidden' &&
          Number(style.opacity) !== 0 &&
          rect.width > 2 &&
          rect.height > 2;
        const clipsOverflow =
          ['clip', 'hidden'].includes(style.overflowX) ||
          ['clip', 'hidden'].includes(style.overflowY) ||
          style.textOverflow === 'ellipsis' ||
          style.webkitLineClamp !== 'none';
        return (
          hasDirectText &&
          visible &&
          clipsOverflow &&
          (element.scrollWidth > element.clientWidth + 1 ||
            element.scrollHeight > element.clientHeight + 1)
        );
      })
      .map((element) => ({
        element:
          element.getAttribute('aria-label') ||
          element.textContent?.trim().replace(/\s+/g, ' ').slice(0, 80) ||
          element.tagName.toLowerCase(),
        clientHeight: element.clientHeight,
        clientWidth: element.clientWidth,
        scrollHeight: element.scrollHeight,
        scrollWidth: element.scrollWidth,
      }));

    return {
      bodyScrollWidth: body.scrollWidth,
      clippedText,
      documentClientWidth: root.clientWidth,
      documentScrollWidth: root.scrollWidth,
      mapTop: mapContainer.getBoundingClientRect().top,
      undersizedTargets,
      viewportWidth: window.innerWidth,
    };
  }, MIN_TOUCH_TARGET_PX);

const runAxeAudit = async (page) => {
  await page.addScriptTag({ content: axe.source });
  const results = await page.evaluate(async () =>
    window.axe.run(document, {
      resultTypes: ['violations'],
      runOnly: {
        type: 'tag',
        values: ['wcag2a', 'wcag2aa', 'wcag21aa'],
      },
    })
  );

  return results.violations.filter(
    (violation) =>
      violation.impact === 'critical' || violation.impact === 'serious'
  );
};

const ownActivityDataRequests = (requestUrls) =>
  requestUrls
    .map((url) => new URL(url))
    .filter(
      (url) =>
        url.origin === origin &&
        /^\/data\/(?:running|cycling)\//.test(url.pathname)
    );

before(async () => {
  const executablePath = await findChromeExecutable();

  await build({
    logLevel: 'silent',
  });
  vite = await preview({
    logLevel: 'silent',
    preview: {
      host: '127.0.0.1',
      port: 0,
      strictPort: false,
    },
  });

  const address = vite.httpServer?.address();
  assert.ok(address && typeof address !== 'string');
  origin = `http://127.0.0.1:${address.port}`;

  browser = await chromium.launch({
    executablePath,
    headless: true,
    args: [
      '--disable-dev-shm-usage',
      '--enable-unsafe-swiftshader',
      '--use-angle=swiftshader',
    ],
  });
});

after(async () => {
  await browser?.close();
  await vite?.close();
});

test(
  'activity pages satisfy responsive, accessibility, and data-isolation gates',
  { timeout: 180_000 },
  async (t) => {
    for (const mode of MODES) {
      for (const width of MOBILE_WIDTHS) {
        await t.test(`${mode} at ${width}px`, async () => {
          const session = await createBrowserPage(width);
          try {
            await openActivityPage(session.page, mode);

            const viewportAudit = await auditViewport(session.page);
            assert.ok(
              viewportAudit.documentScrollWidth <=
                viewportAudit.documentClientWidth + 1,
              `Document overflows at ${mode}/${width}: ${JSON.stringify(viewportAudit)}`
            );
            assert.ok(
              viewportAudit.bodyScrollWidth <= viewportAudit.viewportWidth + 1,
              `Body overflows at ${mode}/${width}: ${JSON.stringify(viewportAudit)}`
            );
            assert.ok(
              viewportAudit.mapTop < 650,
              `Map starts below 650px at ${mode}/${width}: ${viewportAudit.mapTop}px`
            );
            assert.deepEqual(
              viewportAudit.undersizedTargets,
              [],
              `Visible touch targets below ${MIN_TOUCH_TARGET_PX}px at ${mode}/${width}:\n${JSON.stringify(viewportAudit.undersizedTargets, null, 2)}`
            );
            assert.deepEqual(
              viewportAudit.clippedText,
              [],
              `Visible text is clipped at ${mode}/${width}:\n${JSON.stringify(viewportAudit.clippedText, null, 2)}`
            );

            const severeViolations = await runAxeAudit(session.page);
            assert.deepEqual(
              severeViolations,
              [],
              `Serious/critical axe violations at ${mode}/${width}:\n${severeViolations
                .map(
                  (violation) =>
                    `${violation.id} (${violation.impact}): ${violation.nodes
                      .flatMap((node) => node.target)
                      .join(', ')}`
                )
                .join('\n')}`
            );

            const dataRequests = ownActivityDataRequests(session.requestUrls);
            assert.ok(
              dataRequests.length >= 2,
              `Expected metadata and route requests for ${mode}, got: ${dataRequests
                .map(({ pathname }) => pathname)
                .join(', ')}`
            );
            assert.equal(
              dataRequests.every(({ pathname }) =>
                pathname.startsWith(`/data/${mode}/`)
              ),
              true,
              `/${mode} requested another mode's data: ${dataRequests
                .map(({ pathname }) => pathname)
                .join(', ')}`
            );

            const screenshot = await session.page.screenshot({ type: 'png' });
            assert.ok(
              screenshot.byteLength > 1_000,
              `Rendered screenshot for ${mode}/${width} was unexpectedly empty`
            );
            session.assertNoRuntimeErrors();
          } finally {
            await session.context.close();
          }
        });
      }
    }
  }
);

test(
  'mode switching is same-document, preserves route state, and supports history and keyboard',
  { timeout: 60_000 },
  async () => {
    const session = await createBrowserPage(390);
    try {
      await openActivityPage(session.page, 'running');
      const documentSentinel = await session.page.evaluate(() => {
        window.__activityDocumentSentinel = crypto.randomUUID();
        return window.__activityDocumentSentinel;
      });

      const assertSameDocument = async (message) =>
        assert.equal(
          await session.page.evaluate(() => window.__activityDocumentSentinel),
          documentSentinel,
          message
        );

      const waitForMode = async (mode) => {
        await session.page
          .locator(`[data-app-ready="${mode}"]`)
          .waitFor({ state: 'visible' });
      };

      const assertRouteState = async (mode) => {
        await session.page.waitForURL(
          (url) =>
            url.pathname === `/${mode}` &&
            url.searchParams.get('year') === '2025' &&
            url.searchParams.get('view') === 'map'
        );
        await waitForMode(mode);
      };

      const cyclingLink = session.page
        .locator('nav[aria-label="运动类型"] a')
        .filter({ hasText: '骑行' });

      const runningUrlBeforeModifiedClick = session.page.url();
      const modifiedClickMarkedPending = await cyclingLink.evaluate((link) => {
        window.addEventListener('click', (event) => event.preventDefault(), {
          once: true,
        });
        link.dispatchEvent(
          new MouseEvent('click', {
            bubbles: true,
            button: 0,
            cancelable: true,
            ctrlKey: true,
          })
        );
        return link.hasAttribute('data-mode-pending');
      });
      assert.equal(modifiedClickMarkedPending, false);
      assert.equal(session.page.url(), runningUrlBeforeModifiedClick);

      await cyclingLink.focus();
      await session.page.keyboard.press('Enter');
      await assertRouteState('cycling');
      await assertSameDocument(
        'Mode switch replaced the current document instead of using SPA navigation'
      );

      await session.page.goBack();
      await assertRouteState('running');
      await assertSameDocument(
        'Browser back navigation replaced the current document'
      );

      await session.page.goForward();
      await assertRouteState('cycling');
      await assertSameDocument(
        'Browser forward navigation replaced the current document'
      );

      await session.page.goBack();
      await assertRouteState('running');
      await assertSameDocument(
        'Second browser back navigation replaced the current document'
      );

      await session.page.evaluate(
        () =>
          new Promise((resolve) => {
            const cycling = [...document.querySelectorAll('a')].find(
              (link) =>
                link.closest('nav[aria-label="运动类型"]') &&
                link.textContent?.includes('骑行')
            );
            const summary = [...document.querySelectorAll('a')].find(
              (link) => link.textContent?.trim() === '趋势'
            );
            if (!(cycling instanceof HTMLAnchorElement) || !summary) {
              throw new Error('Mode switch or summary link is missing');
            }

            cycling.click();
            window.setTimeout(() => {
              summary.click();
              resolve();
            }, 0);
          })
      );
      await session.page.waitForURL(
        (url) => url.pathname === '/running/summary'
      );
      await session.page.waitForTimeout(100);
      assert.equal(
        new URL(session.page.url()).pathname,
        '/running/summary',
        'A stale mode-switch frame overwrote a newer navigation'
      );
      await session.page.goBack();
      await assertRouteState('cycling');
      await session.page.goBack();
      await assertRouteState('running');
      await assertSameDocument(
        'Rapid native navigations replaced the current document'
      );

      const sortButton = session.page
        .locator('thead button[aria-label^="按 "]')
        .first();
      await sortButton.focus();
      await session.page.keyboard.press('Enter');
      const sortedHeader = sortButton.locator('xpath=..');
      await assert.doesNotReject(async () => {
        await sortedHeader.waitFor({ state: 'visible' });
        assert.ok(await sortedHeader.getAttribute('aria-sort'));
      });

      await cyclingLink.focus();
      await cyclingLink.evaluate((link) => {
        window.__cachedModeSwitchFeedback = new Promise((resolve) => {
          const initialClassName = link.className;
          const initialBackground = getComputedStyle(link).backgroundColor;
          const styleProbe = document.createElement('span');
          styleProbe.style.backgroundColor = 'var(--color-primary)';
          styleProbe.style.color = 'var(--color-background)';
          document.body.append(styleProbe);
          const probeStyle = getComputedStyle(styleProbe);
          const expectedBackground = probeStyle.backgroundColor;
          const expectedColor = probeStyle.color;
          styleProbe.remove();
          let startedAt;
          const observer = new MutationObserver(() => {
            if (
              startedAt !== undefined &&
              (link.className !== initialClassName ||
                link.getAttribute('aria-current') === 'page' ||
                link.getAttribute('data-mode-pending') === 'true')
            ) {
              observer.disconnect();
              const pendingStyle = getComputedStyle(link);
              resolve({
                duration: performance.now() - startedAt,
                background: pendingStyle.backgroundColor,
                color: pendingStyle.color,
                initialBackground,
                expectedBackground,
                expectedColor,
              });
            }
          });
          observer.observe(link, {
            attributes: true,
            attributeFilter: ['aria-current', 'class', 'data-mode-pending'],
          });
          // Measure browser event-to-router feedback, excluding automation
          // scheduling before the key event reaches the document.
          link.addEventListener(
            'click',
            () => {
              startedAt = performance.now();
            },
            { capture: true, once: true }
          );
        });
      });
      await session.page.keyboard.press('Enter');
      const cachedSwitchFeedback = await session.page.evaluate(
        () => window.__cachedModeSwitchFeedback
      );
      assert.ok(
        cachedSwitchFeedback.duration < 200,
        `Cached mode feedback took ${cachedSwitchFeedback.duration.toFixed(1)}ms`
      );
      assert.equal(
        cachedSwitchFeedback.background,
        cachedSwitchFeedback.expectedBackground,
        'Pending mode feedback did not paint the active background'
      );
      assert.notEqual(
        cachedSwitchFeedback.background,
        cachedSwitchFeedback.initialBackground,
        'Pending mode feedback remained visually unchanged'
      );
      assert.equal(
        cachedSwitchFeedback.color,
        cachedSwitchFeedback.expectedColor,
        'Pending mode feedback did not paint the active text color'
      );
      await session.page
        .locator('[data-app-ready="cycling"]')
        .waitFor({ state: 'visible' });
      assert.equal(
        await cyclingLink.getAttribute('data-mode-pending'),
        null,
        'Mode feedback remained pending after the route committed'
      );

      await session.page.reload({ waitUntil: 'domcontentloaded' });
      await assertRouteState('cycling');
      assert.notEqual(
        await session.page.evaluate(() => window.__activityDocumentSentinel),
        documentSentinel,
        'A hard reload unexpectedly retained the previous document sentinel'
      );

      session.assertNoRuntimeErrors();
    } finally {
      await session.context.close();
    }
  }
);

test(
  'switching modes clears an incompatible activity hash and selected row state',
  { timeout: 60_000 },
  async () => {
    const session = await createBrowserPage(390);
    try {
      await openActivityPage(session.page, 'running');

      const firstActivity = session.page
        .locator('tbody button[type="button"][aria-pressed]')
        .first();
      await firstActivity.focus();
      await session.page.keyboard.press('Enter');
      await session.page.waitForFunction(() =>
        window.location.hash.startsWith('#run_')
      );
      await assert.doesNotReject(async () => {
        assert.equal(await firstActivity.getAttribute('aria-pressed'), 'true');
      });

      const cyclingLink = session.page
        .locator('nav[aria-label="运动类型"] a')
        .filter({ hasText: '骑行' });
      await cyclingLink.focus();
      await session.page.keyboard.press('Enter');
      await session.page.waitForURL((url) => url.pathname === '/cycling');
      await session.page
        .locator('[data-app-ready="cycling"]')
        .waitFor({ state: 'visible' });
      await session.page.waitForFunction(() => window.location.hash === '');
      await session.page.waitForFunction(
        () => !document.querySelector('tbody button[aria-pressed="true"]')
      );

      assert.equal(
        new URL(session.page.url()).searchParams.get('year'),
        '2025'
      );
      assert.equal(new URL(session.page.url()).searchParams.get('view'), 'map');
      assert.equal(
        await session.page.locator('tbody button[aria-pressed="true"]').count(),
        0,
        'The cycling table retained the running activity selection'
      );

      session.assertNoRuntimeErrors();
    } finally {
      await session.context.close();
    }
  }
);

test(
  'summary poster dialog opens by keyboard, closes on Escape, and restores focus',
  { timeout: 60_000 },
  async () => {
    const session = await createBrowserPage(390);
    try {
      const response = await session.page.goto(`${origin}/running/summary`, {
        waitUntil: 'domcontentloaded',
      });
      assert.equal(response?.ok(), true, 'Failed to load /running/summary');

      const intervalSelect = session.page.getByLabel('时间范围筛选');
      await intervalSelect.waitFor({ state: 'visible' });
      assert.equal(
        session.requestUrls.some((url) => url.includes('year_summary_')),
        false,
        'A year-summary poster loaded before the user requested it'
      );
      await intervalSelect.selectOption('life');

      const yearButton = session.page
        .getByRole('button', { name: /^\d{4}$/ })
        .first();
      await yearButton.focus();
      await session.page.keyboard.press('Enter');

      const opener = session.page.getByRole('button', {
        name: /查看 \d{4} 年运动总结大图/,
      });
      await opener.waitFor({ state: 'visible' });
      await opener.focus();
      await session.page.keyboard.press('Enter');

      const dialog = session.page.locator('[role="dialog"][aria-modal="true"]');
      await dialog.waitFor({ state: 'visible' });
      assert.equal(
        session.requestUrls.some((url) => url.includes('year_summary_')),
        true,
        'Opening the dialog did not request its lazy year-summary poster'
      );
      assert.match(
        await session.page.evaluate(() => document.activeElement?.ariaLabel),
        /^关闭 \d{4} 年运动总结$/
      );

      await session.page.keyboard.press('Escape');
      await dialog.waitFor({ state: 'detached' });
      assert.equal(
        await opener.evaluate((element) => document.activeElement === element),
        true,
        'Focus was not restored to the poster launcher'
      );

      session.assertNoRuntimeErrors();
    } finally {
      await session.context.close();
    }
  }
);

test(
  'a failed activity request shows a retry within two seconds and recovers',
  { timeout: 60_000 },
  async () => {
    const session = await createBrowserPage(390);
    let failedRequests = 0;
    try {
      await session.context.route(
        `${origin}/data/running/manifest.json`,
        async (route) => {
          if (failedRequests === 0) {
            failedRequests += 1;
            await route.fulfill({
              status: 503,
              contentType: 'application/json',
              body: '{"error":"temporary test failure"}',
            });
            return;
          }
          await route.continue();
        }
      );

      const response = await session.page.goto(`${origin}/running`, {
        waitUntil: 'domcontentloaded',
      });
      assert.equal(response?.ok(), true);

      const retry = session.page.getByRole('button', { name: '重新加载' });
      await retry.waitFor({ state: 'visible' });
      assert.ok(
        (await session.page.evaluate(() => performance.now())) < 2_000,
        'The recoverable error state appeared after the two-second budget'
      );
      await session.page.getByRole('alert').waitFor({ state: 'visible' });

      const retryBox = await retry.boundingBox();
      assert.ok(retryBox);
      assert.ok(retryBox.width >= 44 && retryBox.height >= 44);

      session.clearRuntimeErrors();
      await retry.click();
      await session.page
        .locator('[data-app-ready="running"]')
        .waitFor({ state: 'visible' });
      assert.equal(failedRequests, 1);
      session.assertNoRuntimeErrors();
    } finally {
      await session.context.close();
    }
  }
);
