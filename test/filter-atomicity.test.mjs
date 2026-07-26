import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

test('filter failure leaves the complete last-known-good snapshot untouched', (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'activity-filter-'));
  t.after(() => rmSync(directory, { force: true, recursive: true }));
  const jsonPath = join(directory, 'activities.json');
  const databasePath = join(directory, 'data.db');
  const activities = [
    {
      run_id: 1,
      type: 'Ride',
      distance: 25000,
      start_date: '2026-07-24 08:00:00',
    },
    {
      run_id: 2,
      type: 'Run',
      distance: 5000,
      start_date: '2026-07-25 08:00:00',
    },
  ];
  writeFileSync(jsonPath, JSON.stringify(activities), 'utf8');
  const databaseResult = spawnSync(
    'python3',
    [
      '-c',
      `
import sqlite3
import sys
connection = sqlite3.connect(sys.argv[1])
connection.execute("CREATE TABLE wrong_table (run_id INTEGER PRIMARY KEY)")
connection.commit()
connection.close()
      `,
      databasePath,
    ],
    { encoding: 'utf8' }
  );
  assert.equal(
    databaseResult.status,
    0,
    databaseResult.stderr || databaseResult.stdout
  );

  const result = spawnSync(
    'python3',
    [
      'run_page/filter_activity_data.py',
      '--json-file',
      jsonPath,
      '--db-file',
      databasePath,
      '--types',
      'Ride',
      '--min-distance',
      '10000',
    ],
    { cwd: process.cwd(), encoding: 'utf8' }
  );

  assert.notEqual(
    result.status,
    0,
    'the invalid database must fail the filter'
  );
  assert.deepEqual(JSON.parse(readFileSync(jsonPath, 'utf8')), activities);
});
