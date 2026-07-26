import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';

const excludedRunIds = ['9223370309063493807', '9223370308463553807'];

test('cycling publish permanently excludes the two no-track Keep activities', () => {
  const workflow = readFileSync('.github/workflows/run_data_sync.yml', 'utf8');
  const profiles = JSON.parse(
    readFileSync('src/modules/activity/activity-profiles.json', 'utf8')
  );
  const cyclingProfile = profiles.profiles.cycling;

  for (const runId of excludedRunIds) {
    assert.ok(cyclingProfile.publication.excludeRunIds.includes(runId));
    assert.doesNotMatch(workflow, new RegExp(`\\b${runId}\\b`));
  }
  assert.match(workflow, /generate-activity-artifacts\.mjs export-profile/);
  assert.equal(
    (workflow.match(/\$ACTIVITY_EXCLUDE_RUN_IDS/g) ?? []).length,
    3,
    'all three cycling filters must use the shared permanent exclusions'
  );
  assert.equal(
    existsSync('manual_backfill/cycling_keep_missing_tracks.json'),
    false,
    'the removed no-track records must not be reintroduced by backfill'
  );
});
