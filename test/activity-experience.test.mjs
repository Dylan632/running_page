import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { after, before, test } from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { JSDOM } from 'jsdom';
import { createServer } from 'vite';

let vite;

before(async () => {
  vite = await createServer({
    appType: 'custom',
    optimizeDeps: { noDiscovery: true },
    server: { middlewareMode: true },
  });
});

after(async () => {
  await vite?.close();
});

test('latest matching activity falls back to the newest record with route data', async () => {
  const { findLatestRoutedActivity, getMatchingActivitiesByRecency } =
    await vite.ssrLoadModule('/src/modules/activity/latestMatchingActivity.ts');
  const activities = [
    {
      run_id: 'newest-without-route',
      name: 'Morning run',
      start_date_local: '2026-04-16 08:29:32',
    },
    {
      run_id: 'unrelated',
      name: 'Evening run',
      start_date_local: '2026-04-15 19:29:32',
    },
    {
      run_id: 'newest-routed-match',
      name: 'Morning run',
      start_date_local: '2025-06-06 08:29:32',
    },
    {
      run_id: 'older-routed-match',
      name: 'Morning run',
      start_date_local: '2024-04-16 08:29:32',
    },
  ];
  const loadedYears = [];
  const routesByYear = new Map([
    ['2026', [{ ...activities[0], summary_polyline: null }]],
    ['2025', [{ ...activities[2], summary_polyline: 'encoded-2025-route' }]],
    ['2024', [{ ...activities[3], summary_polyline: 'encoded-2024-route' }]],
  ]);

  const activitiesByRecency = getMatchingActivitiesByRecency({
    activities,
    item: 'Morning run',
    matches: (activity, item) => activity.name === item,
  });
  const selected = await findLatestRoutedActivity({
    activitiesByRecency,
    loadYear: async (year) => {
      loadedYears.push(year);
      return routesByYear.get(year) ?? [];
    },
  });

  assert.equal(selected?.run_id, 'newest-routed-match');
  assert.deepEqual(loadedYears, ['2026', '2025']);
});

test('activity switch stays on the same origin and preserves route context', async () => {
  const { MemoryRouter, Route, Routes } = await import('react-router-dom');
  const { ActivityModeProvider } = await vite.ssrLoadModule(
    '/src/modules/activity/ActivityModeProvider.tsx'
  );
  const { default: Header } = await vite.ssrLoadModule(
    '/src/components/Header/index.tsx'
  );

  const html = renderToStaticMarkup(
    React.createElement(
      MemoryRouter,
      { initialEntries: ['/cycling?year=2025&view=map#run_42'] },
      React.createElement(
        Routes,
        null,
        React.createElement(Route, {
          path: '/:activityMode',
          element: React.createElement(
            ActivityModeProvider,
            null,
            React.createElement(Header)
          ),
        })
      )
    )
  );
  const dom = new JSDOM(html, { url: 'https://records.example/cycling' });

  try {
    const switchNav = dom.window.document.querySelector(
      'nav[aria-label="运动类型"]'
    );
    const links = [...(switchNav?.querySelectorAll('a') ?? [])];
    const running = links.find((link) => link.textContent?.trim() === '跑步');
    const cycling = links.find((link) => link.textContent?.trim() === '骑行');

    assert.ok(switchNav);
    assert.equal(
      running?.getAttribute('href'),
      '/running?year=2025&view=map#run_42'
    );
    assert.equal(
      cycling?.getAttribute('href'),
      '/cycling?year=2025&view=map#run_42'
    );
    assert.equal(running?.hasAttribute('aria-current'), false);
    assert.equal(cycling?.getAttribute('aria-current'), 'page');
    assert.equal(
      links.every((link) => !/^https?:\/\//.test(link.getAttribute('href'))),
      true
    );
  } finally {
    dom.window.close();
  }
});

test('activity metrics follow the runtime route instead of a build-time mode', async () => {
  const { MemoryRouter, Route, Routes } = await import('react-router-dom');
  const { ActivityModeProvider } = await vite.ssrLoadModule(
    '/src/modules/activity/ActivityModeProvider.tsx'
  );
  const { default: RunTable } = await vite.ssrLoadModule(
    '/src/components/RunTable/index.tsx'
  );
  const activity = {
    run_id: 7,
    name: 'Morning ride',
    distance: 24_000,
    moving_time: '01:00:00',
    type: 'Ride',
    start_date_local: '2026-07-25 08:00:00',
    location_country: 'China',
    summary_polyline: null,
    average_heartrate: 130,
    average_speed: 6.6667,
    elevation_gain: 120,
  };

  const renderForMode = (mode) =>
    renderToStaticMarkup(
      React.createElement(
        MemoryRouter,
        { initialEntries: [`/${mode}`] },
        React.createElement(
          Routes,
          null,
          React.createElement(Route, {
            path: '/:activityMode',
            element: React.createElement(
              ActivityModeProvider,
              null,
              React.createElement(RunTable, {
                runs: [activity],
                locateActivity: () => {},
                runIndex: -1,
                setRunIndex: () => {},
              })
            ),
          })
        )
      )
    );

  const cycling = new JSDOM(renderForMode('cycling'));
  const running = new JSDOM(renderForMode('running'));
  try {
    assert.match(
      cycling.window.document.querySelector('table').textContent,
      /Speed/
    );
    assert.match(
      cycling.window.document.querySelector('tbody').textContent,
      /24\.0/
    );
    assert.match(
      running.window.document.querySelector('table').textContent,
      /Pace/
    );
  } finally {
    cycling.window.close();
    running.window.close();
  }
});

test('publication CLI creates deterministic namespaced metadata and yearly routes', async () => {
  const fixtureDir = await mkdtemp(join(tmpdir(), 'activity-publication-'));
  const inputPath = join(fixtureDir, 'activities.json');
  const outputPath = join(fixtureDir, 'public-data');
  const input = [
    {
      run_id: 1,
      name: 'Morning ride',
      distance: 24000,
      moving_time: '1:00:00',
      type: 'Ride',
      subtype: 'cycling',
      start_date: '2025-06-01 00:00:00',
      start_date_local: '2025-06-01 08:00:00',
      location_country: 'China',
      summary_polyline: 'encoded-2025',
      average_heartrate: 130,
      average_speed: 6.6,
      elevation_gain: 120,
      streak: 1,
    },
    {
      run_id: 2,
      name: 'Long ride',
      distance: 52000,
      moving_time: '2:00:00',
      type: 'cycling',
      subtype: 'cycling',
      start_date: '2026-07-01 00:00:00',
      start_date_local: '2026-07-01 08:00:00',
      location_country: 'China',
      summary_polyline: 'encoded-2026',
      average_heartrate: null,
      average_speed: 7.2,
      elevation_gain: 300,
      streak: 2,
    },
  ];

  try {
    await writeFile(inputPath, JSON.stringify(input));
    const args = [
      'scripts/publish-activity-data.mjs',
      '--mode',
      'cycling',
      '--input',
      inputPath,
      '--output',
      outputPath,
      '--published-at',
      '2026-07-26T12:30:00.000Z',
    ];
    const first = spawnSync(process.execPath, args, {
      cwd: process.cwd(),
      encoding: 'utf8',
    });
    assert.equal(first.status, 0, first.stderr || first.stdout);

    const metadataPath = join(outputPath, 'cycling', 'metadata.json');
    const route2025Path = join(outputPath, 'cycling', 'routes', '2025.json');
    const route2026Path = join(outputPath, 'cycling', 'routes', '2026.json');
    const manifestPath = join(outputPath, 'cycling', 'manifest.json');
    const [metadataText, route2025Text, route2026Text, manifestText] =
      await Promise.all([
        readFile(metadataPath, 'utf8'),
        readFile(route2025Path, 'utf8'),
        readFile(route2026Path, 'utf8'),
        readFile(manifestPath, 'utf8'),
      ]);

    const metadata = JSON.parse(metadataText);
    const route2025 = JSON.parse(route2025Text);
    const route2026 = JSON.parse(route2026Text);
    const manifest = JSON.parse(manifestText);

    assert.equal(metadata.length, 2);
    assert.equal(
      metadata.every(
        (activity) =>
          !Object.prototype.hasOwnProperty.call(activity, 'summary_polyline')
      ),
      true
    );
    assert.deepEqual(route2025, [
      { run_id: '1', summary_polyline: 'encoded-2025' },
    ]);
    assert.deepEqual(route2026, [
      { run_id: '2', summary_polyline: 'encoded-2026' },
    ]);
    assert.deepEqual(manifest.years, ['2026', '2025']);
    assert.equal(manifest.latestYear, '2026');
    assert.equal(manifest.activityCount, 2);
    assert.equal(manifest.mode, 'cycling');
    assert.match(manifest.checksum, /^[a-f0-9]{64}$/);

    const second = spawnSync(process.execPath, args, {
      cwd: process.cwd(),
      encoding: 'utf8',
    });
    assert.equal(second.status, 0, second.stderr || second.stdout);
    assert.equal(await readFile(metadataPath, 'utf8'), metadataText);
    assert.equal(await readFile(route2025Path, 'utf8'), route2025Text);
    assert.equal(await readFile(route2026Path, 'utf8'), route2026Text);
    assert.equal(await readFile(manifestPath, 'utf8'), manifestText);
  } finally {
    await rm(fixtureDir, { recursive: true, force: true });
  }
});

test('activity repository fetches only the selected mode and caches yearly routes', async () => {
  const { createActivityDataRepository } = await vite.ssrLoadModule(
    '/src/modules/activity/activityData.ts'
  );
  const stableJson = (value) => `${JSON.stringify(value)}\n`;
  const checksum = (text) => createHash('sha256').update(text).digest('hex');
  const calls = [];
  const responses = new Map();
  const addModeResponses = (mode, metadata, routes) => {
    const metadataText = stableJson(metadata);
    const routeText = stableJson(routes);
    const metadataChecksum = checksum(metadataText);
    const routeChecksum = checksum(routeText);
    const manifest = {
      schemaVersion: 1,
      mode,
      activityCount: metadata.length,
      publishedAt: '2026-07-26T12:30:00.000Z',
      latestActivityDate: metadata[0].start_date_local,
      latestYear: '2026',
      years: ['2026'],
      routeCount: routes.filter((route) => route.summary_polyline).length,
      routeRatio:
        routes.filter((route) => route.summary_polyline).length /
        metadata.length,
      checksum: '1'.repeat(64),
      artifactChecksum: '2'.repeat(64),
      metadataChecksum,
      routeChecksums: { 2026: routeChecksum },
      source: `${mode}.json`,
    };
    const manifestPath = `/data/${mode}/manifest.json`;
    const metadataPath = `/data/${mode}/metadata.json?v=${metadataChecksum}`;
    const routePath = `/data/${mode}/routes/2026.json?v=${routeChecksum}`;
    responses.set(manifestPath, stableJson(manifest));
    responses.set(metadataPath, metadataText);
    responses.set(routePath, routeText);
    return { manifestPath, metadataPath, routePath };
  };

  const cyclingPaths = addModeResponses(
    'cycling',
    [
      {
        run_id: '9223370455437879701',
        type: 'Ride',
        start_date_local: '2026-07-25 08:00:00',
        distance: 24000,
      },
    ],
    [
      {
        run_id: '9223370455437879701',
        summary_polyline: 'cycling-route',
      },
    ]
  );
  const runningPaths = addModeResponses(
    'running',
    [
      {
        run_id: '8',
        type: 'Run',
        start_date_local: '2026-07-25 09:00:00',
        distance: 5000,
      },
    ],
    [{ run_id: '8', summary_polyline: 'running-route' }]
  );
  const fetcher = async (url) => {
    calls.push(url);
    if (!responses.has(url)) return new Response('', { status: 404 });
    return new Response(responses.get(url), {
      headers: { 'content-type': 'application/json' },
    });
  };
  const repository = createActivityDataRepository({
    baseUrl: '/data',
    fetcher,
  });

  const first = await repository.loadActivities('cycling', ['2026']);
  const second = await repository.loadActivities('cycling', ['2026']);

  assert.equal(first[0].summary_polyline, 'cycling-route');
  assert.equal(first[0].run_id, '9223370455437879701');
  assert.deepEqual(second, first);
  assert.deepEqual(calls, Object.values(cyclingPaths));
  assert.equal(
    calls.some((url) => url.includes('/running/')),
    false
  );

  const running = await repository.loadActivities('running', ['2026']);
  assert.equal(running[0].summary_polyline, 'running-route');
  assert.equal(running[0].run_id, '8');
  assert.deepEqual(calls.slice(3), Object.values(runningPaths));
});

test('activity repository rejects a payload that does not match its manifest checksum', async () => {
  const { createActivityDataRepository } = await vite.ssrLoadModule(
    '/src/modules/activity/activityData.ts'
  );
  const metadataChecksum = 'a'.repeat(64);
  const manifest = {
    schemaVersion: 1,
    mode: 'running',
    activityCount: 1,
    publishedAt: '2026-07-26T12:30:00.000Z',
    latestActivityDate: '2026-07-25 09:00:00',
    latestYear: '2026',
    years: ['2026'],
    routeCount: 1,
    routeRatio: 1,
    checksum: '1'.repeat(64),
    artifactChecksum: '2'.repeat(64),
    metadataChecksum,
    routeChecksums: { 2026: '3'.repeat(64) },
    source: 'running.json',
  };
  const fetcher = async (url) =>
    new Response(
      url.endsWith('/manifest.json') ? `${JSON.stringify(manifest)}\n` : '[]\n',
      { headers: { 'content-type': 'application/json' } }
    );
  const repository = createActivityDataRepository({
    baseUrl: '/data',
    fetcher,
  });

  await assert.rejects(
    repository.loadMetadata('running'),
    /metadata\.json checksum does not match its manifest/
  );
});

test('activity repository aborts a stalled request within its recovery budget', async () => {
  const { createActivityDataRepository } = await vite.ssrLoadModule(
    '/src/modules/activity/activityData.ts'
  );
  const fetcher = (_url, init = {}) =>
    new Promise((_resolve, reject) => {
      init.signal?.addEventListener('abort', () => reject(init.signal.reason), {
        once: true,
      });
    });
  const repository = createActivityDataRepository({
    baseUrl: '/data',
    fetcher,
    requestTimeoutMs: 20,
  });
  const startedAt = performance.now();

  await assert.rejects(
    repository.loadMetadata('running'),
    /timed out|timeout|abort/i
  );
  assert.ok(performance.now() - startedAt < 500);
});

test('the map implementation is split out of the initial page module', async () => {
  const pageSource = await readFile('src/pages/index.tsx', 'utf8');

  assert.doesNotMatch(
    pageSource,
    /import\s+RunMap\s+from\s+['"]@\/components\/RunMap['"]/
  );
  assert.match(
    pageSource,
    /lazy\(\(\)\s*=>\s*import\(['"]@\/components\/RunMap['"]\)\)/
  );
  assert.match(pageSource, /<Suspense[\s\S]*<RunMap/);
});

test('resource budget CLI checks route-critical chunks and initial activity data', async () => {
  const fixtureDir = await mkdtemp(join(tmpdir(), 'activity-budgets-'));
  const distDir = join(fixtureDir, 'dist');
  const dataDir = join(fixtureDir, 'data');
  const assetsDir = join(distDir, 'assets');
  const manifestDir = join(distDir, '.vite');
  const manifest = {
    'index.html': {
      file: 'assets/entry.js',
      isEntry: true,
      imports: ['_shared.js'],
      css: ['assets/entry.css'],
    },
    '_shared.js': { file: 'assets/shared.js' },
    'src/pages/index.tsx': {
      file: 'assets/page.js',
      isDynamicEntry: true,
      imports: ['index.html'],
      dynamicImports: ['src/components/RunMap/index.tsx'],
    },
    'src/pages/total.tsx': {
      file: 'assets/summary.js',
      isDynamicEntry: true,
      imports: ['index.html'],
    },
    'src/components/RunMap/index.tsx': {
      file: 'assets/mapbox.js',
      isDynamicEntry: true,
    },
  };

  try {
    await Promise.all([
      mkdir(assetsDir, { recursive: true }),
      mkdir(manifestDir, { recursive: true }),
      ...['running', 'cycling'].flatMap((mode) => [
        mkdir(join(dataDir, mode, 'routes'), { recursive: true }),
      ]),
    ]);
    await Promise.all([
      writeFile(join(manifestDir, 'manifest.json'), JSON.stringify(manifest)),
      writeFile(join(distDir, 'index.html'), '<main>records</main>'),
      writeFile(join(assetsDir, 'entry.js'), 'entry'),
      writeFile(join(assetsDir, 'entry.css'), 'css'),
      writeFile(join(assetsDir, 'shared.js'), 'shared'),
      writeFile(join(assetsDir, 'page.js'), 'page'),
      writeFile(join(assetsDir, 'summary.js'), 'summary'),
      writeFile(join(assetsDir, 'mapbox.js'), randomBytes(400_000)),
      ...['running', 'cycling'].flatMap((mode) => [
        writeFile(
          join(dataDir, mode, 'manifest.json'),
          JSON.stringify({ latestYear: '2026' })
        ),
        writeFile(join(dataDir, mode, 'metadata.json'), '[]'),
        writeFile(join(dataDir, mode, 'routes', '2026.json'), '[]'),
      ]),
    ]);

    const args = [
      'scripts/check-resource-budgets.mjs',
      '--dist',
      distDir,
      '--data',
      dataDir,
      '--critical-budget',
      '350000',
      '--activity-budget',
      '30000',
    ];
    const passing = spawnSync(process.execPath, args, {
      cwd: process.cwd(),
      encoding: 'utf8',
    });
    assert.equal(passing.status, 0, passing.stderr || passing.stdout);
    assert.match(passing.stdout, /mapbox.*dynamic/i);

    await writeFile(
      join(dataDir, 'running', 'metadata.json'),
      randomBytes(40_000)
    );
    const failing = spawnSync(process.execPath, args, {
      cwd: process.cwd(),
      encoding: 'utf8',
    });
    assert.notEqual(failing.status, 0);
    assert.match(failing.stderr, /running.*30000/i);
  } finally {
    await rm(fixtureDir, { recursive: true, force: true });
  }
});
