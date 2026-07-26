import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

test('the public package checks are complete and non-mutating', () => {
  const { scripts } = JSON.parse(readFileSync('package.json', 'utf8'));

  assert.match(scripts.test, /test\/\*\.test\.mjs/);
  assert.match(scripts.test, /--test-concurrency=1/);
  assert.equal(scripts.typecheck, 'tsc --noEmit');
  assert.match(scripts['lint:check'], /^eslint\b/);
  assert.doesNotMatch(scripts['lint:check'], /--fix/);
  assert.match(scripts['format:check'], /^prettier --check\b/);
  assert.match(
    scripts['resource:check'],
    /^node scripts\/check-resource-budgets\.mjs\b/
  );
  assert.equal(
    scripts.ci,
    'pnpm test && pnpm typecheck && pnpm lint:check && pnpm format:check && pnpm build && pnpm resource:check'
  );
});

test('Python CI uses reproducible formatter and linter versions', () => {
  const requirements = readFileSync('requirements-dev.txt', 'utf8');

  assert.match(requirements, /^black==25\.1\.0$/m);
  assert.match(requirements, /^ruff==0\.12\.5$/m);
});

test('CI runs the complete checks and proves they leave the full worktree unchanged', () => {
  const workflow = readFileSync('.github/workflows/ci.yml', 'utf8');

  assert.match(workflow, /pnpm install --frozen-lockfile/);
  assert.match(workflow, /pnpm run ci/);
  assert.match(workflow, /git status --porcelain --untracked-files=all/);
  assert.match(workflow, /\bcmp\b/);
  assert.doesNotMatch(workflow, /pnpm run (?:format|lint)(?:\s|$)/);
  assert.doesNotMatch(workflow, /pip install ruff/);
  assert.match(workflow, /ruff check \./);
});

test('data sync is serialized, validates against last-known-good, and surfaces push errors', () => {
  const workflow = readFileSync('.github/workflows/run_data_sync.yml', 'utf8');

  assert.match(workflow, /concurrency:\s*\n\s+group: run-data-sync-/);
  assert.match(workflow, /cancel-in-progress: false/);
  assert.match(workflow, /contents: write/);
  assert.match(workflow, /\.activity-last-known-good\/running/);
  assert.match(workflow, /\.activity-last-known-good\/cycling/);
  assert.match(workflow, /activity_snapshot\.py validate/);
  assert.match(workflow, /git diff --cached --quiet/);
  assert.match(workflow, /\n\s+git push\s*\n/);
  assert.doesNotMatch(workflow, /git push\s*\|\|/);
  assert.match(workflow, /source_sha=\$\(git rev-parse HEAD\)/);
  assert.match(workflow, /needs: sync/);
});

test('GitHub Pages deploys only the immutable artifact from a verified build job', () => {
  const workflow = readFileSync('.github/workflows/gh-pages.yml', 'utf8');

  assert.match(workflow, /^\s{2}build_full:\s*$/m);
  assert.match(workflow, /^\s{2}prepare_redirect:\s*$/m);
  assert.match(workflow, /^\s{2}deploy:\s*$/m);
  assert.match(
    workflow,
    /needs:\s*\n\s+- prepare_redirect\s*\n\s+- build_full/
  );
  assert.match(workflow, /generate-activity-artifacts\.mjs verify/);
  assert.match(workflow, /pnpm run ci/);
  assert.match(workflow, /uses: actions\/upload-pages-artifact@v3/);
  assert.match(workflow, /uses: actions\/deploy-pages@v4/);
  assert.doesNotMatch(workflow, /^\s{2}push:\s*$/m);
  assert.match(workflow, /default: redirect/);
  assert.doesNotMatch(workflow, /ref: master/);
  assert.match(
    workflow,
    /ref: \$\{\{ inputs\.source_sha \|\| github\.sha \}\}/
  );
});
