import assert from 'node:assert/strict';
import { constants } from 'node:fs';
import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import axe from 'axe-core';
import { chromium } from 'playwright-core';
import { build, preview } from 'vite';

const MODES = ['running', 'cycling', 'hiking'];
const MOBILE_WIDTHS = [375, 390, 768];
const VIEWPORT_HEIGHT = 900;
const MIN_TOUCH_TARGET_PX = 44;
const DEFAULT_TIMEOUT_MS = 30_000;
const VISUAL_SAMPLE_WIDTH = 48;
const VISUAL_SAMPLE_HEIGHT = 72;
const VISUAL_MAX_MEAN_DELTA = 18;
const VISUAL_MAX_CHANGED_RATIO = 0.2;
const VISUAL_FIXED_TIME = Date.parse('2026-07-27T04:00:00.000Z');
const VISUAL_BASELINE_PATH = fileURLToPath(
  new URL('./visual-baselines.json', import.meta.url)
);
const UPDATE_VISUAL_BASELINES = process.env.UPDATE_VISUAL_BASELINES === '1';

const EMPTY_MAP_STYLE = JSON.stringify({
  version: 8,
  name: 'Browser regression test',
  sources: {},
  layers: [],
});

let browser;
let origin;
let vite;
let visualBaselines;
const pendingVisualBaselines = {};

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

const createBrowserPage = async (width, { forceNoWebGL = false } = {}) => {
  const isMobile = width <= 768;
  const context = await browser.newContext({
    viewport: { width, height: VIEWPORT_HEIGHT },
    deviceScaleFactor: 1,
    hasTouch: isMobile,
    isMobile,
    locale: 'zh-CN',
    timezoneId: 'Asia/Shanghai',
    colorScheme: 'light',
    reducedMotion: 'reduce',
  });

  await context.addInitScript(
    ({ fixedTime }) => {
      const NativeDate = Date;
      class FixedDate extends NativeDate {
        constructor(...arguments_) {
          super(...(arguments_.length === 0 ? [fixedTime] : arguments_));
        }

        static now() {
          return fixedTime;
        }
      }
      globalThis.Date = FixedDate;
    },
    { fixedTime: VISUAL_FIXED_TIME }
  );

  if (forceNoWebGL) {
    await context.addInitScript(() => {
      const nativeGetContext = HTMLCanvasElement.prototype.getContext;
      HTMLCanvasElement.prototype.getContext = function getContext(
        contextType,
        ...arguments_
      ) {
        if (
          contextType === 'webgl2' ||
          contextType === 'webgl' ||
          contextType === 'experimental-webgl'
        ) {
          return null;
        }
        return nativeGetContext.call(this, contextType, ...arguments_);
      };
    });
  }

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
    .locator('#map-container [data-map-renderer]')
    .waitFor({ state: 'visible' });
  await page
    .locator('tbody button[type="button"][aria-pressed]')
    .first()
    .waitFor({ state: 'visible' });
  await waitForAnimationFrames(page);
};

const waitForCityHeatmap = (page, expectedTitle) =>
  page.waitForFunction(
    (title) =>
      new URL(window.location.href).searchParams.get('year') === 'Total' &&
      window.location.hash === '' &&
      (
        document.querySelector('#map-container span[class*="runTitle"]')
          ?.textContent ?? ''
      ).trim() === title,
    expectedTitle,
    { timeout: 10_000 }
  );

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
        /^\/data\/(?:running|cycling|hiking)\//.test(url.pathname)
    );

const captureVisualSample = async (page) => {
  await page.evaluate(async () => {
    await document.fonts.ready;
    await Promise.all(
      [...document.images]
        .filter((image) => !image.complete)
        .map(
          (image) =>
            new Promise((resolve) => {
              image.addEventListener('load', resolve, { once: true });
              image.addEventListener('error', resolve, { once: true });
            })
        )
    );
  });
  await waitForAnimationFrames(page);

  const screenshot = await page.screenshot({
    type: 'png',
    animations: 'disabled',
    caret: 'hide',
    scale: 'css',
  });
  const sample = await page.evaluate(
    async ({ data, height, width }) => {
      const image = new Image();
      image.src = `data:image/png;base64,${data}`;
      await image.decode();

      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext('2d', { willReadFrequently: true });
      if (!context) throw new Error('Could not create visual diff canvas');
      context.imageSmoothingEnabled = true;
      context.imageSmoothingQuality = 'high';
      context.drawImage(image, 0, 0, width, height);

      const source = context.getImageData(0, 0, width, height).data;
      const quantizedRgb = [];
      for (let index = 0; index < source.length; index += 4) {
        quantizedRgb.push(
          Math.min(255, Math.round(source[index] / 16) * 16),
          Math.min(255, Math.round(source[index + 1] / 16) * 16),
          Math.min(255, Math.round(source[index + 2] / 16) * 16)
        );
      }
      return quantizedRgb;
    },
    {
      data: screenshot.toString('base64'),
      height: VISUAL_SAMPLE_HEIGHT,
      width: VISUAL_SAMPLE_WIDTH,
    }
  );

  return {
    sample: Buffer.from(sample).toString('base64'),
    screenshot,
  };
};

const assertVisualBaseline = ({ actual, baselineKey }) => {
  const expectedBase64 = visualBaselines.images[baselineKey];
  assert.ok(expectedBase64, `Missing visual baseline ${baselineKey}`);

  const actualPixels = Buffer.from(actual, 'base64');
  const expectedPixels = Buffer.from(expectedBase64, 'base64');
  assert.equal(
    actualPixels.length,
    expectedPixels.length,
    `Visual baseline ${baselineKey} has an incompatible sample size`
  );

  let changedPixels = 0;
  let totalDelta = 0;
  for (let index = 0; index < actualPixels.length; index += 3) {
    const redDelta = Math.abs(actualPixels[index] - expectedPixels[index]);
    const greenDelta = Math.abs(
      actualPixels[index + 1] - expectedPixels[index + 1]
    );
    const blueDelta = Math.abs(
      actualPixels[index + 2] - expectedPixels[index + 2]
    );
    const maximumDelta = Math.max(redDelta, greenDelta, blueDelta);
    totalDelta += redDelta + greenDelta + blueDelta;
    if (maximumDelta > 64) changedPixels += 1;
  }

  const pixelCount = actualPixels.length / 3;
  const meanDelta = totalDelta / actualPixels.length;
  const changedRatio = changedPixels / pixelCount;
  assert.ok(
    meanDelta <= VISUAL_MAX_MEAN_DELTA &&
      changedRatio <= VISUAL_MAX_CHANGED_RATIO,
    `${baselineKey} visual regression exceeded its budget: ` +
      `mean delta ${meanDelta.toFixed(2)} (max ${VISUAL_MAX_MEAN_DELTA}), ` +
      `changed pixels ${(changedRatio * 100).toFixed(2)}% ` +
      `(max ${(VISUAL_MAX_CHANGED_RATIO * 100).toFixed(0)}%)`
  );
};

before(async () => {
  const executablePath = await findChromeExecutable();
  if (!UPDATE_VISUAL_BASELINES) {
    visualBaselines = JSON.parse(await readFile(VISUAL_BASELINE_PATH, 'utf8'));
    assert.equal(visualBaselines.schemaVersion, 1);
    assert.equal(visualBaselines.sampleWidth, VISUAL_SAMPLE_WIDTH);
    assert.equal(visualBaselines.sampleHeight, VISUAL_SAMPLE_HEIGHT);
    assert.equal(
      visualBaselines.fixedTime,
      new Date(VISUAL_FIXED_TIME).toISOString()
    );
  }

  await build({
    logLevel: 'silent',
    define: {
      'import.meta.env.VITE_ACTIVITY_DATA_REQUEST_TIMEOUT_MS':
        JSON.stringify('15000'),
    },
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
  if (UPDATE_VISUAL_BASELINES) {
    const baselineDocument = {
      schemaVersion: 1,
      sampleWidth: VISUAL_SAMPLE_WIDTH,
      sampleHeight: VISUAL_SAMPLE_HEIGHT,
      fixedTime: new Date(VISUAL_FIXED_TIME).toISOString(),
      images: pendingVisualBaselines,
    };
    await writeFile(
      VISUAL_BASELINE_PATH,
      `${JSON.stringify(baselineDocument, null, 2)}\n`,
      'utf8'
    );
  }
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

            const baselineKey = `${mode}-${width}`;
            const { sample, screenshot } = await captureVisualSample(
              session.page
            );
            assert.ok(
              screenshot.byteLength > 1_000,
              `Rendered screenshot for ${mode}/${width} was unexpectedly empty`
            );
            if (UPDATE_VISUAL_BASELINES) {
              pendingVisualBaselines[baselineKey] = sample;
            } else {
              assertVisualBaseline({ actual: sample, baselineKey });
            }
            if (process.env.VISUAL_ARTIFACT_DIR) {
              await mkdir(process.env.VISUAL_ARTIFACT_DIR, {
                recursive: true,
              });
              await writeFile(
                join(process.env.VISUAL_ARTIFACT_DIR, `${baselineKey}.png`),
                screenshot
              );
            }
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
  'route data remains visible when WebGL is unavailable',
  { timeout: 60_000 },
  async () => {
    const session = await createBrowserPage(390, { forceNoWebGL: true });
    try {
      await openActivityPage(session.page, 'running');

      const fallback = session.page.locator(
        '#map-container [data-map-renderer="fallback"]'
      );
      await fallback.waitFor({ state: 'visible' });
      assert.equal(
        (await fallback.locator('svg[role="img"] polyline').count()) > 0,
        true,
        'the fallback renderer did not draw any route geometry'
      );
      assert.equal(
        (await fallback
          .locator('svg[role="img"] image[data-map-tile="true"]')
          .count()) > 0,
        true,
        'the fallback renderer did not mount a basemap tile layer'
      );
      assert.match(
        (await fallback.getByRole('status').first().textContent()) ?? '',
        /轨迹模式/
      );
      assert.equal(
        await session.page
          .locator('#map-container canvas.mapboxgl-canvas')
          .count(),
        0,
        'the page attempted to mount Mapbox after WebGL preflight failed'
      );
      session.assertNoRuntimeErrors();
    } finally {
      await session.context.close();
    }
  }
);

test(
  'the primary activity journey completes in no more than three actions',
  { timeout: 60_000 },
  async () => {
    const session = await createBrowserPage(390);
    try {
      await openActivityPage(session.page, 'running');
      let actions = 0;

      const cyclingLink = session.page
        .locator('nav[aria-label="运动类型"] a')
        .filter({ hasText: 'Cycling' });
      await cyclingLink.click();
      actions += 1;
      await session.page
        .locator('[data-app-ready="cycling"]')
        .waitFor({ state: 'visible' });

      const yearButton = session.page.getByRole('button', {
        name: '显示2026 年活动',
        exact: true,
      });
      await yearButton.click();
      actions += 1;
      await session.page.waitForURL(
        (url) =>
          url.pathname === '/cycling' && url.searchParams.get('year') === '2026'
      );

      const activityButton = session.page
        .locator('tbody button[type="button"][aria-pressed]')
        .first();
      await activityButton.click();
      actions += 1;
      await session.page.waitForFunction(
        () =>
          window.location.hash.startsWith('#run_') &&
          Boolean(
            document.querySelector(
              'tbody button[type="button"][aria-pressed="true"]'
            )
          )
      );

      assert.ok(
        actions <= 3,
        `Primary activity journey required ${actions} actions`
      );
      session.assertNoRuntimeErrors();
    } finally {
      await session.context.close();
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
        .filter({ hasText: 'Cycling' });

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
                link.textContent?.includes('Cycling')
            );
            const summary = [...document.querySelectorAll('a')].find(
              (link) => link.textContent?.trim() === 'Trends'
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
        .filter({ hasText: 'Cycling' });
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
  'location filters show their route heatmap while time filters focus the latest routed activity',
  { timeout: 60_000 },
  async () => {
    const session = await createBrowserPage(1280);
    try {
      await openActivityPage(session.page, 'running');
      await session.page.getByRole('button', { name: 'Location' }).click();

      const wuxiFilter = /^无锡市 \d+ km$/;
      await session.page.getByRole('button', { name: wuxiFilter }).click();
      await waitForCityHeatmap(session.page, '无锡市 City Running Heatmap');
      assert.equal(
        await session.page
          .locator('tbody button[type="button"][aria-pressed="true"]')
          .count(),
        0,
        'The city heatmap selected a single table activity'
      );
      const cityActivities = session.page.locator(
        'tbody button[type="button"][aria-pressed="false"]'
      );
      await cityActivities.first().waitFor({ state: 'visible' });
      assert.ok(
        (await cityActivities.count()) > 1,
        'The city heatmap did not keep all matching activities available'
      );
      assert.ok(
        (await session.page
          .locator('tbody tr')
          .filter({ hasText: '2024-' })
          .count()) > 0,
        'The city heatmap omitted its 2024 activities'
      );
      assert.ok(
        (await session.page
          .locator('tbody tr')
          .filter({ hasText: '2025-' })
          .count()) > 0,
        'The city heatmap omitted its 2025 activities'
      );
      assert.equal(
        await session.page.getByLabel('使用列表选择一条路线').count(),
        0,
        'The city heatmap displayed the unfiltered Total poster'
      );

      const selectLatestMatch = async (filterName) => {
        const previousHash = new URL(session.page.url()).hash;
        await session.page.getByRole('button', { name: filterName }).click();
        await session.page.waitForFunction(
          (oldHash) =>
            window.location.hash.startsWith('#run_') &&
            window.location.hash !== oldHash,
          previousHash,
          { timeout: 10_000 }
        );
        await session.page
          .locator('tbody button[type="button"][aria-pressed="true"]')
          .waitFor({ state: 'visible', timeout: 5_000 });

        const selectedState = await session.page.evaluate(() => {
          const selected = document.querySelector(
            'tbody button[type="button"][aria-pressed="true"]'
          );
          return {
            hash: window.location.hash,
            label: selected?.getAttribute('aria-label') ?? '',
            year: new URL(window.location.href).searchParams.get('year'),
          };
        });
        const selectedYear = selectedState.label.match(/\d{4}/)?.[0] ?? '';

        assert.ok(selectedState.hash.startsWith('#run_'));
        assert.ok(
          selectedState.label.startsWith('在地图上取消定位'),
          `Filter ${filterName} did not select a table activity`
        );
        assert.equal(
          selectedState.year,
          selectedYear,
          `Filter ${filterName} loaded ${selectedState.year}, but selected ${selectedState.label}`
        );
      };

      await selectLatestMatch(/^清晨跑步 \d+ Runs$/);
      await selectLatestMatch(/^午后跑步 \d+ Runs$/);

      session.assertNoRuntimeErrors();
    } finally {
      await session.context.close();
    }
  }
);

test(
  'a stale year request cannot override a newer location filter',
  { timeout: 60_000 },
  async () => {
    const session = await createBrowserPage(1280);
    let releaseYearRequest;
    let markYearRequestStarted;
    const yearRequestStarted = new Promise((resolve) => {
      markYearRequestStarted = resolve;
    });
    const yearRequestGate = new Promise((resolve) => {
      releaseYearRequest = resolve;
    });

    await session.context.route(
      '**/data/running/routes/2020.json*',
      async (route) => {
        markYearRequestStarted();
        await yearRequestGate;
        await route.continue();
      }
    );

    try {
      await openActivityPage(session.page, 'running');
      await session.page
        .getByRole('button', { name: '显示2020 年活动', exact: true })
        .click();
      await yearRequestStarted;

      await session.page.getByRole('button', { name: 'Location' }).click();
      await session.page
        .getByRole('button', { name: /^无锡市 \d+ km$/ })
        .dispatchEvent('click');
      releaseYearRequest();
      await waitForCityHeatmap(session.page, '无锡市 City Running Heatmap');

      await session.page.waitForTimeout(500);

      assert.equal(
        new URL(session.page.url()).searchParams.get('year'),
        'Total',
        'The stale year request replaced the newer location filter'
      );
      assert.equal(
        new URL(session.page.url()).hash,
        '',
        'The stale year request selected a route over the location heatmap'
      );
      session.assertNoRuntimeErrors();
    } finally {
      releaseYearRequest?.();
      await session.context.close();
    }
  }
);

test(
  'a stale location filter cannot override a newer table selection',
  { timeout: 60_000 },
  async () => {
    const session = await createBrowserPage(1280);
    let releaseFilterRequest;
    let markFilterRequestStarted;
    const filterRequestStarted = new Promise((resolve) => {
      markFilterRequestStarted = resolve;
    });
    const filterRequestGate = new Promise((resolve) => {
      releaseFilterRequest = resolve;
    });

    await session.context.route(
      '**/data/running/routes/2024.json*',
      async (route) => {
        markFilterRequestStarted();
        await filterRequestGate;
        await route.continue();
      }
    );

    try {
      await openActivityPage(session.page, 'running');
      await session.page.getByRole('button', { name: 'Location' }).click();
      await session.page
        .getByRole('button', { name: /^清晨跑步 \d+ Runs$/ })
        .click();
      await filterRequestStarted;

      await session.page
        .locator('tbody button[type="button"][aria-pressed="false"]')
        .first()
        .click();
      await session.page.waitForFunction(() =>
        window.location.hash.startsWith('#run_')
      );
      const manuallySelectedHash = new URL(session.page.url()).hash;

      releaseFilterRequest();
      await session.page.waitForTimeout(500);

      assert.equal(
        new URL(session.page.url()).searchParams.get('year'),
        '2025',
        'The stale location filter changed the manually selected year'
      );
      assert.equal(
        new URL(session.page.url()).hash,
        manuallySelectedHash,
        'The stale location filter replaced the manual table selection'
      );
      assert.equal(
        await session.page
          .locator('tbody button[type="button"][aria-pressed="true"]')
          .count(),
        1
      );
      session.assertNoRuntimeErrors();
    } finally {
      releaseFilterRequest?.();
      await session.context.close();
    }
  }
);

test(
  'a stale location filter cannot override browser history navigation',
  { timeout: 60_000 },
  async () => {
    const session = await createBrowserPage(1280);
    let releaseFilterRequest;
    let markFilterRequestStarted;
    const filterRequestStarted = new Promise((resolve) => {
      markFilterRequestStarted = resolve;
    });
    const filterRequestGate = new Promise((resolve) => {
      releaseFilterRequest = resolve;
    });

    await session.context.route(
      '**/data/running/routes/2024.json*',
      async (route) => {
        markFilterRequestStarted();
        await filterRequestGate;
        await route.continue();
      }
    );

    try {
      await openActivityPage(session.page, 'running');
      await session.page
        .locator('tbody button[type="button"][aria-pressed="false"]')
        .first()
        .click();
      await session.page.waitForFunction(() =>
        window.location.hash.startsWith('#run_')
      );
      const mapTitle = session.page.locator(
        '#map-container span[class*="runTitle"]'
      );
      await session.page.waitForFunction(
        () =>
          (
            document.querySelector('#map-container span[class*="runTitle"]')
              ?.textContent ?? ''
          ).trim().length > 0
      );

      await session.page.getByRole('button', { name: 'Location' }).click();
      await session.page
        .getByRole('button', { name: /^清晨跑步 \d+ Runs$/ })
        .click();
      await filterRequestStarted;

      await session.page.goBack();
      await session.page.waitForFunction(
        () =>
          new URL(window.location.href).searchParams.get('year') === '2025' &&
          window.location.hash === ''
      );

      releaseFilterRequest();
      await session.page.waitForTimeout(500);

      assert.equal(
        new URL(session.page.url()).searchParams.get('year'),
        '2025',
        'The stale location filter changed the history-selected year'
      );
      assert.equal(
        new URL(session.page.url()).hash,
        '',
        'The stale location filter replaced the history-selected route state'
      );
      assert.equal(
        await session.page
          .locator('tbody button[type="button"][aria-pressed="true"]')
          .count(),
        0
      );
      assert.equal(
        (await mapTitle.textContent())?.trim(),
        '',
        'The history navigation left the previous route title visible'
      );
      session.assertNoRuntimeErrors();
    } finally {
      releaseFilterRequest?.();
      await session.context.close();
    }
  }
);

test(
  'summary cards use the available desktop width and stay responsive',
  { timeout: 60_000 },
  async () => {
    const session = await createBrowserPage(1972);
    try {
      const response = await session.page.goto(`${origin}/running/summary`, {
        waitUntil: 'domcontentloaded',
      });
      assert.equal(response?.ok(), true, 'Failed to load /running/summary');

      const sportFilter = session.page.getByLabel('运动类型筛选');
      await sportFilter.waitFor({ state: 'visible' });
      await session.page
        .locator('article:visible')
        .first()
        .waitFor({ state: 'visible', timeout: 5_000 });
      await waitForAnimationFrames(session.page);

      const desktopLayout = await sportFilter.evaluate((filter) => {
        const filterBar = filter.closest('div');
        const activityList = filterBar?.parentElement;
        const main = activityList?.closest('main');
        const visibleCards = [
          ...(activityList?.querySelectorAll('article') ?? []),
        ]
          .filter((card) => getComputedStyle(card).visibility !== 'hidden')
          .map((card) => card.getBoundingClientRect());
        if (!activityList || !main || visibleCards.length < 3) {
          throw new Error('Summary layout elements are missing');
        }

        const mainRect = main.getBoundingClientRect();
        const listRect = activityList.getBoundingClientRect();
        const firstCardTop = visibleCards[0].top;
        return {
          firstRowColumns: visibleCards.filter(
            (card) => Math.abs(card.top - firstCardTop) <= 1
          ).length,
          listToMainRatio: listRect.width / mainRect.width,
          rightGap: mainRect.right - listRect.right,
        };
      });

      assert.ok(
        desktopLayout.listToMainRatio >= 0.8,
        `Summary uses only ${(desktopLayout.listToMainRatio * 100).toFixed(1)}% of the desktop shell`
      );
      assert.ok(
        desktopLayout.rightGap <= 80,
        `Summary leaves ${desktopLayout.rightGap.toFixed(1)}px unused on the right`
      );
      assert.ok(
        desktopLayout.firstRowColumns >= 3,
        `Desktop summary rendered only ${desktopLayout.firstRowColumns} card per row`
      );

      await session.page.setViewportSize({
        width: 390,
        height: VIEWPORT_HEIGHT,
      });
      await waitForAnimationFrames(session.page);
      const mobileLayout = await sportFilter.evaluate((filter) => {
        const activityList = filter.closest('div')?.parentElement;
        const visibleCards = [
          ...(activityList?.querySelectorAll('article') ?? []),
        ]
          .filter((card) => getComputedStyle(card).visibility !== 'hidden')
          .map((card) => card.getBoundingClientRect());
        const firstCardTop = visibleCards[0]?.top ?? 0;
        return {
          documentWidth: document.documentElement.scrollWidth,
          firstRowColumns: visibleCards.filter(
            (card) => Math.abs(card.top - firstCardTop) <= 1
          ).length,
          viewportWidth: window.innerWidth,
        };
      });
      assert.ok(
        mobileLayout.documentWidth <= mobileLayout.viewportWidth + 1,
        `Mobile summary overflows by ${mobileLayout.documentWidth - mobileLayout.viewportWidth}px`
      );
      assert.equal(
        mobileLayout.firstRowColumns,
        1,
        'Mobile summary should remain a single column'
      );

      session.assertNoRuntimeErrors();
    } finally {
      await session.context.close();
    }
  }
);

test(
  'trends navigation is English, Home is centered, and content uses document scrolling',
  { timeout: 60_000 },
  async () => {
    const session = await createBrowserPage(1280);
    try {
      const response = await session.page.goto(`${origin}/running/summary`, {
        waitUntil: 'domcontentloaded',
      });
      assert.equal(response?.ok(), true, 'Failed to load /running/summary');

      await session.page.getByLabel('运动类型筛选').waitFor();
      const firstCard = session.page.locator('article:visible').first();
      await firstCard.waitFor();
      await waitForAnimationFrames(session.page);

      const navigation = await session.page.evaluate(() => {
        const home = document.querySelector('main a[href="/running"]');
        const cycling = document.querySelector('a[href="/cycling/summary"]');
        const modeNav = cycling?.closest('nav');
        const running = modeNav?.querySelector('a[href="/running/summary"]');
        const hiking = modeNav?.querySelector('a[href="/hiking/summary"]');
        const trends = [
          ...document.querySelectorAll('a[href="/running/summary"]'),
        ].find((link) => !modeNav?.contains(link));

        if (!home || !running || !cycling || !hiking || !trends) {
          throw new Error('Trends navigation is incomplete');
        }

        const range = document.createRange();
        range.selectNodeContents(home);
        const text = range.getBoundingClientRect();
        const control = home.getBoundingClientRect();

        return {
          homeCenterDeltaX: Math.abs(
            control.left + control.width / 2 - (text.left + text.width / 2)
          ),
          homeCenterDeltaY: Math.abs(
            control.top + control.height / 2 - (text.top + text.height / 2)
          ),
          labels: [
            trends.textContent?.trim(),
            home.textContent?.trim(),
            running.textContent?.trim(),
            cycling.textContent?.trim(),
            hiking.textContent?.trim(),
          ],
          languageTags: [trends, home, running, cycling, hiking].map(
            (element) => element.closest('[lang]')?.getAttribute('lang') ?? null
          ),
        };
      });

      await session.page.locator('.recharts-wrapper').first().waitFor();
      const chartRendering = await session.page.evaluate(() => ({
        cardCount: document.querySelectorAll('main article').length,
        renderedChartCount: document.querySelectorAll('main .recharts-wrapper')
          .length,
      }));

      await session.page.evaluate(() => {
        const scrollingElement = document.scrollingElement;
        if (!scrollingElement) {
          throw new Error('Document scrolling element is missing');
        }
        scrollingElement.scrollTo({ top: 0, left: 0, behavior: 'auto' });
        document
          .querySelectorAll('main *')
          .forEach((element) => element.scrollTo?.(0, 0));

        const maxScrollTop =
          scrollingElement.scrollHeight - scrollingElement.clientHeight;
        if (maxScrollTop <= 0) {
          throw new Error('Summary content does not extend the document');
        }
        scrollingElement.scrollTo({
          top: Math.min(600, maxScrollTop),
          left: 0,
          behavior: 'auto',
        });
      });
      await session.page.waitForFunction(
        () => (document.scrollingElement?.scrollTop ?? 0) > 0,
        null,
        { timeout: 2_000 }
      );

      const scrolling = await session.page.evaluate(() => {
        const main = document.querySelector('main');
        const holder = main?.querySelector('.rc-virtual-list-holder');
        return {
          customScrollbarCount:
            main?.querySelectorAll('.rc-virtual-list-scrollbar-vertical')
              .length ?? 0,
          documentClientHeight: document.documentElement.clientHeight,
          documentScrollHeight: document.documentElement.scrollHeight,
          documentTop: document.scrollingElement?.scrollTop ?? 0,
          nestedOffsets: [...(main?.querySelectorAll('*') ?? [])]
            .filter((element) => element.scrollTop > 0)
            .map((element) => element.scrollTop),
          nestedOverflow: holder
            ? holder.scrollHeight > holder.clientHeight + 1
            : false,
        };
      });

      assert.deepEqual(navigation.labels, [
        'Trends',
        'Home',
        'Running',
        'Cycling',
        'Hiking',
      ]);
      assert.deepEqual(navigation.languageTags, ['en', 'en', 'en', 'en', 'en']);
      assert.ok(
        navigation.homeCenterDeltaX <= 1,
        `Home is horizontally off-center by ${navigation.homeCenterDeltaX}px`
      );
      assert.ok(
        navigation.homeCenterDeltaY <= 1,
        `Home is vertically off-center by ${navigation.homeCenterDeltaY}px`
      );
      assert.ok(
        scrolling.documentScrollHeight > scrolling.documentClientHeight,
        'Summary content does not extend the document'
      );
      assert.ok(scrolling.documentTop > 0, 'The document did not scroll');
      assert.equal(scrolling.nestedOverflow, false);
      assert.equal(scrolling.customScrollbarCount, 0);
      assert.deepEqual(scrolling.nestedOffsets, []);
      assert.ok(
        chartRendering.renderedChartCount < chartRendering.cardCount,
        `Rendered all ${chartRendering.cardCount} charts before they approached the viewport`
      );
      session.assertNoRuntimeErrors();
    } finally {
      await session.context.close();
    }
  }
);

test(
  'Year and Location use English labels and matching introduction colors',
  { timeout: 60_000 },
  async () => {
    const session = await createBrowserPage(1280);
    try {
      await openActivityPage(session.page, 'running');

      const yearButton = session.page.getByRole('button', { name: 'Year' });
      const locationButton = session.page.getByRole('button', {
        name: 'Location',
      });
      await yearButton.waitFor();
      await locationButton.waitFor();
      assert.equal(
        await yearButton.evaluate(
          (element) => element.closest('[lang]')?.getAttribute('lang') ?? null
        ),
        'en'
      );
      assert.equal(
        await locationButton.evaluate(
          (element) => element.closest('[lang]')?.getAttribute('lang') ?? null
        ),
        'en'
      );

      const yearIntro = session.page.locator('.kami-sidebar-intro').first();
      await yearIntro.waitFor();
      const yearColor = await yearIntro.evaluate(
        (element) => getComputedStyle(element).color
      );

      await locationButton.click();
      const locationIntro = session.page
        .locator('.kami-sidebar-intro')
        .filter({ hasText: 'Yesterday you said tomorrow.' });
      await locationIntro.waitFor();
      const locationColor = await locationIntro.evaluate(
        (element) => getComputedStyle(element).color
      );

      assert.equal(locationColor, yearColor);
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
  'Total posters provide a keyboard dialog and a 44px route-list alternative',
  { timeout: 60_000 },
  async () => {
    const session = await createBrowserPage(390);
    try {
      const response = await session.page.goto(
        `${origin}/running?year=Total&view=map`,
        { waitUntil: 'domcontentloaded' }
      );
      assert.equal(response?.ok(), true, 'Failed to load running Total');

      const calendarPosterButton = session.page.getByRole('button', {
        name: '放大查看全部年份跑步日历海报',
      });
      const routesPosterButton = session.page.getByRole('button', {
        name: '放大查看长距离跑步路线海报',
      });
      const routeSelect = session.page.getByLabel('使用列表选择一条路线');
      await calendarPosterButton.waitFor({ state: 'visible' });
      await routesPosterButton.waitFor({ state: 'visible' });
      await routeSelect.waitFor({ state: 'visible' });

      for (const target of [
        calendarPosterButton,
        routesPosterButton,
        routeSelect,
      ]) {
        const box = await target.boundingBox();
        assert.ok(box);
        assert.ok(
          box.height >= MIN_TOUCH_TARGET_PX && box.width >= MIN_TOUCH_TARGET_PX,
          `Total poster control is below ${MIN_TOUCH_TARGET_PX}px: ${JSON.stringify(box)}`
        );
      }

      await routesPosterButton.focus();
      await session.page.keyboard.press('Enter');
      const dialog = session.page.getByRole('dialog', {
        name: '长距离跑步路线海报',
      });
      await dialog.waitFor({ state: 'visible' });
      assert.equal(
        await session.page.evaluate(() =>
          document.activeElement?.getAttribute('aria-label')
        ),
        '关闭长距离跑步路线海报'
      );
      const closeButton = session.page.getByRole('button', {
        name: '关闭长距离跑步路线海报',
      });
      const closeButtonFocusStyle = await closeButton.evaluate((element) => {
        const style = getComputedStyle(element);
        return {
          color: style.outlineColor,
          style: style.outlineStyle,
          width: style.outlineWidth,
        };
      });
      assert.deepEqual(closeButtonFocusStyle, {
        color: 'rgb(255, 255, 255)',
        style: 'solid',
        width: '3px',
      });

      const posterSvg = dialog.locator('svg');
      const posterBox = await posterSvg.boundingBox();
      const viewBox = (await posterSvg.getAttribute('viewBox'))
        ?.split(/\s+/)
        .map(Number);
      assert.ok(posterBox);
      assert.equal(viewBox?.length, 4, 'Total poster is missing its viewBox');
      const renderedRatio = posterBox.width / posterBox.height;
      const intrinsicRatio = viewBox[2] / viewBox[3];
      assert.ok(
        posterBox.width >= 900,
        `Total poster did not enlarge enough for mobile reading: ${posterBox.width}px`
      );
      assert.ok(
        Math.abs(renderedRatio - intrinsicRatio) < 0.01,
        `Total poster aspect ratio was distorted: ${renderedRatio} vs ${intrinsicRatio}`
      );
      await session.page.keyboard.press('Tab');
      assert.equal(
        await dialog.evaluate((element) => document.activeElement === element),
        true,
        'The scrollable poster canvas is not keyboard-focusable'
      );
      await session.page.keyboard.press('ArrowRight');
      await session.page.keyboard.press('ArrowDown');
      await session.page.waitForFunction(
        () => {
          const activeDialog = document.querySelector('[role="dialog"]');
          return (
            activeDialog &&
            activeDialog.scrollLeft > 0 &&
            activeDialog.scrollTop > 0
          );
        },
        null,
        { timeout: 2_000 }
      );
      const scrollState = await dialog.evaluate((element) => ({
        left: element.scrollLeft,
        top: element.scrollTop,
        clientWidth: element.clientWidth,
        scrollWidth: element.scrollWidth,
      }));
      assert.ok(
        scrollState.scrollWidth > scrollState.clientWidth,
        `Total poster dialog is not horizontally scrollable: ${JSON.stringify(scrollState)}`
      );
      assert.ok(
        scrollState.left > 0 && scrollState.top > 0,
        `Total poster dialog did not pan with the keyboard: ${JSON.stringify(scrollState)}`
      );
      await session.page.keyboard.press('Tab');
      assert.equal(
        await closeButton.evaluate(
          (element) => document.activeElement === element
        ),
        true,
        'The poster dialog focus trap did not return to the close button'
      );
      await session.page.keyboard.press('Shift+Tab');
      assert.equal(
        await dialog.evaluate((element) => document.activeElement === element),
        true,
        'The poster dialog focus trap did not cycle in reverse'
      );

      await session.page.keyboard.press('Escape');
      await dialog.waitFor({ state: 'detached' });
      assert.equal(
        await routesPosterButton.evaluate(
          (element) => document.activeElement === element
        ),
        true,
        'Focus was not restored to the Total poster launcher'
      );

      const routeOptions = await routeSelect.locator('option').all();
      assert.ok(routeOptions.length > 1, 'No poster routes were listed');
      const routeId = await routeOptions[1].getAttribute('value');
      assert.ok(routeId);
      await routeSelect.selectOption(routeId);
      await session.page.waitForFunction(
        (expectedHash) => window.location.hash === expectedHash,
        `#run_${routeId}`
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
