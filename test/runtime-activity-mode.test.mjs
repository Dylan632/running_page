import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { after, before, test } from 'node:test';
import React, { act, Suspense } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { JSDOM } from 'jsdom';
import { createServer } from 'vite';

let vite;
let previousFetch;

const installDomGlobals = (window) => {
  const values = {
    window,
    self: window,
    document: window.document,
    navigator: window.navigator,
    Node: window.Node,
    Element: window.Element,
    HTMLElement: window.HTMLElement,
    HTMLButtonElement: window.HTMLButtonElement,
    Event: window.Event,
    MouseEvent: window.MouseEvent,
    KeyboardEvent: window.KeyboardEvent,
    ResizeObserver: class {
      observe() {}
      disconnect() {}
    },
    requestAnimationFrame: (callback) => window.setTimeout(callback, 0),
    cancelAnimationFrame: (id) => window.clearTimeout(id),
    getComputedStyle: window.getComputedStyle.bind(window),
    IS_REACT_ACT_ENVIRONMENT: true,
  };
  const previousDescriptors = new Map();

  for (const [key, value] of Object.entries(values)) {
    previousDescriptors.set(
      key,
      Object.getOwnPropertyDescriptor(globalThis, key)
    );
    Object.defineProperty(globalThis, key, {
      configurable: true,
      writable: true,
      value,
    });
  }

  return () => {
    for (const [key, descriptor] of previousDescriptors) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
  };
};

const renderWhenReady = async (render, isReady) => {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const html = render();
    if (isReady(html)) return html;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error('Suspense fixture did not become ready within 1 second');
};

before(async () => {
  previousFetch = globalThis.fetch;
  const stableJson = (value) => `${JSON.stringify(value)}\n`;
  const checksum = (text) => createHash('sha256').update(text).digest('hex');
  const activities = {
    cycling: [
      {
        run_id: '7',
        name: 'Morning ride',
        distance: 25_000,
        moving_time: '01:00:00',
        type: 'Ride',
        subtype: 'cycling',
        start_date_local: '2026-07-25 08:00:00',
        location_country: 'China',
        average_heartrate: 130,
        elevation_gain: 120,
        average_speed: 6.94,
        streak: 1,
      },
    ],
    running: [
      {
        run_id: '8',
        name: 'Morning run',
        distance: 5_000,
        moving_time: '00:25:00',
        type: 'Run',
        subtype: 'running',
        start_date_local: '2026-07-25 09:00:00',
        location_country: 'China',
        average_heartrate: 140,
        elevation_gain: 30,
        average_speed: 3.33,
        streak: 1,
      },
    ],
  };
  const responses = new Map();
  for (const [mode, metadata] of Object.entries(activities)) {
    const metadataText = stableJson(metadata);
    const emptyRoutesText = stableJson([]);
    const metadataChecksum = checksum(metadataText);
    responses.set(
      `/data/${mode}/metadata.json?v=${metadataChecksum}`,
      metadataText
    );
    responses.set(
      `/data/${mode}/manifest.json`,
      stableJson({
        schemaVersion: 1,
        mode,
        activityCount: metadata.length,
        publishedAt: '2026-07-26T12:30:00.000Z',
        latestActivityDate: metadata[0].start_date_local,
        latestYear: '2026',
        years: ['2026'],
        routeCount: 0,
        routeRatio: 0,
        checksum: '1'.repeat(64),
        artifactChecksum: '2'.repeat(64),
        metadataChecksum,
        routeChecksums: { 2026: checksum(emptyRoutesText) },
        source: `${mode}.json`,
      })
    );
  }
  globalThis.fetch = async (url) => {
    const path = String(url);
    return new Response(responses.get(path) ?? '', {
      status: responses.has(path) ? 200 : 404,
      headers: { 'content-type': 'application/json' },
    });
  };
  vite = await createServer({
    appType: 'custom',
    optimizeDeps: { noDiscovery: true },
    server: { middlewareMode: true },
  });
});

after(async () => {
  await new Promise((resolve) => setTimeout(resolve, 100));
  await vite?.close();
  globalThis.fetch = previousFetch;
});

test('activity filtering and metrics use the requested runtime mode', async () => {
  const { isSelectedActivity } = await vite.ssrLoadModule(
    '/src/utils/activityMode.ts'
  );
  const { formatPace } = await vite.ssrLoadModule('/src/utils/utils.ts');
  const ride = { type: 'Ride', distance: 25_000 };

  assert.equal(isSelectedActivity(ride, 'cycling', 20_000), true);
  assert.equal(isSelectedActivity(ride, 'running', 0), false);
  assert.equal(isSelectedActivity(ride, 'cycling', 25_000), false);
  assert.equal(formatPace(5, 'cycling'), '18.0 km/h');
  assert.equal(formatPace(5, 'running'), `3'20"`);
});

test('summary home control returns to the active activity route', async () => {
  const { MemoryRouter, Route, Routes } = await import('react-router-dom');
  const { ActivityModeProvider } = await vite.ssrLoadModule(
    '/src/modules/activity/ActivityModeProvider.tsx'
  );
  const { default: ActivityList } = await vite.ssrLoadModule(
    '/src/components/ActivityList/index.tsx'
  );
  const renderSummary = () =>
    renderToStaticMarkup(
      React.createElement(
        MemoryRouter,
        { initialEntries: ['/cycling/summary'] },
        React.createElement(
          Routes,
          null,
          React.createElement(Route, {
            path: '/:activityMode/summary',
            element: React.createElement(
              ActivityModeProvider,
              null,
              React.createElement(
                Suspense,
                { fallback: React.createElement('p', null, 'loading') },
                React.createElement(ActivityList)
              )
            ),
          })
        )
      )
    );

  const html = await renderWhenReady(renderSummary, (markup) =>
    markup.includes('Home')
  );
  const dom = new JSDOM(html);

  try {
    const homeControl = [...dom.window.document.querySelectorAll('a')].find(
      (link) => link.textContent?.trim() === 'Home'
    );
    assert.ok(homeControl);
    assert.equal(homeControl.getAttribute('href'), '/cycling');
    const comboboxes = [...dom.window.document.querySelectorAll('select')];
    assert.equal(comboboxes.length, 2);
    assert.deepEqual(
      comboboxes.map((select) => select.getAttribute('aria-label')),
      ['运动类型筛选', '时间范围筛选']
    );
  } finally {
    dom.window.close();
  }
});

test('location statistics use the active cycling profile copy', async () => {
  const { MemoryRouter, Route, Routes } = await import('react-router-dom');
  const { ActivityModeProvider } = await vite.ssrLoadModule(
    '/src/modules/activity/ActivityModeProvider.tsx'
  );
  const { default: LocationSummary } = await vite.ssrLoadModule(
    '/src/components/LocationStat/LocationSummary.tsx'
  );
  const { default: PeriodStat } = await vite.ssrLoadModule(
    '/src/components/LocationStat/PeriodStat.tsx'
  );
  const html = renderToStaticMarkup(
    React.createElement(
      MemoryRouter,
      { initialEntries: ['/cycling'] },
      React.createElement(
        Routes,
        null,
        React.createElement(Route, {
          path: '/:activityMode',
          element: React.createElement(
            ActivityModeProvider,
            null,
            React.createElement(
              React.Fragment,
              null,
              React.createElement(LocationSummary),
              React.createElement(PeriodStat, { onClick: () => {} })
            )
          ),
        })
      )
    )
  );
  const dom = new JSDOM(html);

  try {
    assert.match(dom.window.document.body.textContent ?? '', /年里我骑过/);
    assert.match(dom.window.document.body.textContent ?? '', /1 Rides/);
    assert.doesNotMatch(
      dom.window.document.body.textContent ?? '',
      /年里我跑过/
    );
  } finally {
    dom.window.close();
  }
});

test('summary page uses the shared layout and active profile metadata', async () => {
  const { HelmetProvider } = await vite.ssrLoadModule('react-helmet-async');
  const { MemoryRouter, Route, Routes } = await import('react-router-dom');
  const { ActivityModeProvider } = await vite.ssrLoadModule(
    '/src/modules/activity/ActivityModeProvider.tsx'
  );
  const { default: SummaryPage } = await vite.ssrLoadModule(
    '/src/pages/total.tsx'
  );
  const renderSummaryPage = () =>
    renderToStaticMarkup(
      React.createElement(
        HelmetProvider,
        null,
        React.createElement(
          MemoryRouter,
          { initialEntries: ['/running/summary'] },
          React.createElement(
            Routes,
            null,
            React.createElement(Route, {
              path: '/:activityMode/summary',
              element: React.createElement(
                ActivityModeProvider,
                null,
                React.createElement(
                  Suspense,
                  { fallback: React.createElement('p', null, 'loading') },
                  React.createElement(SummaryPage)
                )
              ),
            })
          )
        )
      )
    );

  const html = await renderWhenReady(renderSummaryPage, (markup) =>
    markup.includes('running-header')
  );
  const dom = new JSDOM(html);

  try {
    assert.ok(dom.window.document.querySelector('nav.running-header'));
    assert.match(html, /<title>Dylan 的跑步记录<\/title>/);
  } finally {
    dom.window.close();
  }
});

test('year poster launcher opens a dialog from a 44px button', async () => {
  const dom = new JSDOM(
    '<!doctype html><html><body><main id="root"></main></body></html>',
    { pretendToBeVisual: true, url: 'https://records.example/running/summary' }
  );
  const restoreGlobals = installDomGlobals(dom.window);
  const { createRoot } = await import('react-dom/client');
  const { default: YearPosterLauncher } = await vite.ssrLoadModule(
    '/src/components/ActivityList/YearPosterLauncher.tsx'
  );
  const { MemoryRouter, Route, Routes } = await import('react-router-dom');
  const { ActivityModeProvider } = await vite.ssrLoadModule(
    '/src/modules/activity/ActivityModeProvider.tsx'
  );
  const container = dom.window.document.querySelector('#root');
  assert.ok(container);
  const root = createRoot(container);

  try {
    await act(async () => {
      root.render(
        React.createElement(
          MemoryRouter,
          { initialEntries: ['/running'] },
          React.createElement(
            Routes,
            null,
            React.createElement(Route, {
              path: '/:activityMode',
              element: React.createElement(
                ActivityModeProvider,
                null,
                React.createElement(YearPosterLauncher, { year: '2099' })
              ),
            })
          )
        )
      );
    });

    const posterButton = container.querySelector(
      'button[aria-haspopup="dialog"]'
    );
    assert.ok(posterButton);
    assert.match(posterButton.textContent ?? '', /2099/);

    await act(async () => {
      posterButton.dispatchEvent(
        new dom.window.MouseEvent('click', { bubbles: true })
      );
      await new Promise((resolve) => setTimeout(resolve, 50));
    });
    assert.ok(container.querySelector('[role="dialog"][aria-modal="true"]'));

    const css = await readFile(
      'src/components/ActivityList/style.module.css',
      'utf8'
    );
    assert.match(css, /\.posterButton\s*\{[^}]*min-height:\s*44px;/s);
  } finally {
    await act(async () => root.unmount());
    restoreGlobals();
    dom.window.close();
  }
});
