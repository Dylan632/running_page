import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, test } from 'node:test';

const temporaryDirectories = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

const createTemporaryDirectory = () => {
  const directory = mkdtempSync(join(tmpdir(), 'activity-snapshot-'));
  temporaryDirectories.push(directory);
  return directory;
};

const writeActivities = (path, activities) => {
  writeFileSync(path, JSON.stringify(activities), 'utf8');
};

const runSnapshot = (...args) =>
  spawnSync('python3', ['run_page/activity_snapshot.py', ...args], {
    cwd: process.cwd(),
    encoding: 'utf8',
  });

const createDatabase = (path, activities) => {
  const result = spawnSync(
    'python3',
    [
      '-c',
      `
import json
import sqlite3
import sys

database_path, activities_json = sys.argv[1:]
activities = json.loads(activities_json)
connection = sqlite3.connect(database_path)
connection.execute(
    "CREATE TABLE activities (run_id INTEGER PRIMARY KEY, distance FLOAT, start_date VARCHAR)"
)
connection.executemany(
    "INSERT INTO activities (run_id, distance, start_date) VALUES (?, ?, ?)",
    [
        (activity["run_id"], activity["distance"], activity["start_date"])
        for activity in activities
    ],
)
connection.commit()
connection.close()
      `,
      path,
      JSON.stringify(activities),
    ],
    { encoding: 'utf8' }
  );
  assert.equal(result.status, 0, result.stderr || result.stdout);
};

test('an incomplete candidate cannot replace the last-known-good snapshot', () => {
  const directory = createTemporaryDirectory();
  const liveJson = join(directory, 'activities.json');
  const candidateJson = join(directory, 'candidate.json');
  const metadata = join(directory, 'metadata.json');
  const knownGood = [
    {
      run_id: 101,
      type: 'Ride',
      distance: 21000,
      start_date: '2026-07-20 08:00:00',
    },
    {
      run_id: 102,
      type: 'Ride',
      distance: 25000,
      start_date: '2026-07-21 08:00:00',
    },
  ];
  writeActivities(liveJson, knownGood);
  writeActivities(candidateJson, [knownGood[0]]);

  const result = runSnapshot(
    'publish',
    '--candidate-json',
    candidateJson,
    '--target-json',
    liveJson,
    '--metadata',
    metadata
  );

  assert.notEqual(result.status, 0, 'a regressed snapshot must be rejected');
  assert.match(result.stderr, /activity count regressed from 2 to 1/i);
  assert.deepEqual(JSON.parse(readFileSync(liveJson, 'utf8')), knownGood);
});

test('an equal-sized candidate cannot replace existing activity ids', () => {
  const directory = createTemporaryDirectory();
  const liveJson = join(directory, 'activities.json');
  const candidateJson = join(directory, 'candidate.json');
  const metadata = join(directory, 'metadata.json');
  const knownGood = [
    {
      run_id: 101,
      type: 'Ride',
      distance: 21000,
      start_date: '2026-07-20 08:00:00',
    },
    {
      run_id: 102,
      type: 'Ride',
      distance: 25000,
      start_date: '2026-07-21 08:00:00',
    },
  ];
  writeActivities(liveJson, knownGood);
  writeActivities(candidateJson, [
    { ...knownGood[0], run_id: 201 },
    {
      ...knownGood[1],
      run_id: 202,
      start_date: '2026-07-22 08:00:00',
    },
  ]);

  const result = runSnapshot(
    'publish',
    '--candidate-json',
    candidateJson,
    '--target-json',
    liveJson,
    '--metadata',
    metadata
  );

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /dropped previous run_ids.*101.*102/i);
  assert.deepEqual(JSON.parse(readFileSync(liveJson, 'utf8')), knownGood);
});

test('a candidate whose latest activity moved backwards is rejected', () => {
  const directory = createTemporaryDirectory();
  const liveJson = join(directory, 'activities.json');
  const candidateJson = join(directory, 'candidate.json');
  const metadata = join(directory, 'metadata.json');
  const knownGood = [
    {
      run_id: 101,
      type: 'Run',
      distance: 5000,
      start_date: '2026-07-20 08:00:00',
    },
  ];
  writeActivities(liveJson, knownGood);
  writeActivities(candidateJson, [
    {
      ...knownGood[0],
      start_date: '2026-07-19 08:00:00',
    },
  ]);

  const result = runSnapshot(
    'publish',
    '--candidate-json',
    candidateJson,
    '--target-json',
    liveJson,
    '--metadata',
    metadata
  );

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /latest activity date regressed/i);
  assert.deepEqual(JSON.parse(readFileSync(liveJson, 'utf8')), knownGood);
});

test('validation rejects a JSON and SQLite snapshot with different activities', () => {
  const directory = createTemporaryDirectory();
  const jsonPath = join(directory, 'activities.json');
  const databasePath = join(directory, 'data.db');
  const metadata = join(directory, 'metadata.json');
  const jsonActivities = [
    {
      run_id: 201,
      type: 'Ride',
      distance: 22000,
      start_date: '2026-07-24 08:00:00',
    },
  ];
  writeActivities(jsonPath, jsonActivities);
  createDatabase(databasePath, [
    {
      ...jsonActivities[0],
      run_id: 999,
    },
  ]);

  const result = runSnapshot(
    'validate',
    '--json',
    jsonPath,
    '--db',
    databasePath,
    '--metadata',
    metadata
  );

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /JSON\/DB run_id mismatch/i);
});

test('published metadata can serve as the next run last-known-good snapshot', () => {
  const directory = createTemporaryDirectory();
  const candidateJson = join(directory, 'candidate.json');
  const previousMetadata = join(directory, 'metadata.json');
  const validationMetadata = join(directory, 'validation.json');
  const activity = {
    run_id: 301,
    type: 'Ride',
    distance: 22000,
    start_date: '2026-07-25 08:00:00',
    start_date_local: '2026-07-25 16:00:00',
  };
  writeActivities(candidateJson, [activity]);
  writeActivities(previousMetadata, [
    {
      run_id: activity.run_id,
      type: activity.type,
      distance: activity.distance,
      start_date_local: activity.start_date_local,
    },
  ]);

  const result = runSnapshot(
    'validate',
    '--json',
    candidateJson,
    '--previous-json',
    previousMetadata,
    '--metadata',
    validationMetadata
  );

  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.equal(JSON.parse(readFileSync(validationMetadata, 'utf8')).count, 1);
});
