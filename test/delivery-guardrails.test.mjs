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
    scripts['artifacts:verify'],
    'node scripts/generate-activity-artifacts.mjs verify'
  );
  assert.equal(
    scripts.ci,
    'pnpm test && pnpm typecheck && pnpm lint:check && pnpm format:check && pnpm build && pnpm artifacts:verify && pnpm resource:check'
  );
});

test('Python CI uses reproducible formatter and linter versions', () => {
  const requirements = readFileSync('requirements-dev.txt', 'utf8');

  assert.match(requirements, /^black==25\.1\.0$/m);
  assert.match(requirements, /^ruff==0\.12\.5$/m);
});

test('CI runs the complete checks and proves they leave the full worktree unchanged', () => {
  const workflow = readFileSync('.github/workflows/ci.yml', 'utf8');

  assert.match(workflow, /^\s{2}workflow_dispatch:\s*$/m);
  assert.match(workflow, /node: \[22, 24, 26\]/);
  assert.doesNotMatch(workflow, /node: \[[^\]]*\b20\b/);
  assert.match(workflow, /pnpm install --frozen-lockfile/);
  assert.match(workflow, /pnpm run ci/);
  assert.match(workflow, /git status --porcelain --untracked-files=all/);
  assert.match(workflow, /\bcmp\b/);
  assert.doesNotMatch(workflow, /pnpm run (?:format|lint)(?:\s|$)/);
  assert.doesNotMatch(workflow, /pip install ruff/);
  assert.match(workflow, /python -m unittest discover -s \. -p 'test_\*\.py'/);
  assert.match(workflow, /ruff check \./);
});

test('production and automation runtimes stay on a supported Node baseline', () => {
  const packageJson = JSON.parse(readFileSync('package.json', 'utf8'));
  const dockerfile = readFileSync('Dockerfile', 'utf8');
  const workflows = [
    '.github/workflows/gh-pages.yml',
    '.github/workflows/run_data_sync.yml',
    '.github/workflows/vercel-production.yml',
  ].map((path) => readFileSync(path, 'utf8'));

  assert.equal(packageJson.engines.node, '>=22.12.0');
  assert.match(dockerfile, /^FROM node:24 AS develop-node$/m);
  assert.doesNotMatch(dockerfile, /^FROM node:20\b/m);
  for (const workflow of workflows) {
    assert.match(workflow, /node-version: '24'/);
    assert.doesNotMatch(workflow, /node-version: '20'/);
  }
});

test('all activity syncs are serialized, last-known-good guarded, and surface push errors', () => {
  const workflow = readFileSync('.github/workflows/run_data_sync.yml', 'utf8');

  assert.match(workflow, /concurrency:\s*\n\s+group: run-data-sync-/);
  assert.match(workflow, /cancel-in-progress: false/);
  assert.match(workflow, /actions: write/);
  assert.match(workflow, /contents: write/);
  assert.match(workflow, /\.activity-last-known-good\/running/);
  assert.match(workflow, /\.activity-last-known-good\/cycling/);
  assert.match(workflow, /\.activity-last-known-good\/hiking/);
  assert.match(workflow, /--sync-types hiking/);
  assert.match(workflow, /--mode hiking/);
  assert.match(workflow, /^\s{6}- run_page\/generator\/\*\*$/m);
  assert.match(
    workflow,
    /if \[ -f public\/data\/hiking\/metadata\.json \]; then/
  );
  assert.match(workflow, /activity_snapshot\.py validate/);
  assert.match(workflow, /git diff --cached --quiet/);
  assert.match(workflow, /\n\s+git push\s*\n/);
  assert.doesNotMatch(workflow, /git push\s*\|\|/);
  assert.match(workflow, /source_sha=\$\(git rev-parse HEAD\)/);
  assert.match(workflow, /uses: \.\/\.github\/workflows\/ci\.yml/);
  assert.match(
    workflow,
    /source_sha: \$\{\{ needs\.sync\.outputs\.source_sha \}\}/
  );
  assert.match(
    workflow,
    /uses: \.\/\.github\/workflows\/vercel-production\.yml/
  );
  assert.match(workflow, /needs: \[sync, ci\]/);
  assert.doesNotMatch(workflow, /actions\/workflows\/ci\.yml\/dispatches/);
  assert.doesNotMatch(workflow, /^\s{2}publish_pages:\s*$/m);
  assert.doesNotMatch(workflow, /pages_mode:/);
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
  assert.match(workflow, /Verify committed artifacts for all activity modes/);
  assert.doesNotMatch(workflow, /dual-mode/i);
  assert.match(workflow, /pnpm run ci/);
  assert.equal(
    (workflow.match(/verify-github-ci\.mjs/g) ?? []).length,
    2,
    'both redirect and full Pages publications must verify the exact SHA CI'
  );
  assert.equal(
    (workflow.match(/actions:\s*read/g) ?? []).length,
    2,
    'both Pages preparation jobs need read access to CI runs'
  );
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
