import assert from 'node:assert/strict';
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
  name: 'Activity',
  distance: 10_000,
  moving_time: '01:00:00',
  type: 'Run',
  subtype: 'generic',
  start_date_local: '2025-01-01 08:00:00',
  average_heartrate: 120,
  elevation_gain: 100,
  average_speed: 2.78,
  streak: 2,
  ...overrides,
});

test('one insights module owns weighted totals, averages, maxima, and missing values', async () => {
  const { summarizeActivities } = await vite.ssrLoadModule(
    '/src/modules/activity/insights.ts'
  );
  const insights = summarizeActivities(
    [
      activity(),
      activity({
        run_id: 2,
        moving_time: '00:30:00',
        average_heartrate: null,
        elevation_gain: null,
        streak: 5,
      }),
    ],
    'running'
  );

  assert.equal(insights.mode, 'running');
  assert.equal(insights.count, 2);
  assert.equal(insights.totalDistanceMeters, 20_000);
  assert.equal(insights.totalMovingSeconds, 5_400);
  assert.ok(Math.abs(insights.averageMetersPerSecond - 20_000 / 5_400) < 1e-9);
  assert.ok(Math.abs(insights.maxMetersPerSecond - 10_000 / 1_800) < 1e-9);
  assert.equal(insights.maxDistanceMeters, 10_000);
  assert.equal(insights.totalElevationGainMeters, 100);
  assert.equal(insights.averageHeartRate, 120);
  assert.equal(insights.maxStreakDays, 5);
});

test('year summaries and Total use the same aggregation rules', async () => {
  const { summarizeActivitiesByYear } = await vite.ssrLoadModule(
    '/src/modules/activity/insights.ts'
  );
  const summaries = summarizeActivitiesByYear(
    [
      activity(),
      activity({
        run_id: 2,
        distance: 20_000,
        moving_time: '02:00:00',
        start_date_local: '2026-02-01 08:00:00',
      }),
    ],
    'running'
  );

  assert.equal(summaries.get('2025').count, 1);
  assert.equal(summaries.get('2026').totalDistanceMeters, 20_000);
  assert.equal(summaries.get('Total').totalDistanceMeters, 30_000);
  assert.equal(summaries.get('Total').totalMovingSeconds, 10_800);
});
