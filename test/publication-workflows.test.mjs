import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

const runArtifacts = (args) =>
  spawnSync(
    process.execPath,
    ['scripts/generate-activity-artifacts.mjs', ...args],
    {
      cwd: process.cwd(),
      encoding: 'utf8',
    }
  );

test('artifact planner derives namespaced data and poster commands from the shared profile', async () => {
  const fixture = await mkdtemp(join(tmpdir(), 'activity-artifacts-plan-'));
  const input = join(fixture, 'activities.json');

  try {
    await writeFile(
      input,
      JSON.stringify([
        {
          run_id: 1,
          type: 'Ride',
          distance: 24_000,
          start_date_local: '2024-01-02 08:00:00',
        },
        {
          run_id: 2,
          type: 'VirtualRide',
          distance: 51_000,
          start_date_local: '2026-07-25 08:00:00',
        },
      ])
    );

    const result = runArtifacts([
      'plan',
      '--mode',
      'cycling',
      '--input',
      input,
      '--data-output',
      'public/data',
      '--assets-output',
      'assets',
      '--athlete',
      'Dylan',
      '--birth-month',
      '1989-03',
      '--published-at',
      '2026-07-26T10:30:00Z',
    ]);

    assert.equal(result.status, 0, result.stderr);
    const plan = JSON.parse(result.stdout);

    assert.equal(plan.mode, 'cycling');
    assert.equal(plan.namespace, 'cycling');
    assert.deepEqual(plan.years, ['2024', '2026']);
    assert.deepEqual(plan.publication.command.slice(0, 2), [
      process.execPath,
      'scripts/publish-activity-data.mjs',
    ]);
    assert.ok(plan.publication.command.includes('--profile'));
    assert.ok(plan.publication.command.includes('--mode'));
    assert.ok(plan.publication.command.includes('cycling'));
    assert.ok(plan.publication.command.includes('--published-at'));
    assert.ok(plan.publication.command.includes('2026-07-26T10:30:00.000Z'));

    const posterCommands = plan.posters.map(({ command }) => command);
    assert.ok(
      posterCommands.some(
        (command) =>
          command.includes('--title') &&
          command.includes("Dylan's Cycling Records") &&
          command.some((part) => part.endsWith('/cycling/github.svg'))
      )
    );
    assert.ok(
      posterCommands.some(
        (command) =>
          command.includes('--title') &&
          command.includes('Over 20km Rides') &&
          command.some((part) => part.endsWith('/cycling/grid.svg'))
      )
    );
    for (const command of posterCommands) {
      assert.ok(command.includes('--from-json'));
      assert.ok(command.includes(input));
      assert.equal(command.includes('--from-db'), false);
      for (const activityType of ['Ride', 'VirtualRide', 'cycling', 'Biking']) {
        assert.ok(command.includes(activityType));
      }
      assert.ok(command.includes('--exclude-run-id'));
      assert.ok(command.includes('9223370309063493807'));
      assert.ok(command.includes('--sport-type'));
      assert.ok(command.includes('cycling'));
      assert.ok(command.includes('--special-distance'));
      assert.ok(command.includes('20'));
      assert.ok(command.includes('--special-distance2'));
      assert.ok(command.includes('50'));
      assert.ok(command.includes('#ffa400'));
      assert.ok(command.includes('#ff0000'));
    }
    assert.equal(
      posterCommands.some((command) =>
        command.some((part) => part.includes('adjust-svg-header-layout'))
      ),
      false
    );
  } finally {
    await rm(fixture, { recursive: true, force: true });
  }
});

test('profile export supplies filter policy without duplicating it in workflow YAML', async () => {
  const fixture = await mkdtemp(join(tmpdir(), 'activity-profile-env-'));
  const environmentFile = join(fixture, 'github-env');

  try {
    const result = runArtifacts([
      'export-profile',
      '--mode',
      'cycling',
      '--github-env',
      environmentFile,
    ]);

    assert.equal(result.status, 0, result.stderr);
    const exported = await readFile(environmentFile, 'utf8');
    assert.match(exported, /^ACTIVITY_MIN_DISTANCE_METERS=10000$/m);
    assert.match(exported, /^ACTIVITY_TYPES=Ride VirtualRide cycling Biking$/m);
    assert.match(
      exported,
      /^ACTIVITY_EXCLUDE_RUN_IDS=.*9223370309063493807.*9223370308463553807$/m
    );
  } finally {
    await rm(fixture, { recursive: true, force: true });
  }
});

test('running poster plans exclude indoor subtypes from every generated asset', async () => {
  const fixture = await mkdtemp(join(tmpdir(), 'running-artifacts-plan-'));
  const input = join(fixture, 'activities.json');

  try {
    await writeFile(
      input,
      JSON.stringify([
        {
          run_id: 1,
          type: 'Run',
          subtype: 'Run',
          distance: 5_000,
          start_date_local: '2026-07-25 08:00:00',
        },
      ])
    );

    const result = runArtifacts([
      'plan',
      '--mode',
      'running',
      '--input',
      input,
      '--published-at',
      '2026-07-28T00:00:00Z',
    ]);

    assert.equal(result.status, 0, result.stderr);
    const plan = JSON.parse(result.stdout);
    for (const { command } of plan.posters) {
      for (const subtype of [
        'indoor',
        'treadmill',
        'virtualrun',
        'virtual_run',
      ]) {
        const subtypeIndex = command.indexOf(subtype);
        assert.ok(subtypeIndex > 0);
        assert.equal(command[subtypeIndex - 1], '--exclude-subtype');
      }
    }
  } finally {
    await rm(fixture, { recursive: true, force: true });
  }
});

test('generation publishes a complete mode only after data and posters validate', async () => {
  const fixture = await mkdtemp(join(tmpdir(), 'activity-artifacts-generate-'));
  const input = join(fixture, 'activities.json');
  const dataOutput = join(fixture, 'data');
  const assetsOutput = join(fixture, 'assets');
  const posterRunner = join(fixture, 'poster-runner.mjs');
  const failingRunner = join(fixture, 'failing-poster-runner.mjs');

  try {
    await writeFile(
      input,
      JSON.stringify([
        {
          run_id: 11,
          type: 'Ride',
          distance: 24_000,
          start_date_local: '2026-07-25 08:00:00',
          summary_polyline: 'encoded-route',
        },
      ])
    );
    await writeFile(
      posterRunner,
      `#!/usr/bin/env node
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
const args = process.argv.slice(2);
const value = (flag) => args[args.indexOf(flag) + 1];
const output = value('--output');
const type = value('--type');
let target = output;
if (type === 'circular') target = join(dirname(output), 'year_2026.svg');
if (type === 'year_summary') target = join(dirname(output), 'year_summary_2026.svg');
await mkdir(dirname(target), { recursive: true });
await writeFile(target, '<svg data-poster-role="poster"></svg>\\n');
`
    );
    await writeFile(failingRunner, '#!/usr/bin/env node\nprocess.exit(7);\n');
    await Promise.all([
      chmod(posterRunner, 0o755),
      chmod(failingRunner, 0o755),
    ]);

    const args = [
      'generate',
      '--mode',
      'cycling',
      '--input',
      input,
      '--data-output',
      dataOutput,
      '--assets-output',
      assetsOutput,
      '--python',
      posterRunner,
      '--published-at',
      '2026-07-26T10:30:00Z',
    ];
    const first = runArtifacts(args);
    assert.equal(first.status, 0, first.stderr || first.stdout);

    const metadataPath = join(dataOutput, 'cycling', 'metadata.json');
    const posterPath = join(assetsOutput, 'cycling', 'github.svg');
    const beforeMetadata = await readFile(metadataPath, 'utf8');
    const beforePoster = await readFile(posterPath, 'utf8');
    const manifest = JSON.parse(
      await readFile(join(dataOutput, 'cycling', 'manifest.json'), 'utf8')
    );
    assert.equal(JSON.parse(beforeMetadata)[0].run_id, '11');
    assert.equal(manifest.publishedAt, '2026-07-26T10:30:00.000Z');
    assert.match(beforePoster, /data-poster-role="poster"/);

    await writeFile(
      input,
      JSON.stringify([
        {
          run_id: 12,
          type: 'Ride',
          distance: 51_000,
          start_date_local: '2026-07-26 08:00:00',
          summary_polyline: 'replacement-route',
        },
      ])
    );
    const failed = runArtifacts([...args.slice(0, -1), failingRunner]);
    assert.notEqual(failed.status, 0);
    assert.equal(await readFile(metadataPath, 'utf8'), beforeMetadata);
    assert.equal(await readFile(posterPath, 'utf8'), beforePoster);
  } finally {
    await rm(fixture, { recursive: true, force: true });
  }
});

test('Pages is manual and defaults to a canonical redirect while full publication stays exact-SHA and last-known-good guarded', async () => {
  const [workflow, config] = await Promise.all([
    readFile('.github/workflows/gh-pages.yml', 'utf8'),
    readFile('run_page/config.py', 'utf8'),
  ]);

  assert.doesNotMatch(workflow, /^\s{2}push:\s*$/m);
  assert.match(workflow, /deployment_mode:/);
  assert.match(workflow, /default: redirect/);
  assert.match(workflow, /options:\s*\n\s+- redirect\s*\n\s+- full/);
  assert.match(workflow, /build-legacy-redirect\.mjs/);
  assert.match(workflow, /generate-activity-artifacts\.mjs verify/);
  assert.match(
    workflow,
    /ref: \$\{\{ inputs\.source_sha \|\| github\.sha \}\}/
  );
  assert.match(workflow, /pnpm run ci/);
  assert.doesNotMatch(workflow, /KEEP_MOBILE|KEEP_PASSWORD/);
  assert.doesNotMatch(workflow, /generate-activity-artifacts\.mjs generate/);

  for (const duplicatedLiteral of [
    /#ffa400/i,
    /#ff0000/i,
    /Dylan's Cycling Records/,
    /Over 20km Rides/,
    /CYCLING_NO_TRACK_RUN_IDS/,
    /VITE_ACTIVITY_MODE/,
    /adjust-svg-header-layout/,
  ]) {
    assert.doesNotMatch(workflow, duplicatedLiteral);
  }
});

test('activity sync publishes Hiking with the other modes and dispatches exact-SHA CI', async () => {
  const [workflow, config] = await Promise.all([
    readFile('.github/workflows/run_data_sync.yml', 'utf8'),
    readFile('run_page/config.py', 'utf8'),
  ]);

  assert.doesNotMatch(workflow, /pages_mode:/);
  assert.doesNotMatch(workflow, /^\s{2}publish_pages:\s*$/m);
  assert.match(workflow, /KEEP_MOBILE/);
  assert.match(workflow, /KEEP_PASSWORD/);
  assert.match(workflow, /activity_snapshot\.py validate/);
  assert.match(workflow, /python run_page\/write_taihu_manual_gpx\.py/);
  assert.doesNotMatch(
    config,
    /_prepare_manual_taihu_gpx|write_taihu_manual_gpx/
  );
  assert.match(workflow, /generate-activity-artifacts\.mjs generate/);
  assert.match(workflow, /PUBLICATION_TIMESTAMP="\$\(date -u/);
  assert.equal(
    (workflow.match(/--published-at "\$PUBLICATION_TIMESTAMP"/g) ?? []).length,
    3
  );
  assert.match(workflow, /--mode running/);
  assert.match(workflow, /--mode cycling/);
  assert.match(workflow, /--mode hiking/);
  assert.match(workflow, /--sync-types hiking/);
  assert.match(workflow, /Sync manual GPX cycling data/);
  assert.match(workflow, /Backfill missing historical cycling tracks/);
  assert.match(workflow, /\.activity-last-known-good\/running/);
  assert.match(workflow, /\.activity-last-known-good\/cycling/);
  assert.match(workflow, /\.activity-last-known-good\/hiking/);
  assert.match(
    workflow,
    /if \[ -f public\/data\/hiking\/metadata\.json \]; then[\s\S]*HIKING_PREVIOUS_SNAPSHOT/
  );
  assert.match(
    workflow,
    /if \[\[ -n "\$\{HIKING_PREVIOUS_SNAPSHOT:-\}" \]\]; then[\s\S]*--previous-json/
  );
  assert.match(workflow, /source_sha=\$\(git rev-parse HEAD\)/);
  assert.match(workflow, /actions\/workflows\/ci\.yml\/dispatches/);
  assert.match(workflow, /steps\.push\.outputs\.changed == 'true'/);
  assert.match(
    workflow,
    /Wait for exact-SHA CI and dispatch Vercel production/
  );
  assert.match(workflow, /actions\/workflows\/ci\.yml\/runs/);
  assert.match(
    workflow,
    /actions\/workflows\/vercel-production\.yml\/dispatches/
  );
  assert.ok(
    workflow.indexOf('actions/workflows/ci.yml/dispatches') <
      workflow.indexOf('actions/workflows/ci.yml/runs')
  );
  assert.ok(
    workflow.indexOf('actions/workflows/ci.yml/runs') <
      workflow.indexOf('actions/workflows/vercel-production.yml/dispatches')
  );
  assert.doesNotMatch(workflow, /#ffa400/i);
  assert.doesNotMatch(workflow, /#ff0000/i);
  assert.doesNotMatch(workflow, /Dylan's Running Records/);
  assert.doesNotMatch(workflow, /Over 10km Runs/);
});

test('daily data publication validates all modes and makes one atomic source commit', async () => {
  const workflow = await readFile(
    '.github/workflows/run_data_sync.yml',
    'utf8'
  );

  assert.match(workflow, /schedule:\s*\n\s+- cron:/);
  assert.equal((workflow.match(/\bgit commit\b/g) ?? []).length, 1);
  assert.equal(
    (workflow.match(/PUBLICATION_TIMESTAMP="\$\(date -u/g) ?? []).length,
    1
  );
  assert.ok(
    workflow.indexOf('--mode running') < workflow.indexOf('--mode cycling')
  );
  assert.ok(
    workflow.indexOf('--mode cycling') < workflow.indexOf('--mode hiking')
  );
  assert.ok(
    workflow.indexOf('generate-activity-artifacts.mjs verify') <
      workflow.indexOf('git commit')
  );
  assert.ok(
    workflow.indexOf('activity_snapshot.py validate') <
      workflow.indexOf('--mode running')
  );
  assert.equal(
    (workflow.match(/activity_snapshot\.py validate/g) ?? []).length,
    3
  );
  assert.match(
    workflow,
    /git add public\/data\/running public\/data\/cycling public\/data\/hiking[\s\\\n]+assets\/running assets\/cycling assets\/hiking/
  );
  assert.match(
    workflow,
    /\$\{\{ runner\.temp \}\}\/hiking-activity-snapshot\.json/
  );
});

test('application build is pure and artifact generation is an explicit command', async () => {
  const { scripts } = JSON.parse(await readFile('package.json', 'utf8'));
  const joyrunSync = await readFile('run_page/joyrun_sync.py', 'utf8');
  const dockerfile = await readFile('Dockerfile', 'utf8');

  assert.equal(scripts.build, 'vite build');
  assert.equal(
    scripts['artifacts:generate'],
    'node scripts/generate-activity-artifacts.mjs generate'
  );
  assert.equal(scripts['data:analysis'], undefined);
  assert.doesNotMatch(scripts.ci, /adjust-svg-header-layout/);
  assert.match(joyrunSync, /scripts\/generate-activity-artifacts\.mjs/);
  assert.doesNotMatch(joyrunSync, /run_page\/gen_svg\.py/);
  assert.doesNotMatch(
    joyrunSync,
    /assets\/(?:github|grid|mol|year(?:_summary)?)/
  );
  assert.match(dockerfile, /scripts\/generate-activity-artifacts\.mjs/);
  assert.doesNotMatch(dockerfile, /run_page\/gen_svg\.py/);
  assert.doesNotMatch(
    dockerfile,
    /assets\/(?:github|grid|mol|year(?:_summary)?)/
  );
});
