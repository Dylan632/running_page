import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { after, before, test } from 'node:test';
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

const activity = (overrides = {}) => ({
  run_id: 1,
  name: 'Morning ride',
  distance: 24_000,
  moving_time: '1:00:00',
  type: 'Ride',
  subtype: 'outdoor',
  start_date: '2026-07-25 00:00:00',
  start_date_local: '2026-07-25 08:00:00',
  location_country: 'China',
  summary_polyline: 'encoded-route',
  average_heartrate: 130,
  average_speed: 6.6,
  elevation_gain: 120,
  ...overrides,
});

test('runtime and publication consume one shared activity profile source', async () => {
  const rawProfiles = JSON.parse(
    await readFile('src/modules/activity/activity-profiles.json', 'utf8')
  );
  const { getActivityProfile } = await vite.ssrLoadModule(
    '/src/modules/activity/profiles.ts'
  );

  for (const mode of ['running', 'cycling']) {
    const runtime = getActivityProfile(mode);
    const shared = rawProfiles.profiles[mode];

    assert.deepEqual([...runtime.activityTypes], shared.activityTypes);
    assert.equal(
      runtime.poster.specialDistance,
      shared.poster.specialDistancesKm[0]
    );
    assert.equal(
      runtime.poster.specialDistance2,
      shared.poster.specialDistancesKm[1]
    );
    assert.equal(runtime.poster.outputNamespace, shared.poster.outputNamespace);
  }
});

test('publication validates a complete candidate before atomically replacing a mode', async () => {
  const fixtureDir = await mkdtemp(join(tmpdir(), 'publication-atomic-'));
  const inputPath = join(fixtureDir, 'activities.json');
  const outputPath = join(fixtureDir, 'data');
  const args = [
    'scripts/publish-activity-data.mjs',
    '--mode',
    'cycling',
    '--input',
    inputPath,
    '--output',
    outputPath,
    '--published-at',
    '2026-07-26T10:30:00.000Z',
  ];

  try {
    await writeFile(inputPath, JSON.stringify([activity()]));
    const first = spawnSync(process.execPath, args, {
      cwd: process.cwd(),
      encoding: 'utf8',
    });
    assert.equal(first.status, 0, first.stderr || first.stdout);

    const modeDir = join(outputPath, 'cycling');
    const metadataPath = join(modeDir, 'metadata.json');
    const manifestPath = join(modeDir, 'manifest.json');
    const beforeMetadata = await readFile(metadataPath, 'utf8');
    const beforeManifest = await readFile(manifestPath, 'utf8');
    const metadata = JSON.parse(beforeMetadata);
    const manifest = JSON.parse(beforeManifest);

    assert.equal(Object.hasOwn(metadata[0], 'summary_polyline'), false);
    assert.equal(Object.hasOwn(metadata[0], 'start_date'), false);
    assert.equal(metadata[0].subtype, 'outdoor');
    assert.equal(manifest.routeRatio, 1);
    assert.equal(manifest.publishedAt, '2026-07-26T10:30:00.000Z');
    assert.match(manifest.metadataChecksum, /^[a-f0-9]{64}$/);
    assert.match(manifest.routeChecksums['2026'], /^[a-f0-9]{64}$/);

    await writeFile(
      inputPath,
      JSON.stringify([activity({ start_date_local: '2026-02-30 08:00:00' })])
    );
    const invalid = spawnSync(process.execPath, args, {
      cwd: process.cwd(),
      encoding: 'utf8',
    });
    assert.notEqual(invalid.status, 0);
    assert.match(invalid.stderr, /invalid start_date_local/i);
    assert.equal(await readFile(metadataPath, 'utf8'), beforeMetadata);
    assert.equal(await readFile(manifestPath, 'utf8'), beforeManifest);
  } finally {
    await rm(fixtureDir, { recursive: true, force: true });
  }
});

test('publication rejects missing, invalid, or non-UTC publication timestamps', async () => {
  const fixtureDir = await mkdtemp(join(tmpdir(), 'publication-timestamp-'));
  const inputPath = join(fixtureDir, 'activities.json');
  const baseArgs = [
    'scripts/publish-activity-data.mjs',
    '--mode',
    'cycling',
    '--input',
    inputPath,
    '--output',
    join(fixtureDir, 'data'),
  ];

  try {
    await writeFile(inputPath, JSON.stringify([activity()]));
    for (const publishedAt of [
      undefined,
      'not-a-date',
      '2026-07-26T18:30:00+08:00',
    ]) {
      const result = spawnSync(
        process.execPath,
        publishedAt ? [...baseArgs, '--published-at', publishedAt] : baseArgs,
        {
          cwd: process.cwd(),
          encoding: 'utf8',
        }
      );
      assert.notEqual(result.status, 0);
      assert.match(result.stderr, /published-at/i);
    }
  } finally {
    await rm(fixtureDir, { recursive: true, force: true });
  }
});

test('poster assets are selected by mode and remain lazy', async () => {
  const { getPosterAssets } = await vite.ssrLoadModule('/assets/index.tsx');
  const svgStatSource = await readFile(
    'src/components/SVGStat/index.tsx',
    'utf8'
  );

  const running = getPosterAssets('running');
  const cycling = getPosterAssets('cycling');

  assert.ok(running.totalStat['./running/github.svg']);
  assert.equal(
    Object.keys(running.all).every((path) => path.startsWith('./running/')),
    true
  );
  assert.equal(
    Object.keys(cycling.all).every((path) => path.startsWith('./cycling/')),
    true
  );
  assert.equal(
    Object.values(running.totalStat).every(
      (loader) => typeof loader === 'function'
    ),
    true
  );
  assert.doesNotMatch(
    svgStatSource,
    /setTimeout|initSvgColorAdjustments|useEffect/
  );
  assert.match(svgStatSource, /getPosterComponents\(mode\)/);
});

test('poster generators emit stable semantic roles and solid legend squares', async () => {
  const [poster, grid, github] = await Promise.all([
    readFile('run_page/gpxtrackposter/poster.py', 'utf8'),
    readFile('run_page/gpxtrackposter/grid_drawer.py', 'utf8'),
    readFile('run_page/gpxtrackposter/github_drawer.py', 'utf8'),
  ]);

  assert.match(poster, /data-poster-role/);
  assert.match(poster, /poster-legend-swatch/);
  assert.match(poster, /\(2\.6,\s*2\.6\)/);
  assert.match(poster, /stroke="none"/);
  assert.match(grid, /run_id=tr\.run_id/);
  assert.match(grid, /poster-route/);
  assert.match(grid, /svg-special-stroke/);
  assert.match(github, /"calendar-cell"/);
  assert.match(github, /svg-color-inactive-cell/);
  assert.match(github, /svg-color-active-cell/);
  assert.match(github, /svg-special-fill/);
});
