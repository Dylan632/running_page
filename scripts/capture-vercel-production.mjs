#!/usr/bin/env node

import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
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

const normalizeOrigin = (value) => {
  if (!value) throw new Error('An explicit canonical --origin is required');
  const url = new URL(value);
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    url.pathname !== '/' ||
    url.search ||
    url.hash
  ) {
    throw new Error('Canonical origin must be an HTTP(S) origin');
  }
  return url.origin;
};

const normalizeDeploymentUrl = (value) => {
  if (!value) return null;
  const url = new URL(value.startsWith('http') ? value : `https://${value}`);
  if (url.pathname !== '/' || url.search || url.hash) {
    throw new Error('Deployment URL must be an origin');
  }
  return url.origin;
};

const fetchVercelJson = async ({ url, token, description }) => {
  const response = await fetch(url, {
    headers: {
      authorization: `Bearer ${token}`,
      'user-agent': 'cycling-page-production-cutover/1',
    },
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) {
    throw new Error(`${description} returned HTTP ${response.status}`);
  }
  return response.json();
};

export const captureVercelProduction = async ({
  token,
  projectId,
  teamId,
  origin,
  expectedDeploymentUrl,
  expectedSourceSha,
  output,
  apiOrigin = 'https://api.vercel.com',
}) => {
  if (!token || !projectId || !teamId) {
    throw new Error(
      'VERCEL_TOKEN, VERCEL_PROJECT_ID, and VERCEL_ORG_ID are required'
    );
  }
  if (!output) throw new Error('An explicit --output file is required');

  const canonicalOrigin = normalizeOrigin(origin);
  const aliasName = new URL(canonicalOrigin).hostname;
  const aliasUrl = new URL(
    `/v4/aliases/${encodeURIComponent(aliasName)}`,
    apiOrigin
  );
  aliasUrl.searchParams.set('teamId', teamId);
  const alias = await fetchVercelJson({
    url: aliasUrl,
    token,
    description: `Vercel alias ${aliasName}`,
  });
  const resolvedAlias = alias.alias ?? alias.name;
  if (resolvedAlias !== aliasName) {
    throw new Error(
      `Vercel resolved ${aliasName} as unexpected alias ${resolvedAlias ?? 'unknown'}`
    );
  }
  if (alias.projectId !== projectId) {
    throw new Error(
      `Canonical alias belongs to project ${alias.projectId ?? 'unknown'}, expected ${projectId}`
    );
  }
  if (alias.target !== 'production') {
    throw new Error(
      `Canonical alias target is ${alias.target ?? 'unknown'}, expected production`
    );
  }
  const deploymentId = alias.deployment?.id ?? alias.deploymentId;
  if (!deploymentId) {
    throw new Error('Canonical alias has no bound deployment');
  }

  const deploymentUrl = new URL(
    `/v13/deployments/${encodeURIComponent(deploymentId)}`,
    apiOrigin
  );
  deploymentUrl.searchParams.set('teamId', teamId);
  const deployment = await fetchVercelJson({
    url: deploymentUrl,
    token,
    description: `Vercel deployment ${deploymentId}`,
  });
  const deploymentProjectId = deployment.projectId ?? deployment.project?.id;
  const state = deployment.readyState ?? deployment.state;
  if (deployment.id !== deploymentId) {
    throw new Error(
      `Vercel returned unexpected deployment ${deployment.id ?? 'unknown'}`
    );
  }
  if (deploymentProjectId !== projectId) {
    throw new Error(
      `Deployment belongs to project ${deploymentProjectId ?? 'unknown'}, expected ${projectId}`
    );
  }
  if (state !== 'READY') {
    throw new Error(
      `Canonical alias deployment ${deploymentId} is ${state ?? 'unknown'}, expected READY`
    );
  }
  if (deployment.target !== 'production') {
    throw new Error(
      `Canonical alias deployment target is ${deployment.target ?? 'unknown'}, expected production`
    );
  }
  const resolvedDeploymentUrl = normalizeDeploymentUrl(deployment.url);
  const aliasDeploymentUrl = normalizeDeploymentUrl(alias.deployment?.url);
  if (
    !resolvedDeploymentUrl ||
    (aliasDeploymentUrl && aliasDeploymentUrl !== resolvedDeploymentUrl)
  ) {
    throw new Error('Alias and deployment API disagree about the bound URL');
  }
  const normalizedExpectedUrl = normalizeDeploymentUrl(expectedDeploymentUrl);
  if (
    normalizedExpectedUrl &&
    normalizedExpectedUrl !== resolvedDeploymentUrl
  ) {
    throw new Error(
      `Canonical alias points to ${resolvedDeploymentUrl}, expected promoted deployment ${normalizedExpectedUrl}`
    );
  }
  const sourceSha = deployment.meta?.githubCommitSha ?? null;
  if (expectedSourceSha && sourceSha !== expectedSourceSha) {
    throw new Error(
      `Canonical deployment source SHA is ${sourceSha ?? 'unknown'}, expected ${expectedSourceSha}`
    );
  }

  const snapshot = {
    schemaVersion: 1,
    capturedAt: new Date().toISOString(),
    canonicalOrigin,
    alias: aliasName,
    projectId,
    teamId,
    deploymentId: deployment.id,
    deploymentUrl: resolvedDeploymentUrl,
    state,
    target: deployment.target,
    sourceSha,
    createdAt: deployment.created ?? deployment.createdAt ?? null,
  };
  const outputPath = resolve(output);
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(snapshot, null, 2)}\n`, 'utf8');
  process.stdout.write(
    `Captured rollback deployment ${snapshot.deploymentId}\n`
  );
  return snapshot;
};

const args = parseArgs(process.argv.slice(2));
captureVercelProduction({
  token: process.env.VERCEL_TOKEN,
  projectId: process.env.VERCEL_PROJECT_ID,
  teamId: process.env.VERCEL_ORG_ID,
  origin: args.origin ?? process.env.CANONICAL_ORIGIN,
  expectedDeploymentUrl: args['expected-deployment-url'],
  expectedSourceSha: args['expected-source-sha'],
  output: args.output,
  apiOrigin: process.env.VERCEL_API_URL ?? 'https://api.vercel.com',
}).catch((error) => {
  process.stderr.write(
    `Vercel rollback capture failed closed: ${
      error instanceof Error ? error.message : String(error)
    }\n`
  );
  process.exitCode = 1;
});
