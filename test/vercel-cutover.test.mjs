import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { access, mkdtemp, readFile, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { setTimeout } from 'node:timers';
import {
  buildSameOriginBypassHeaders,
  disposeBrowserProbe,
  validateBrowserProbe,
} from '../scripts/monitor-deployment.mjs';

const readJson = async (path) => JSON.parse(await readFile(path, 'utf8'));

const runNode = (args, options = {}) =>
  new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, {
      cwd: process.cwd(),
      env: { ...process.env, ...options.env },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    child.on('error', reject);
    child.on('close', (code) => resolve({ code, stdout, stderr }));
  });

const monitorActivityByMode = {
  running: { run_id: 'run', type: 'Run', distance: 5_000 },
  cycling: { run_id: 'ride', type: 'Ride', distance: 20_000 },
  hiking: { run_id: 'hike', type: 'Hiking', distance: 1_001 },
};

test('Vercel serves all SPA activity paths with freshness-aware data caching', async () => {
  const config = await readJson('vercel.json');

  assert.equal(config.framework, 'vite');
  assert.equal(
    config.installCommand,
    'npx --yes pnpm@8.9.0 install --frozen-lockfile'
  );
  assert.equal(config.buildCommand, 'npx --yes pnpm@8.9.0 run build');
  assert.equal(config.outputDirectory, 'dist');
  assert.equal(config.git.deploymentEnabled.master, false);
  assert.equal(config.git.deploymentEnabled['gh-pages'], false);
  assert.deepEqual(config.redirects.slice(0, 2), [
    {
      source: '/',
      destination: '/running',
      permanent: false,
    },
    {
      source: '/summary',
      destination: '/running/summary',
      permanent: false,
    },
  ]);
  assert.deepEqual(config.rewrites.at(-1), {
    source: '/(.*)',
    destination: '/',
  });

  const headers = new Map(
    config.headers.map(({ source, headers: entries }) => [
      source,
      new Map(entries.map(({ key, value }) => [key.toLowerCase(), value])),
    ])
  );
  for (const path of [
    '/data/:mode/manifest.json',
    '/data/:mode/metadata.json',
    '/data/:mode/routes/:year.json',
  ]) {
    assert.match(headers.get(path).get('cache-control'), /max-age=0\b/);
    assert.match(headers.get(path).get('cache-control'), /must-revalidate\b/);
  }
  assert.match(
    headers.get('/data/:mode/manifest.json').get('vercel-cdn-cache-control'),
    /max-age=60\b/
  );
  assert.match(
    headers.get('/data/:mode/metadata.json').get('vercel-cdn-cache-control'),
    /max-age=60\b/
  );
  assert.match(
    headers
      .get('/data/:mode/routes/:year.json')
      .get('vercel-cdn-cache-control'),
    /max-age=300\b/
  );
});

test('Vercel observability captures analytics and Core Web Vitals off the critical bundle', async () => {
  const [main, observability, activityPage] = await Promise.all([
    readFile('src/main.tsx', 'utf8'),
    readFile('src/components/VercelObservability/index.tsx', 'utf8'),
    readFile('src/pages/index.tsx', 'utf8'),
  ]);

  assert.match(
    main,
    /lazy\([\s\S]*?import\('@\/components\/VercelObservability'\)[\s\S]*?\)/
  );
  assert.match(main, /import\.meta\.env\.VERCEL.*VercelObservability/s);
  assert.match(observability, /@vercel\/analytics\/react/);
  assert.match(observability, /@vercel\/speed-insights\/react/);
  assert.match(observability, /<Analytics\s*\/>/);
  assert.match(observability, /<SpeedInsights\s*\/>/);
  assert.doesNotMatch(activityPage, /@vercel\/analytics|<Analytics/);
});

test('production workflow deploys an exact SHA after the parent CI workflow succeeds', async () => {
  const workflow = await readFile(
    '.github/workflows/vercel-production.yml',
    'utf8'
  );

  assert.match(workflow, /^\s{2}workflow_call:\s*$/m);
  assert.match(workflow, /source_sha:/);
  assert.match(workflow, /workflow_dispatch:/);
  assert.doesNotMatch(workflow, /workflow_run:/);
  assert.doesNotMatch(workflow, /^\s{2}schedule:\s*$/m);
  assert.match(workflow, /ref: \$\{\{ env\.SOURCE_SHA \}\}/);
  assert.match(workflow, /verify-github-ci\.mjs/);
  assert.equal(
    (workflow.match(/git ls-remote origin refs\/heads\/master/g) ?? []).length,
    2
  );
  assert.match(
    workflow,
    /Promote, verify canonical identity, or roll back[\s\S]*?pre_promotion_master_sha[\s\S]*?refusing stale SHA/
  );
  assert.match(workflow, /vercel@50\.28\.0/);
  assert.match(workflow, /vercel build --prod/);
  assert.match(workflow, /vercel deploy --prebuilt --prod/);
  assert.match(workflow, /--skip-domain/);
  assert.match(workflow, /--meta githubCommitSha="\$SOURCE_SHA"/);
  assert.match(workflow, /capture-vercel-production\.mjs/);
  assert.match(workflow, /monitor-deployment\.mjs/);
  assert.match(workflow, /vercel promote/);
  assert.match(workflow, /--expected-deployment-url/);
  assert.match(workflow, /--expected-source-sha/);
  assert.match(workflow, /actions\/upload-artifact@v4/);
  assert.match(
    workflow,
    /Monitor the staged production artifact[\s\S]*?shell: bash[\s\S]*?set -euo pipefail[\s\S]*?monitor-deployment\.mjs/
  );
  assert.ok(
    workflow.indexOf('Monitor the staged production artifact') <
      workflow.indexOf('Promote, verify canonical identity, or roll back')
  );
  assert.match(workflow, /trap rollback_on_failure EXIT/);
  assert.match(workflow, /rollback-production\.json/);
  assert.match(workflow, /rollback-monitor\.log/);
  assert.match(
    workflow,
    /env -u VERCEL_TOKEN node scripts\/monitor-deployment/
  );

  for (const secret of [
    'VERCEL_TOKEN',
    'VERCEL_ORG_ID',
    'VERCEL_PROJECT_ID',
    'VERCEL_AUTOMATION_BYPASS_SECRET',
  ]) {
    assert.match(workflow, new RegExp(`secrets\\.${secret}`));
  }
  const stagedMonitorStart = workflow.indexOf(
    '- name: Monitor the staged production artifact'
  );
  const stagedMonitorEnd = workflow.indexOf(
    '\n      - name:',
    stagedMonitorStart + 1
  );
  const stagedMonitorBlock = workflow.slice(
    stagedMonitorStart,
    stagedMonitorEnd
  );
  assert.doesNotMatch(stagedMonitorBlock, /VERCEL_TOKEN:\s*\$\{\{/);
  assert.match(
    stagedMonitorBlock,
    /VERCEL_AUTOMATION_BYPASS_SECRET:\s*\$\{\{\s*secrets\.VERCEL_AUTOMATION_BYPASS_SECRET\s*\}\}/
  );
  assert.equal(
    (workflow.match(/secrets\.VERCEL_AUTOMATION_BYPASS_SECRET/g) ?? []).length,
    3
  );
  assert.doesNotMatch(
    await readFile('scripts/monitor-deployment.mjs', 'utf8'),
    /--no-sandbox/
  );
  assert.match(workflow, /vars\.VERCEL_CANONICAL_ORIGIN/);
  assert.match(
    workflow,
    /publish-legacy-redirect:[\s\S]*?needs: deploy[\s\S]*?uses: \.\/\.github\/workflows\/gh-pages\.yml/
  );
  assert.match(
    workflow,
    /deployment_mode: redirect[\s\S]*?source_sha: \$\{\{ inputs\.source_sha \}\}/
  );
  assert.match(
    workflow,
    /\/running, \/cycling, and \/hiking passed HTTP, data freshness, cache, and browser error probes/
  );
});

test('production workflow has no independent scheduled release trigger', async () => {
  const workflow = (
    await readFile('.github/workflows/vercel-production.yml', 'utf8')
  ).replaceAll('\r\n', '\n');

  assert.match(workflow, /^\s{2}workflow_call:\s*$/m);
  assert.doesNotMatch(workflow, /^\s{2}schedule:\s*$/m);
  assert.doesNotMatch(workflow, /^\s{2}workflow_run:\s*$/m);
  assert.match(workflow, /^\s{2}publish-legacy-redirect:\s*$/m);
  assert.match(workflow, /Monitor the staged production artifact/);
});

test('browser diagnostics require the final mode marker and surface application failures', () => {
  const healthy = {
    origin: 'https://records.example',
    mode: 'cycling',
    state: {
      href: 'https://records.example/cycling',
      rootHasContent: true,
      markerMode: 'cycling',
      currentModePath: '/cycling',
      hasFatalUi: false,
      mapRenderer: 'mapbox',
    },
  };
  assert.doesNotThrow(() =>
    validateBrowserProbe({
      ...healthy,
      consoleErrors: ['WebGL: software fallback is deprecated'],
    })
  );
  assert.doesNotThrow(() =>
    validateBrowserProbe({
      ...healthy,
      consoleErrors: [
        "Access to fetch at 'https://tiles.basemaps.cartocdn.com/fonts/HanWangHeiLight%20Regular/0-255.pbf' from origin 'https://records.example' has been blocked by CORS policy: No 'Access-Control-Allow-Origin' header is present on the requested resource.",
        'Failed to load resource: net::ERR_FAILED [source: https://tiles.basemaps.cartocdn.com/fonts/HanWangHeiLight%20Regular/0-255.pbf]',
      ],
    })
  );
  assert.throws(
    () =>
      validateBrowserProbe({
        ...healthy,
        pageErrors: ['ReferenceError: missing is not defined'],
      }),
    /pageerror/
  );
  assert.throws(
    () =>
      validateBrowserProbe({
        ...healthy,
        consoleErrors: ['Unable to render the activity archive'],
      }),
    /console\.error/
  );
  assert.throws(
    () =>
      validateBrowserProbe({
        ...healthy,
        consoleErrors: [
          'Failed to load resource: net::ERR_FAILED [source: https://records.example/assets/app.js]',
        ],
      }),
    /console\.error/
  );
  assert.throws(
    () =>
      validateBrowserProbe({
        ...healthy,
        consoleErrors: ['Map style failed: WebGL context creation failed'],
      }),
    /console\.error/
  );
  assert.throws(
    () =>
      validateBrowserProbe({
        ...healthy,
        failedRequests: [
          {
            url: 'https://records.example/data/cycling/manifest.json',
            errorText: 'net::ERR_FAILED',
          },
        ],
      }),
    /request failed/
  );
  assert.throws(
    () =>
      validateBrowserProbe({
        ...healthy,
        state: { ...healthy.state, href: 'https://records.example/running' },
      }),
    /finished at/
  );
  assert.throws(
    () =>
      validateBrowserProbe({
        ...healthy,
        state: { ...healthy.state, markerMode: 'running' },
      }),
    /mode-ready/
  );
});

test('browser probe cleanup waits for Chrome to exit before removing its profile', async () => {
  const profileDirectory = await mkdtemp(
    join(tmpdir(), 'cycling-page-cleanup-test-')
  );
  const child = new EventEmitter();
  child.exitCode = null;
  child.signalCode = null;
  let exited = false;
  child.kill = (signal) => {
    setTimeout(() => {
      child.signalCode = signal;
      exited = true;
      child.emit('exit', null, signal);
    }, 10);
    return true;
  };

  await disposeBrowserProbe({ child, profileDirectory });

  assert.equal(exited, true);
  await assert.rejects(access(profileDirectory));
});

test('browser protection bypass headers are limited to the deployment origin', () => {
  const protectionBypass = 'A'.repeat(32);
  const headers = buildSameOriginBypassHeaders({
    requestUrl: 'https://records.example/data/running/manifest.json',
    origin: 'https://records.example',
    requestHeaders: {
      Accept: 'application/json',
      'X-Vercel-Protection-Bypass': 'stale-value',
    },
    protectionBypass,
  });

  assert.deepEqual(headers, [
    { name: 'Accept', value: 'application/json' },
    {
      name: 'x-vercel-protection-bypass',
      value: protectionBypass,
    },
  ]);
  assert.equal(
    buildSameOriginBypassHeaders({
      requestUrl: 'https://api.mapbox.com/styles/v1/example',
      origin: 'https://records.example',
      protectionBypass,
    }),
    undefined
  );
  assert.equal(
    buildSameOriginBypassHeaders({
      requestUrl: 'https://records.example/running',
      origin: 'https://records.example',
    }),
    undefined
  );
});

test('legacy Pages redirect artifact preserves query/hash and maps old paths', async () => {
  const output = await mkdtemp(join(tmpdir(), 'legacy-pages-'));
  try {
    const result = await runNode([
      'scripts/build-legacy-redirect.mjs',
      '--origin',
      'https://records.example',
      '--base-path',
      '/cycling_page',
      '--output',
      output,
    ]);
    assert.equal(result.code, 0, result.stderr);

    const index = await readFile(join(output, 'index.html'), 'utf8');
    const notFound = await readFile(join(output, '404.html'), 'utf8');
    const manifest = await readJson(join(output, 'redirect-manifest.json'));
    for (const html of [index, notFound]) {
      assert.match(html, /https:\/\/records\.example\/cycling/);
      assert.match(html, /window\.location\.search/);
      assert.match(html, /window\.location\.hash/);
      assert.match(html, /window\.location\.replace/);
      assert.match(html, /total\|summary/);
      assert.match(html, /\/cycling\/summary/);
      assert.match(html, /\\\/hiking/);
    }
    assert.equal(manifest.canonicalOrigin, 'https://records.example');
    assert.equal(manifest.defaultActivityPath, '/cycling');
    assert.equal(manifest.legacyBasePath, '/cycling_page');
    assert.equal(manifest.mappings['/hiking/*'], '/hiking/*');
  } finally {
    await rm(output, { recursive: true, force: true });
  }
});

test('deployment monitor checks SPA routes, cache policy, and publication freshness', async () => {
  const publishedAt = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const latestActivityDate = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000)
    .toISOString()
    .replace('T', ' ')
    .slice(0, 19);
  const server = createServer((request, response) => {
    const path = new URL(request.url, 'http://localhost').pathname;
    if (path === '/running' || path === '/cycling' || path === '/hiking') {
      response.setHeader('content-type', 'text/html; charset=utf-8');
      response.end(
        '<!doctype html><html><body><div id="root">activity</div></body></html>'
      );
      return;
    }
    const manifestMatch = path.match(
      /^\/data\/(running|cycling|hiking)\/manifest\.json$/
    );
    if (manifestMatch) {
      response.setHeader('content-type', 'application/json');
      response.setHeader('cache-control', 'public, max-age=0, must-revalidate');
      response.end(
        JSON.stringify({
          schemaVersion: 1,
          mode: manifestMatch[1],
          activityCount: 1,
          publishedAt,
          latestActivityDate,
          latestYear: '2026',
          years: ['2026'],
          checksum: 'a'.repeat(64),
        })
      );
      return;
    }
    const metadataMatch = path.match(
      /^\/data\/(running|cycling|hiking)\/metadata\.json$/
    );
    if (metadataMatch) {
      response.setHeader('content-type', 'application/json');
      response.setHeader('cache-control', 'public, max-age=0, must-revalidate');
      response.end(JSON.stringify([monitorActivityByMode[metadataMatch[1]]]));
      return;
    }
    const routeMatch = path.match(
      /^\/data\/(running|cycling|hiking)\/routes\/2026\.json$/
    );
    if (routeMatch) {
      response.setHeader('content-type', 'application/json');
      response.setHeader('cache-control', 'public, max-age=0, must-revalidate');
      response.end(
        JSON.stringify([
          {
            run_id: routeMatch[1],
            summary_polyline: 'encoded-polyline',
          },
        ])
      );
      return;
    }
    response.statusCode = 404;
    response.end('not found');
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();

  try {
    const result = await runNode([
      'scripts/monitor-deployment.mjs',
      '--origin',
      `http://127.0.0.1:${address.port}`,
      '--max-data-age-hours',
      '24',
      '--require-cache',
    ]);
    assert.equal(result.code, 0, result.stderr);
    assert.match(result.stdout, /running.*fresh/);
    assert.match(result.stdout, /cycling.*fresh/);
    assert.match(result.stdout, /hiking.*fresh/);
    assert.match(result.stdout, /deployment monitor passed/);
  } finally {
    await new Promise((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve()))
    );
  }
});

test('deployment monitor rejects activities outside the published mode policy', async () => {
  const invalidCases = [
    {
      name: 'a hike at the exact 1 km boundary',
      mode: 'hiking',
      activity: { run_id: 'boundary', type: 'Hiking', distance: 1_000 },
    },
    {
      name: 'a non-Hiking walking activity',
      mode: 'hiking',
      activity: { run_id: 'walk', type: 'Walk', distance: 2_000 },
    },
    {
      name: 'an indoor VirtualRun',
      mode: 'running',
      activity: { run_id: 'indoor', type: 'VirtualRun', distance: 5_000 },
    },
  ];

  for (const invalidCase of invalidCases) {
    const publishedAt = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const server = createServer((request, response) => {
      const path = new URL(request.url, 'http://localhost').pathname;
      const pageMatch = path.match(/^\/(running|cycling|hiking)$/);
      if (pageMatch) {
        response.setHeader('content-type', 'text/html; charset=utf-8');
        response.end('<div id="root">activity</div>');
        return;
      }
      const manifestMatch = path.match(
        /^\/data\/(running|cycling|hiking)\/manifest\.json$/
      );
      if (manifestMatch) {
        response.setHeader('content-type', 'application/json');
        response.end(
          JSON.stringify({
            schemaVersion: 1,
            mode: manifestMatch[1],
            activityCount: 1,
            publishedAt,
            latestActivityDate: publishedAt,
            latestYear: '2026',
            years: ['2026'],
            checksum: 'a'.repeat(64),
          })
        );
        return;
      }
      const metadataMatch = path.match(
        /^\/data\/(running|cycling|hiking)\/metadata\.json$/
      );
      if (metadataMatch) {
        const mode = metadataMatch[1];
        response.setHeader('content-type', 'application/json');
        response.end(
          JSON.stringify([
            mode === invalidCase.mode
              ? invalidCase.activity
              : monitorActivityByMode[mode],
          ])
        );
        return;
      }
      const routeMatch = path.match(
        /^\/data\/(running|cycling|hiking)\/routes\/2026\.json$/
      );
      if (routeMatch) {
        response.setHeader('content-type', 'application/json');
        response.end(
          JSON.stringify([
            {
              run_id: routeMatch[1],
              summary_polyline: 'encoded-polyline',
            },
          ])
        );
        return;
      }
      response.statusCode = 404;
      response.end('not found');
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();

    try {
      const result = await runNode([
        'scripts/monitor-deployment.mjs',
        '--origin',
        `http://127.0.0.1:${address.port}`,
        '--max-data-age-hours',
        '24',
      ]);
      assert.notEqual(
        result.code,
        0,
        `${invalidCase.name} unexpectedly passed production monitoring`
      );
      assert.match(result.stderr, /publication policy/i);
    } finally {
      await new Promise((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve()))
      );
    }
  }
});

test('deployment monitor authenticates protected HTTP checks without leaking its bypass secret', async () => {
  const workingSecret = 'B'.repeat(32);
  const redactionSecret = 'C'.repeat(32);
  const seenRequests = [];
  const publishedAt = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const server = createServer((request, response) => {
    const path = new URL(request.url, 'http://localhost').pathname;
    const suppliedSecret = request.headers['x-vercel-protection-bypass'];
    seenRequests.push({ path, suppliedSecret });

    if (path === '/running' && suppliedSecret === redactionSecret) {
      response.statusCode = 302;
      response.setHeader('location', `/leaked-${redactionSecret}`);
      response.end();
      return;
    }
    if (path === `/leaked-${redactionSecret}`) {
      response.setHeader('content-type', 'text/html');
      response.end('<div id="root">unexpected redirect</div>');
      return;
    }
    if (suppliedSecret !== workingSecret) {
      response.statusCode = 401;
      response.end('protected');
      return;
    }
    if (path === '/running' || path === '/cycling' || path === '/hiking') {
      response.setHeader('content-type', 'text/html; charset=utf-8');
      response.end('<div id="root">activity</div>');
      return;
    }
    const manifestMatch = path.match(
      /^\/data\/(running|cycling|hiking)\/manifest\.json$/
    );
    if (manifestMatch) {
      response.setHeader('content-type', 'application/json');
      response.end(
        JSON.stringify({
          schemaVersion: 1,
          mode: manifestMatch[1],
          activityCount: 1,
          publishedAt,
          latestActivityDate: publishedAt,
          latestYear: '2026',
          years: ['2026'],
          checksum: 'a'.repeat(64),
        })
      );
      return;
    }
    const metadataMatch = path.match(
      /^\/data\/(running|cycling|hiking)\/metadata\.json$/
    );
    if (metadataMatch) {
      response.setHeader('content-type', 'application/json');
      response.end(JSON.stringify([monitorActivityByMode[metadataMatch[1]]]));
      return;
    }
    const routeMatch = path.match(
      /^\/data\/(running|cycling|hiking)\/routes\/2026\.json$/
    );
    if (routeMatch) {
      response.setHeader('content-type', 'application/json');
      response.end(
        JSON.stringify([
          {
            run_id: routeMatch[1],
            summary_polyline: 'encoded-polyline',
          },
        ])
      );
      return;
    }
    response.statusCode = 404;
    response.end('not found');
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  const origin = `http://127.0.0.1:${address.port}`;

  try {
    const passed = await runNode(
      [
        'scripts/monitor-deployment.mjs',
        '--origin',
        origin,
        '--max-data-age-hours',
        '24',
      ],
      {
        env: {
          VERCEL_AUTOMATION_BYPASS_SECRET: workingSecret,
        },
      }
    );
    assert.equal(passed.code, 0, passed.stderr);
    assert.deepEqual(
      seenRequests.map(({ path }) => path),
      [
        '/running',
        '/data/running/manifest.json',
        '/data/running/metadata.json',
        '/data/running/routes/2026.json',
        '/cycling',
        '/data/cycling/manifest.json',
        '/data/cycling/metadata.json',
        '/data/cycling/routes/2026.json',
        '/hiking',
        '/data/hiking/manifest.json',
        '/data/hiking/metadata.json',
        '/data/hiking/routes/2026.json',
      ]
    );
    assert.ok(
      seenRequests.every(
        ({ suppliedSecret }) => suppliedSecret === workingSecret
      )
    );

    seenRequests.length = 0;
    const failed = await runNode(
      [
        'scripts/monitor-deployment.mjs',
        '--origin',
        origin,
        '--max-data-age-hours',
        '24',
      ],
      {
        env: {
          VERCEL_AUTOMATION_BYPASS_SECRET: redactionSecret,
        },
      }
    );
    assert.notEqual(failed.code, 0);
    assert.doesNotMatch(
      failed.stdout + failed.stderr,
      new RegExp(redactionSecret)
    );
    assert.match(failed.stderr, /\[redacted\]/);
  } finally {
    await new Promise((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve()))
    );
  }
});

test('deployment monitor fails closed on a stale publication even when activity is recent', async () => {
  const server = createServer((request, response) => {
    const path = new URL(request.url, 'http://localhost').pathname;
    if (path === '/running' || path === '/cycling') {
      response.setHeader('content-type', 'text/html; charset=utf-8');
      response.end('<div id="root">activity</div>');
      return;
    }
    const manifestMatch = path.match(
      /^\/data\/(running|cycling)\/manifest\.json$/
    );
    if (manifestMatch) {
      response.setHeader('content-type', 'application/json');
      response.end(
        JSON.stringify({
          schemaVersion: 1,
          mode: manifestMatch[1],
          activityCount: 1,
          publishedAt: new Date(Date.now() - 31 * 60 * 60 * 1000).toISOString(),
          latestActivityDate: new Date().toISOString(),
          latestYear: '2026',
          years: ['2026'],
          checksum: 'a'.repeat(64),
        })
      );
      return;
    }
    if (/^\/data\/running\/metadata\.json$/.test(path)) {
      response.setHeader('content-type', 'application/json');
      response.end(JSON.stringify([monitorActivityByMode.running]));
      return;
    }
    response.statusCode = 404;
    response.end('not found');
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();

  try {
    const result = await runNode([
      'scripts/monitor-deployment.mjs',
      '--origin',
      `http://127.0.0.1:${address.port}`,
      '--max-data-age-hours',
      '30',
    ]);
    assert.notEqual(result.code, 0);
    assert.match(result.stderr, /publication is 31\.\d hours old/i);
  } finally {
    await new Promise((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve()))
    );
  }
});

test('deployment monitor rejects same-origin mode redirects', async () => {
  const server = createServer((request, response) => {
    const path = new URL(request.url, 'http://localhost').pathname;
    if (path === '/running') {
      response.setHeader('content-type', 'text/html');
      response.end('<div id="root">running</div>');
      return;
    }
    if (path === '/cycling') {
      response.statusCode = 302;
      response.setHeader('location', '/running');
      response.end();
      return;
    }
    const manifestMatch = path.match(
      /^\/data\/(running|cycling)\/manifest\.json$/
    );
    if (manifestMatch) {
      response.setHeader('content-type', 'application/json');
      response.end(
        JSON.stringify({
          schemaVersion: 1,
          mode: manifestMatch[1],
          activityCount: 1,
          publishedAt: new Date().toISOString(),
          latestActivityDate: new Date().toISOString(),
          latestYear: '2026',
          years: ['2026'],
          checksum: 'a'.repeat(64),
        })
      );
      return;
    }
    if (/^\/data\/running\/metadata\.json$/.test(path)) {
      response.setHeader('content-type', 'application/json');
      response.end(JSON.stringify([monitorActivityByMode.running]));
      return;
    }
    if (/^\/data\/running\/routes\/2026\.json$/.test(path)) {
      response.setHeader('content-type', 'application/json');
      response.end(JSON.stringify([{ run_id: 1, summary_polyline: 'route' }]));
      return;
    }
    response.statusCode = 404;
    response.end('not found');
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();

  try {
    const result = await runNode([
      'scripts/monitor-deployment.mjs',
      '--origin',
      `http://127.0.0.1:${address.port}`,
      '--max-data-age-hours',
      '30',
    ]);
    assert.notEqual(result.code, 0);
    assert.match(result.stderr, /redirected to .*\/running/i);
  } finally {
    await new Promise((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve()))
    );
  }
});

test('CI verification and rollback capture resolve the canonical alias exactly', async () => {
  const sha = 'a'.repeat(40);
  const output = await mkdtemp(join(tmpdir(), 'vercel-rollback-'));
  const server = createServer((request, response) => {
    const url = new URL(request.url, 'http://localhost');
    response.setHeader('content-type', 'application/json');
    if (url.pathname.endsWith('/actions/runs/42')) {
      response.end(
        JSON.stringify({
          id: 42,
          name: 'CI',
          head_sha: sha,
          head_branch: 'master',
          event: 'workflow_dispatch',
          status: 'completed',
          conclusion: 'success',
          repository: { full_name: 'Dylan632/cycling_page' },
        })
      );
      return;
    }
    if (url.pathname === '/v4/aliases/records.example') {
      assert.equal(url.searchParams.get('teamId'), 'team_test');
      response.end(
        JSON.stringify({
          alias: 'records.example',
          projectId: 'prj_test',
          deployment: {
            id: 'dpl_previous',
            url: 'previous.example.vercel.app',
          },
        })
      );
      return;
    }
    if (url.pathname === '/v4/aliases/preview.records.example') {
      response.end(
        JSON.stringify({
          alias: 'preview.records.example',
          projectId: 'prj_test',
          target: 'preview',
          deployment: {
            id: 'dpl_previous',
            url: 'previous.example.vercel.app',
          },
        })
      );
      return;
    }
    if (url.pathname === '/v13/deployments/dpl_previous') {
      assert.equal(url.searchParams.get('teamId'), 'team_test');
      response.end(
        JSON.stringify({
          id: 'dpl_previous',
          url: 'previous.example.vercel.app',
          projectId: 'prj_test',
          readyState: 'READY',
          target: 'production',
          created: 1,
          aliases: ['records.example'],
          meta: { githubCommitSha: 'b'.repeat(40) },
        })
      );
      return;
    }
    response.statusCode = 404;
    response.end('{}');
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  const apiOrigin = `http://127.0.0.1:${address.port}`;

  try {
    const verified = await runNode(
      [
        'scripts/verify-github-ci.mjs',
        '--repository',
        'Dylan632/cycling_page',
        '--sha',
        sha,
        '--branch',
        'master',
        '--run-id',
        '42',
      ],
      {
        env: {
          GITHUB_TOKEN: 'test-token',
          GITHUB_API_URL: apiOrigin,
        },
      }
    );
    assert.equal(verified.code, 0, verified.stderr);
    assert.match(verified.stdout, /verified a{40}/);

    const missingToken = await runNode([
      'scripts/verify-github-ci.mjs',
      '--repository',
      'Dylan632/cycling_page',
      '--sha',
      sha,
      '--run-id',
      '42',
    ]);
    assert.notEqual(missingToken.code, 0);
    assert.match(missingToken.stderr, /failed closed/);

    const snapshotPath = join(output, 'previous-production.json');
    const captured = await runNode(
      [
        'scripts/capture-vercel-production.mjs',
        '--origin',
        'https://records.example',
        '--expected-deployment-url',
        'https://previous.example.vercel.app',
        '--expected-source-sha',
        'b'.repeat(40),
        '--output',
        snapshotPath,
      ],
      {
        env: {
          VERCEL_TOKEN: 'test-token',
          VERCEL_PROJECT_ID: 'prj_test',
          VERCEL_ORG_ID: 'team_test',
          VERCEL_API_URL: apiOrigin,
        },
      }
    );
    assert.equal(captured.code, 0, captured.stderr);
    const snapshot = await readJson(snapshotPath);
    assert.equal(snapshot.deploymentId, 'dpl_previous');
    assert.equal(snapshot.deploymentUrl, 'https://previous.example.vercel.app');
    assert.equal(snapshot.sourceSha, 'b'.repeat(40));
    assert.equal(snapshot.canonicalOrigin, 'https://records.example');
    assert.equal(snapshot.alias, 'records.example');

    const wrongAliasTarget = await runNode(
      [
        'scripts/capture-vercel-production.mjs',
        '--origin',
        'https://preview.records.example',
        '--output',
        join(output, 'preview-target.json'),
      ],
      {
        env: {
          VERCEL_TOKEN: 'test-token',
          VERCEL_PROJECT_ID: 'prj_test',
          VERCEL_ORG_ID: 'team_test',
          VERCEL_API_URL: apiOrigin,
        },
      }
    );
    assert.notEqual(wrongAliasTarget.code, 0);
    assert.match(wrongAliasTarget.stderr, /target is preview/);
  } finally {
    await new Promise((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve()))
    );
    await rm(output, { recursive: true, force: true });
  }
});

test('rollback capture fails closed when the canonical alias points at an ERROR deployment', async () => {
  const output = await mkdtemp(join(tmpdir(), 'vercel-error-'));
  const server = createServer((request, response) => {
    const url = new URL(request.url, 'http://localhost');
    response.setHeader('content-type', 'application/json');
    if (url.pathname === '/v4/aliases/records.example') {
      response.end(
        JSON.stringify({
          alias: 'records.example',
          projectId: 'prj_test',
          target: 'production',
          deployment: {
            id: 'dpl_error',
            url: 'error.example.vercel.app',
          },
        })
      );
      return;
    }
    if (url.pathname === '/v13/deployments/dpl_error') {
      response.end(
        JSON.stringify({
          id: 'dpl_error',
          url: 'error.example.vercel.app',
          projectId: 'prj_test',
          readyState: 'ERROR',
          target: 'production',
          aliases: ['records.example'],
        })
      );
      return;
    }
    response.statusCode = 404;
    response.end('{}');
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();

  try {
    const result = await runNode(
      [
        'scripts/capture-vercel-production.mjs',
        '--origin',
        'https://records.example',
        '--output',
        join(output, 'snapshot.json'),
      ],
      {
        env: {
          VERCEL_TOKEN: 'test-token',
          VERCEL_PROJECT_ID: 'prj_test',
          VERCEL_ORG_ID: 'team_test',
          VERCEL_API_URL: `http://127.0.0.1:${address.port}`,
        },
      }
    );
    assert.notEqual(result.code, 0);
    assert.match(result.stderr, /ERROR/);
  } finally {
    await new Promise((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve()))
    );
    await rm(output, { recursive: true, force: true });
  }
});
