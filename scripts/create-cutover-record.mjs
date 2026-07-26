#!/usr/bin/env node

import { mkdir, readFile, writeFile } from 'node:fs/promises';
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

const requireHttpsOrigin = (value, label) => {
  const url = new URL(value);
  if (url.protocol !== 'https:') throw new Error(`${label} must use HTTPS`);
  return url;
};

const main = async () => {
  const args = parseArgs(process.argv.slice(2));
  if (!/^[a-f0-9]{40}$/i.test(args['source-sha'] ?? '')) {
    throw new Error(
      'source SHA must contain exactly 40 hexadecimal characters'
    );
  }
  if (!args.previous || !args.output) {
    throw new Error('--previous and --output are required');
  }
  const canonicalOrigin = requireHttpsOrigin(
    args['canonical-origin'],
    'canonical origin'
  ).origin;
  const deploymentUrl = requireHttpsOrigin(
    args['deployment-url'],
    'deployment URL'
  ).href.replace(/\/$/, '');
  const previous = JSON.parse(await readFile(args.previous, 'utf8'));
  if (!previous.deploymentId || !previous.deploymentUrl) {
    throw new Error('previous production snapshot is incomplete');
  }

  const record = {
    schemaVersion: 1,
    kind: 'vercel-production-cutover',
    recordedAt: new Date().toISOString(),
    sourceSha: args['source-sha'],
    canonicalOrigin,
    deploymentUrl,
    previousProduction: previous,
    rollback: {
      deploymentId: previous.deploymentId,
      deploymentUrl: previous.deploymentUrl,
      command:
        'vercel promote <previous-production-url> --yes --token "$VERCEL_TOKEN"',
    },
    legacyPages: {
      sourceOrigin: 'https://dylan632.github.io/cycling_page',
      redirectArtifact: 'legacy-pages-redirect',
      destinationPath: '/cycling',
      deploymentIsSeparate: true,
    },
  };
  const outputPath = resolve(args.output);
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(record, null, 2)}\n`, 'utf8');
  process.stdout.write(`Cutover record written to ${outputPath}\n`);
};

main().catch((error) => {
  process.stderr.write(
    `Cutover record failed: ${
      error instanceof Error ? error.message : String(error)
    }\n`
  );
  process.exitCode = 1;
});
