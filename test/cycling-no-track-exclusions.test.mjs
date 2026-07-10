import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';

const excludedRunIds = ['9223370309063493807', '9223370308463553807'];

test('cycling publish permanently excludes the two no-track Keep activities', () => {
  const workflow = readFileSync('.github/workflows/gh-pages.yml', 'utf8');

  assert.match(workflow, /CYCLING_NO_TRACK_RUN_IDS:\s*>-/);
  for (const runId of excludedRunIds) {
    assert.match(workflow, new RegExp(`\\b${runId}\\b`));
  }

  assert.equal(
    (workflow.match(/\$CYCLING_NO_TRACK_RUN_IDS/g) ?? []).length,
    3,
    'all three cycling filters must apply the permanent exclusions'
  );
  assert.equal(
    existsSync('manual_backfill/cycling_keep_missing_tracks.json'),
    false,
    'the removed no-track records must not be reintroduced by backfill'
  );
});
