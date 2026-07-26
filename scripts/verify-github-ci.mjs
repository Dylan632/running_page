#!/usr/bin/env node

import process from 'node:process';

const parseArgs = (argv) => {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    if (!key.startsWith('--')) throw new Error(`Unexpected argument: ${key}`);
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) {
      throw new Error(`Missing value for ${key}`);
    }
    args[key.slice(2)] = value;
    index += 1;
  }
  return args;
};

const fetchJson = async (url, token) => {
  const response = await fetch(url, {
    headers: {
      accept: 'application/vnd.github+json',
      authorization: `Bearer ${token}`,
      'x-github-api-version': '2022-11-28',
      'user-agent': 'cycling-page-production-gate/1',
    },
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) {
    throw new Error(`GitHub API returned HTTP ${response.status}`);
  }
  return response.json();
};

const validateRun = ({ run, repository, sha, branch }) => {
  const errors = [];
  if (run?.name !== 'CI') errors.push('workflow name is not CI');
  if (run?.head_sha !== sha) errors.push('workflow SHA does not match');
  if (run?.head_branch !== branch)
    errors.push('workflow branch does not match');
  if (run?.event !== 'push') errors.push('workflow was not triggered by push');
  if (run?.status !== 'completed') errors.push('workflow is not completed');
  if (run?.conclusion !== 'success') errors.push('workflow did not succeed');
  if (run?.repository?.full_name !== repository) {
    errors.push('workflow repository does not match');
  }
  if (errors.length) {
    throw new Error(`CI gate rejected the run: ${errors.join('; ')}`);
  }
  return run;
};

export const verifyGithubCi = async ({
  repository,
  sha,
  branch = 'master',
  runId,
  token,
  apiOrigin = 'https://api.github.com',
}) => {
  if (!token) throw new Error('GITHUB_TOKEN is required');
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository ?? '')) {
    throw new Error('repository must be in owner/name form');
  }
  if (!/^[a-f0-9]{40}$/i.test(sha ?? '')) {
    throw new Error(
      'source SHA must contain exactly 40 hexadecimal characters'
    );
  }
  const encodedRepository = repository
    .split('/')
    .map(encodeURIComponent)
    .join('/');
  const apiBase = new URL(apiOrigin);
  let run;

  if (runId) {
    if (!/^\d+$/.test(String(runId))) {
      throw new Error('workflow run ID must be numeric');
    }
    run = await fetchJson(
      new URL(`/repos/${encodedRepository}/actions/runs/${runId}`, apiBase),
      token
    );
  } else {
    const url = new URL(
      `/repos/${encodedRepository}/actions/workflows/ci.yml/runs`,
      apiBase
    );
    url.searchParams.set('branch', branch);
    url.searchParams.set('event', 'push');
    url.searchParams.set('status', 'success');
    url.searchParams.set('head_sha', sha);
    url.searchParams.set('per_page', '20');
    const result = await fetchJson(url, token);
    run = result.workflow_runs?.find((candidate) => candidate.head_sha === sha);
    if (!run) {
      throw new Error(
        `No successful CI workflow was found for exact SHA ${sha}`
      );
    }
  }

  return validateRun({ run, repository, sha, branch });
};

const main = async () => {
  const args = parseArgs(process.argv.slice(2));
  const run = await verifyGithubCi({
    repository: args.repository ?? process.env.GITHUB_REPOSITORY,
    sha: args.sha,
    branch: args.branch ?? 'master',
    runId: args['run-id'],
    token: process.env.GITHUB_TOKEN,
    apiOrigin: process.env.GITHUB_API_URL ?? 'https://api.github.com',
  });
  process.stdout.write(
    `CI gate passed: ${run.name} run ${run.id} verified ${run.head_sha}\n`
  );
};

main().catch((error) => {
  process.stderr.write(
    `CI gate failed closed: ${
      error instanceof Error ? error.message : String(error)
    }\n`
  );
  process.exitCode = 1;
});
