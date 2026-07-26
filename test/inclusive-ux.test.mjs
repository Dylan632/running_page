import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { after, before, test } from 'node:test';
import React, { act } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { JSDOM } from 'jsdom';
import { createServer } from 'vite';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

let vite;
let ActivityModeProvider;

const withActivityMode = (element, mode = 'cycling') =>
  React.createElement(
    MemoryRouter,
    { initialEntries: [`/${mode}`] },
    React.createElement(
      Routes,
      null,
      React.createElement(Route, {
        path: '/:activityMode',
        element: React.createElement(ActivityModeProvider, null, element),
      })
    )
  );

const activityFixture = {
  activities: [
    {
      run_id: 1,
      name: 'Morning Ride',
      distance: 25_000,
      elevation_gain: 120,
      average_speed: 5,
      average_heartrate: 132,
      moving_time: '01:23:45',
      start_date_local: '2025-06-15T08:00:00',
      streak: 3,
      type: 'Ride',
    },
  ],
  years: ['2025'],
  countries: [],
  provinces: [],
  cities: {},
  runPeriod: {},
  thisYear: '2025',
};

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
    HTMLIFrameElement: window.HTMLIFrameElement,
    Event: window.Event,
    MouseEvent: window.MouseEvent,
    KeyboardEvent: window.KeyboardEvent,
    localStorage: window.localStorage,
    sessionStorage: window.sessionStorage,
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

before(async () => {
  globalThis.__INCLUSIVE_UX_ACTIVITY_FIXTURE__ = activityFixture;
  vite = await createServer({
    appType: 'custom',
    plugins: [
      {
        name: 'inclusive-ux-use-activities-fixture',
        enforce: 'pre',
        resolveId(source) {
          if (source === '@/hooks/useActivities') {
            return '\0inclusive-ux-use-activities-fixture';
          }
        },
        load(id) {
          if (id === '\0inclusive-ux-use-activities-fixture') {
            return `
              export default function useActivities() {
                return globalThis.__INCLUSIVE_UX_ACTIVITY_FIXTURE__;
              }
            `;
          }
        },
      },
    ],
    server: { middlewareMode: true },
  });
  ({ ActivityModeProvider } = await vite.ssrLoadModule(
    '/src/modules/activity/ActivityModeProvider.tsx'
  ));
});

after(async () => {
  await vite?.close();
  delete globalThis.__INCLUSIVE_UX_ACTIVITY_FIXTURE__;
});

test('year cards expose real buttons and announce the selected year', async () => {
  const { default: YearsStat } = await vite.ssrLoadModule(
    '/src/components/YearsStat/index.tsx'
  );
  const html = renderToStaticMarkup(
    withActivityMode(
      React.createElement(YearsStat, {
        year: '2025',
        onClick: () => {},
      })
    )
  );
  const dom = new JSDOM(html);

  try {
    const status = dom.window.document.querySelector(
      '[role="status"][aria-live="polite"]'
    );
    const selectedYear = dom.window.document.querySelector(
      'button[data-year="2025"]'
    );
    const total = dom.window.document.querySelector(
      'button[data-year="Total"]'
    );

    assert.ok(status);
    assert.ok(selectedYear);
    assert.equal(selectedYear.getAttribute('type'), 'button');
    assert.equal(selectedYear.getAttribute('aria-pressed'), 'true');
    assert.equal(total?.getAttribute('aria-pressed'), 'false');
    assert.match(selectedYear.getAttribute('aria-label') ?? '', /2025/);
  } finally {
    dom.window.close();
  }
});

test('mobile year cards can shrink without clipping or widening the document', async () => {
  const css = await readFile('src/components/YearsStat/style.css', 'utf8');

  assert.match(
    css,
    /\.kami-sidebar\s*\{[^}]*min-width:\s*0;[^}]*max-width:\s*100%;/s
  );
  assert.match(
    css,
    /\.kami-stat\s*\{[^}]*min-width:\s*0;[^}]*white-space:\s*normal;[^}]*overflow-wrap:\s*anywhere;/s
  );
  assert.match(
    css,
    /@media only screen and \(max-width:\s*768px\)[\s\S]*?\.kami-year-stat:not\(\[data-selected='true'\]\)\s+\.kami-stat:not\(:first-child\)\s*\{[^}]*display:\s*none;/s
  );
  assert.match(
    css,
    /\.kami-year-stat-action\s*\{[^}]*min-width:\s*44px;[^}]*min-height:\s*44px;/s
  );
});

test('mobile page places the map before the long statistics rail', async () => {
  const [layoutSource, pageSource] = await Promise.all([
    readFile('src/components/Layout/index.tsx', 'utf8'),
    readFile('src/pages/index.tsx', 'utf8'),
  ]);

  assert.match(
    layoutSource,
    /className="[^"]*\bflex\b[^"]*\bflex-col\b[^"]*\blg:flex-row\b/
  );
  assert.match(pageSource, /order-2[\s\S]*lg:order-1/);
  assert.match(pageSource, /id="map-container"[\s\S]*order-1[\s\S]*lg:order-2/);
});

test('map year filters are labelled 44px toggle buttons', async () => {
  const { default: RunMapButtons } = await vite.ssrLoadModule(
    '/src/components/RunMap/RunMapButtons.tsx'
  );
  const html = renderToStaticMarkup(
    React.createElement(RunMapButtons, {
      changeYear: () => {},
      thisYear: '2025',
    })
  );
  const css = await readFile('src/components/RunMap/style.module.css', 'utf8');
  const dom = new JSDOM(html);

  try {
    const filterList = dom.window.document.querySelector(
      'ul[aria-label="地图年份筛选"]'
    );
    const buttons = [
      ...(filterList?.querySelectorAll('li > button[type="button"]') ?? []),
    ];
    const selected = buttons.find(
      (button) => button.textContent?.trim() === '2025'
    );

    assert.ok(filterList);
    assert.equal(buttons.length, 2);
    assert.equal(selected?.getAttribute('aria-pressed'), 'true');
    assert.match(selected?.getAttribute('aria-label') ?? '', /2025/);
    assert.match(
      css,
      /\.button\s*\{[^}]*min-width:\s*44px;[^}]*min-height:\s*44px;/s
    );
  } finally {
    dom.window.close();
  }
});

test('map light and vendor controls are named 44px targets', async () => {
  const { default: LightsControl } = await vite.ssrLoadModule(
    '/src/components/RunMap/LightsControl.tsx'
  );
  const html = renderToStaticMarkup(
    React.createElement(LightsControl, {
      lights: true,
      setLights: () => {},
    })
  );
  const css = await readFile('src/components/RunMap/style.module.css', 'utf8');
  const dom = new JSDOM(html);

  try {
    const button = dom.window.document.querySelector('button[type="button"]');
    assert.ok(button?.getAttribute('aria-label'));
    assert.equal(button?.getAttribute('aria-pressed'), 'true');
    assert.match(
      css,
      /:global\(\.mapboxgl-ctrl-group > button\)\s*\{[^}]*width:\s*44px(?:\s*!important)?;[^}]*height:\s*44px(?:\s*!important)?;/s
    );
  } finally {
    dom.window.close();
  }
});

test('clickable statistics use real 44px buttons', async () => {
  const { default: Stat } = await vite.ssrLoadModule(
    '/src/components/Stat/index.tsx'
  );
  const html = renderToStaticMarkup(
    React.createElement(Stat, {
      value: '上海',
      description: ' 3 Rides',
      onClick: () => {},
    })
  );
  const css = await readFile('src/styles/index.css', 'utf8');
  const dom = new JSDOM(html);

  try {
    const button = dom.window.document.querySelector(
      'button.kami-stat-actionable[type="button"]'
    );
    assert.ok(button);
    assert.match(css, /\.kami-stat-actionable\s*\{[^}]*min-height:\s*44px;/s);
  } finally {
    dom.window.close();
  }
});

test('activity switch and theme control meet the 44px touch target', async () => {
  const css = await readFile('src/components/Header/style.module.css', 'utf8');

  assert.match(css, /\.activityLink\s*\{[^}]*min-height:\s*44px;/s);
  assert.match(
    css,
    /\.themeButton\s*\{[^}]*width:\s*44px;[^}]*height:\s*44px;/s
  );
});

test('mobile map controls and activity table contain their own overflow', async () => {
  const [mapCss, tableCss] = await Promise.all([
    readFile('src/components/RunMap/style.module.css', 'utf8'),
    readFile('src/components/RunTable/style.module.css', 'utf8'),
  ]);

  assert.match(
    mapCss,
    /\.buttons\s*\{[^}]*right:\s*14px;[^}]*left:\s*14px;[^}]*max-width:\s*calc\(100%\s*-\s*28px\);[^}]*box-sizing:\s*border-box;/s
  );
  assert.match(
    tableCss,
    /\.tableContainer\s*\{[^}]*width:\s*100%;[^}]*max-width:\s*100%;[^}]*box-sizing:\s*border-box;[^}]*overflow-x:\s*auto;/s
  );
});

test('activity table exposes semantic sort and map-location buttons', async () => {
  const { default: RunTable } = await vite.ssrLoadModule(
    '/src/components/RunTable/index.tsx'
  );
  const html = renderToStaticMarkup(
    withActivityMode(
      React.createElement(RunTable, {
        runs: activityFixture.activities,
        locateActivity: () => {},
        runIndex: -1,
        setRunIndex: () => {},
      })
    )
  );
  const dom = new JSDOM(html);

  try {
    const table = dom.window.document.querySelector('table');
    const sortButtons = [
      ...(table?.querySelectorAll('thead th > button[type="button"]') ?? []),
    ];
    const locateButton = table?.querySelector(
      'tbody button[type="button"][aria-pressed="false"]'
    );
    const liveStatus = dom.window.document.querySelector(
      '[role="status"][aria-live="polite"]'
    );

    assert.ok(table?.querySelector('caption'));
    assert.ok(sortButtons.length > 0);
    assert.equal(table?.querySelectorAll('th[aria-sort]').length, 0);
    assert.ok(locateButton);
    assert.match(locateButton.getAttribute('aria-label') ?? '', /地图/);
    assert.ok(liveStatus);
  } finally {
    dom.window.close();
  }
});

test('table buttons sort records and toggle the matching map activity', async () => {
  const dom = new JSDOM(
    '<!doctype html><html><body><main id="root"></main></body></html>',
    { pretendToBeVisual: true, url: 'http://localhost/' }
  );
  const restoreGlobals = installDomGlobals(dom.window);
  const { createRoot } = await import('react-dom/client');
  const { default: RunTable } = await vite.ssrLoadModule(
    '/src/components/RunTable/index.tsx'
  );
  const container = dom.window.document.querySelector('#root');
  assert.ok(container);
  const root = createRoot(container);
  const locatedRunIds = [];
  const shorterActivity = {
    ...activityFixture.activities[0],
    run_id: 2,
    name: 'Short Ride',
    distance: 10_000,
    start_date_local: '2024-06-15T08:00:00',
  };

  const Harness = () => {
    const [runIndex, setRunIndex] = React.useState(-1);
    return React.createElement(RunTable, {
      runs: [shorterActivity, activityFixture.activities[0]],
      locateActivity: (runIds) => locatedRunIds.push(runIds),
      runIndex,
      setRunIndex,
    });
  };

  try {
    await act(async () => {
      root.render(withActivityMode(React.createElement(Harness)));
    });

    const distanceSortButton = container.querySelector(
      'button[aria-label="按 km 排序"]'
    );
    assert.ok(distanceSortButton);

    await act(async () => {
      distanceSortButton.dispatchEvent(
        new dom.window.MouseEvent('click', { bubbles: true, cancelable: true })
      );
    });

    assert.equal(
      distanceSortButton.closest('th')?.getAttribute('aria-sort'),
      'descending'
    );
    const firstLocateButton = container.querySelector('tbody button');
    assert.match(firstLocateButton?.getAttribute('aria-label') ?? '', /2025/);

    await act(async () => {
      firstLocateButton?.dispatchEvent(
        new dom.window.MouseEvent('click', { bubbles: true, cancelable: true })
      );
    });

    assert.deepEqual(locatedRunIds.at(-1), [1]);
    assert.equal(firstLocateButton?.getAttribute('aria-pressed'), 'true');

    await act(async () => {
      firstLocateButton?.dispatchEvent(
        new dom.window.MouseEvent('click', { bubbles: true, cancelable: true })
      );
    });
    assert.deepEqual(locatedRunIds.at(-1), []);
  } finally {
    await act(async () => {
      root.unmount();
    });
    restoreGlobals();
    dom.window.close();
  }
});

test('year summary dialog closes on Escape and restores the opener focus', async () => {
  const dom = new JSDOM(
    '<!doctype html><html><body><button id="opener" type="button">打开年度总结</button><main id="root"></main></body></html>',
    { pretendToBeVisual: true, url: 'http://localhost/' }
  );
  const restoreGlobals = installDomGlobals(dom.window);
  const { createRoot } = await import('react-dom/client');
  const { default: YearSummaryModal } = await vite.ssrLoadModule(
    '/src/components/YearSummaryModal/index.tsx'
  );
  const container = dom.window.document.querySelector('#root');
  const opener = dom.window.document.querySelector('#opener');
  assert.ok(container);
  assert.ok(opener);
  const root = createRoot(container);

  const Harness = () => {
    const [open, setOpen] = React.useState(true);
    return open
      ? React.createElement(YearSummaryModal, {
          year: '2099',
          onClose: () => setOpen(false),
        })
      : null;
  };

  try {
    dom.window.document.body.style.overflow = 'scroll';
    opener.focus();

    await act(async () => {
      root.render(withActivityMode(React.createElement(Harness), 'running'));
    });

    const dialog = container.querySelector(
      '[role="dialog"][aria-modal="true"]'
    );
    const closeButton = dialog?.querySelector(
      'button[type="button"][aria-label*="关闭"]'
    );

    assert.ok(dialog);
    assert.ok(dialog.getAttribute('aria-labelledby'));
    assert.ok(closeButton);
    assert.equal(dom.window.document.activeElement, closeButton);
    assert.equal(dom.window.document.body.style.overflow, 'hidden');

    await act(async () => {
      dom.window.document.dispatchEvent(
        new dom.window.KeyboardEvent('keydown', {
          bubbles: true,
          key: 'Escape',
        })
      );
    });

    assert.equal(container.querySelector('[role="dialog"]'), null);
    assert.equal(dom.window.document.activeElement, opener);
    assert.equal(dom.window.document.body.style.overflow, 'scroll');
  } finally {
    await act(async () => {
      root.unmount();
    });
    restoreGlobals();
    dom.window.close();
  }
});

test('layout publishes Simplified Chinese document language metadata', async () => {
  const dom = new JSDOM(
    '<!doctype html><html><head></head><body><main id="root"></main></body></html>',
    { pretendToBeVisual: true, url: 'http://localhost/' }
  );
  const restoreGlobals = installDomGlobals(dom.window);
  const { createRoot } = await import('react-dom/client');
  const { HelmetProvider } = await import('react-helmet-async');
  const { MemoryRouter, Route, Routes } = await import('react-router-dom');
  const { ActivityModeProvider } = await vite.ssrLoadModule(
    '/src/modules/activity/ActivityModeProvider.tsx'
  );
  const { default: Layout } = await vite.ssrLoadModule(
    '/src/components/Layout/index.tsx'
  );
  const container = dom.window.document.querySelector('#root');
  assert.ok(container);
  const root = createRoot(container);

  try {
    await act(async () => {
      root.render(
        React.createElement(
          HelmetProvider,
          null,
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
                    Layout,
                    null,
                    React.createElement('p', null, '内容')
                  )
                ),
              })
            )
          )
        )
      );
    });

    assert.equal(dom.window.document.documentElement.lang, 'zh-CN');
  } finally {
    await act(async () => {
      root.unmount();
    });
    restoreGlobals();
    dom.window.close();
  }
});
