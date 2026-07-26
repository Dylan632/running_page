#!/usr/bin/env node

import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const parseArgs = (argv) => {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    if (!key.startsWith('--')) {
      throw new Error(`Unexpected argument: ${key}`);
    }
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
  const url = new URL(value);
  if (url.protocol !== 'https:') {
    throw new Error('Canonical origin must use HTTPS');
  }
  if (url.pathname !== '/' || url.search || url.hash) {
    throw new Error('Canonical origin must not include a path, query, or hash');
  }
  return url.origin;
};

const normalizeBasePath = (value) => {
  if (!value.startsWith('/') || value.includes('?') || value.includes('#')) {
    throw new Error('Legacy base path must be an absolute URL path');
  }
  return value === '/' ? '' : value.replace(/\/+$/, '');
};

const escapeScriptJson = (value) =>
  JSON.stringify(value).replaceAll('<', '\\u003c');

export const buildRedirectHtml = ({ canonicalOrigin, legacyBasePath }) => {
  const fallbackUrl = `${canonicalOrigin}/cycling`;
  const originJson = escapeScriptJson(canonicalOrigin);
  const basePathJson = escapeScriptJson(legacyBasePath);

  return `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta http-equiv="refresh" content="0;url=${fallbackUrl}" />
    <link rel="canonical" href="${fallbackUrl}" />
    <title>骑行记录已迁移</title>
  </head>
  <body>
    <main>
      <p>骑行记录已迁移到新的运动记录页面。</p>
      <p><a href="${fallbackUrl}">继续前往骑行记录</a></p>
    </main>
    <script>
      (() => {
        const canonicalOrigin = ${originJson};
        const legacyBasePath = ${basePathJson};
        const pathname = window.location.pathname.startsWith(legacyBasePath)
          ? window.location.pathname.slice(legacyBasePath.length) || '/'
          : window.location.pathname;
        let destination = '/cycling';
        if (/^\\/running(?:\\/|$)/.test(pathname)) {
          destination = pathname;
        } else if (/^\\/cycling(?:\\/|$)/.test(pathname)) {
          destination = pathname;
        } else if (/^\\/(?:total|summary)(?:\\/|$)/.test(pathname)) {
          destination = '/cycling/summary';
        }
        const target = new URL(destination, canonicalOrigin);
        target.search = window.location.search;
        target.hash = window.location.hash;
        window.location.replace(target.href);
      })();
    </script>
  </body>
</html>
`;
};

export const buildLegacyRedirect = async ({
  origin,
  basePath = '/cycling_page',
  output,
}) => {
  if (!output) {
    throw new Error('An explicit --output directory is required');
  }
  const canonicalOrigin = normalizeOrigin(origin);
  const legacyBasePath = normalizeBasePath(basePath);
  const outputDirectory = resolve(output);
  const html = buildRedirectHtml({ canonicalOrigin, legacyBasePath });
  const manifest = {
    schemaVersion: 1,
    kind: 'legacy-pages-redirect',
    canonicalOrigin,
    defaultActivityPath: '/cycling',
    legacyBasePath: legacyBasePath || '/',
    mappings: {
      '/': '/cycling',
      '/total': '/cycling/summary',
      '/summary': '/cycling/summary',
      '/running/*': '/running/*',
      '/cycling/*': '/cycling/*',
    },
  };

  await mkdir(outputDirectory, { recursive: true });
  await Promise.all([
    writeFile(resolve(outputDirectory, 'index.html'), html, 'utf8'),
    writeFile(resolve(outputDirectory, '404.html'), html, 'utf8'),
    writeFile(
      resolve(outputDirectory, 'redirect-manifest.json'),
      `${JSON.stringify(manifest, null, 2)}\n`,
      'utf8'
    ),
  ]);
  return { outputDirectory, manifest };
};

if (
  process.argv[1] &&
  resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))
) {
  try {
    const args = parseArgs(process.argv.slice(2));
    const result = await buildLegacyRedirect({
      origin: args.origin,
      basePath: args['base-path'],
      output: args.output,
    });
    process.stdout.write(
      `Legacy redirect artifact written to ${result.outputDirectory}\n`
    );
  } catch (error) {
    process.stderr.write(
      `Legacy redirect generation failed: ${
        error instanceof Error ? error.message : String(error)
      }\n`
    );
    process.exitCode = 1;
  }
}
