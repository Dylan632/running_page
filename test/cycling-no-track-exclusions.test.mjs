import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const cyclingRunIds = ['9223370309063493807', '9223370308463553807'];

test('running publication carries no hardcoded no-track exclusions', () => {
  const workflow = readFileSync('.github/workflows/run_data_sync.yml', 'utf8');
  const profiles = JSON.parse(
    readFileSync('src/modules/activity/activity-profiles.json', 'utf8')
  );
  const runningProfile = profiles.profiles.running;

  assert.deepEqual(runningProfile.publication.excludeRunIds, []);
  for (const runId of cyclingRunIds) {
    assert.doesNotMatch(workflow, new RegExp(`\\b${runId}\\b`));
  }
});
