#!/usr/bin/env node

import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import process from 'node:process';
import { pathToFileURL } from 'node:url';
import {
  assertPublishedActivitiesMatchPolicy,
  createActivityPublicationPolicy,
} from './lib/activity-policy.mjs';

const ACTIVITY_PROFILE_PATH = new URL(
  '../src/modules/activity/activity-profiles.json',
  import.meta.url
);

const loadActivityProfiles = async () => {
  const source = JSON.parse(await readFile(ACTIVITY_PROFILE_PATH, 'utf8'));
  const profiles = Object.entries(source?.profiles ?? {}).map(
    ([key, profile]) => createActivityPublicationPolicy(profile, key)
  );
  if (profiles.length === 0) {
    throw new Error('Activity profile has no modes to monitor');
  }
  return profiles;
};

const parseArgs = (argv) => {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    if (!key.startsWith('--')) {
      throw new Error(`Unexpected argument: ${key}`);
    }
    const name = key.slice(2);
    if (name === 'require-cache' || name === 'require-browser') {
      args[name] = true;
      continue;
    }
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) {
      throw new Error(`Missing value for ${key}`);
    }
    args[name] = value;
    index += 1;
  }
  return args;
};

const normalizeOrigin = (value) => {
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new Error('Deployment origin must use HTTP or HTTPS');
  }
  if (url.pathname !== '/' || url.search || url.hash) {
    throw new Error(
      'Deployment origin must not include a path, query, or hash'
    );
  }
  return url.origin;
};

const redactSecret = (value, secret) => {
  const message = value instanceof Error ? value.message : String(value);
  return secret ? message.split(secret).join('[redacted]') : message;
};

const fetchChecked = async (
  url,
  expectedContentType,
  { protectionBypass } = {}
) => {
  const expectedUrl = new URL(url);
  const response = await fetch(url, {
    headers: {
      'user-agent': 'cycling-page-deployment-monitor/1',
      ...(protectionBypass
        ? { 'x-vercel-protection-bypass': protectionBypass }
        : {}),
    },
    redirect: 'manual',
    signal: AbortSignal.timeout(20_000),
  });
  if (response.status >= 300 && response.status < 400) {
    const location = response.headers.get('location');
    if (!location) {
      throw new Error(
        `${url} returned HTTP ${response.status} without Location`
      );
    }
    const redirectUrl = new URL(location, expectedUrl);
    if (redirectUrl.origin !== expectedUrl.origin) {
      throw new Error(
        `${url} redirected to a different origin: ${redirectUrl.href}`
      );
    }
    if (redirectUrl.pathname !== expectedUrl.pathname) {
      throw new Error(`${url} redirected to ${redirectUrl.pathname}`);
    }
    throw new Error(`${url} returned an unexpected redirect`);
  }
  if (!response.ok) {
    throw new Error(`${url} returned HTTP ${response.status}`);
  }
  const finalUrl = new URL(response.url);
  if (finalUrl.origin !== expectedUrl.origin) {
    throw new Error(`${url} redirected to a different origin: ${response.url}`);
  }
  if (finalUrl.pathname !== expectedUrl.pathname) {
    throw new Error(`${url} redirected to ${finalUrl.pathname}`);
  }
  const contentType = response.headers.get('content-type') ?? '';
  if (!contentType.toLowerCase().includes(expectedContentType)) {
    throw new Error(
      `${url} returned ${contentType || 'no content type'}, expected ${expectedContentType}`
    );
  }
  return response;
};

const assertClientCachePolicy = (response) => {
  const cacheControl = response.headers.get('cache-control') ?? '';
  if (!cacheControl.includes('max-age=0')) {
    throw new Error(
      `${response.url} must require browser revalidation; got ${cacheControl || 'no Cache-Control'}`
    );
  }
  if (!cacheControl.includes('must-revalidate')) {
    throw new Error(
      `${response.url} must use must-revalidate; got ${cacheControl || 'no Cache-Control'}`
    );
  }
};

const parseManifestTimestamp = (value, field, { requireUtc = false } = {}) => {
  if (typeof value !== 'string' || value.length < 10) {
    throw new Error(`manifest ${field} is missing`);
  }
  if (requireUtc && !value.endsWith('Z')) {
    throw new Error(`manifest ${field} must be an ISO 8601 UTC timestamp`);
  }
  const normalized = /(?:Z|[+-]\d\d:\d\d)$/.test(value)
    ? value
    : `${value.replace(' ', 'T')}Z`;
  const timestamp = Date.parse(normalized);
  if (!Number.isFinite(timestamp)) {
    throw new Error(`manifest ${field} is invalid: ${value}`);
  }
  return timestamp;
};

const inspectActivityData = async ({
  origin,
  profile,
  maxDataAgeHours,
  requireCache,
  protectionBypass,
}) => {
  const { mode } = profile;
  const manifestResponse = await fetchChecked(
    `${origin}/data/${mode}/manifest.json`,
    'application/json',
    { protectionBypass }
  );
  if (requireCache) assertClientCachePolicy(manifestResponse);
  const manifest = await manifestResponse.json();

  if (
    manifest.schemaVersion !== 1 ||
    manifest.mode !== mode ||
    !Number.isInteger(manifest.activityCount) ||
    manifest.activityCount <= 0 ||
    !Array.isArray(manifest.years) ||
    !manifest.years.includes(manifest.latestYear) ||
    !/^[a-f0-9]{64}$/.test(manifest.checksum ?? '')
  ) {
    throw new Error(`${mode} manifest failed schema validation`);
  }

  const publishedTimestamp = parseManifestTimestamp(
    manifest.publishedAt,
    'publishedAt',
    { requireUtc: true }
  );
  const publicationAgeHours = (Date.now() - publishedTimestamp) / 3_600_000;
  if (publicationAgeHours < -1) {
    throw new Error(`${mode} publication is dated too far in the future`);
  }
  if (publicationAgeHours > maxDataAgeHours) {
    throw new Error(
      `${mode} publication is ${publicationAgeHours.toFixed(
        1
      )} hours old (limit ${maxDataAgeHours})`
    );
  }
  const latestActivityTimestamp = parseManifestTimestamp(
    manifest.latestActivityDate,
    'latestActivityDate'
  );
  if (latestActivityTimestamp - Date.now() > 24 * 3_600_000) {
    throw new Error(`${mode} latest activity is dated too far in the future`);
  }

  const metadataResponse = await fetchChecked(
    `${origin}/data/${mode}/metadata.json`,
    'application/json',
    { protectionBypass }
  );
  if (requireCache) assertClientCachePolicy(metadataResponse);
  const activities = await metadataResponse.json();
  assertPublishedActivitiesMatchPolicy({
    activities,
    expectedCount: manifest.activityCount,
    policy: profile,
  });

  const routeResponse = await fetchChecked(
    `${origin}/data/${mode}/routes/${manifest.latestYear}.json`,
    'application/json',
    { protectionBypass }
  );
  if (requireCache) assertClientCachePolicy(routeResponse);
  const routes = await routeResponse.json();
  if (
    !Array.isArray(routes) ||
    routes.length === 0 ||
    !routes.some(
      (activity) =>
        typeof activity?.summary_polyline === 'string' &&
        activity.summary_polyline.length > 0
    )
  ) {
    throw new Error(
      `${mode} ${manifest.latestYear} route snapshot has no usable geometry`
    );
  }

  process.stdout.write(
    `${mode}: ${manifest.activityCount} activities, publication fresh (${publicationAgeHours.toFixed(
      1
    )}h), ${routes.length} routed activities\n`
  );
};

const sleep = (milliseconds) =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

export const disposeBrowserProbe = async ({ child, profileDirectory }) => {
  if (child.exitCode === null && child.signalCode === null) {
    const exit = once(child, 'exit');
    child.kill('SIGKILL');
    await exit;
  }
  await rm(profileDirectory, {
    recursive: true,
    force: true,
    maxRetries: 3,
    retryDelay: 100,
  });
};

const isAllowedBrowserNoise = (message) => {
  if (
    /(?:^WebGL: software fallback is deprecated$|Automatic fallback to software WebGL has been deprecated|GPU process exited|ANGLE Display::initialize error|GL Driver Message)/i.test(
      message
    )
  ) {
    return true;
  }

  return (
    /https:\/\/tiles\.basemaps\.cartocdn\.com\/fonts\/[^\s'"\]]+\.pbf/i.test(
      message
    ) &&
    /(?:blocked by CORS policy|No 'Access-Control-Allow-Origin' header|Failed to load resource:\s*net::ERR_FAILED)/i.test(
      message
    )
  );
};

export const validateBrowserProbe = ({
  origin,
  mode,
  state,
  consoleErrors = [],
  pageErrors = [],
  failedRequests = [],
}) => {
  const expectedUrl = new URL(`/${mode}`, origin);
  const finalUrl = new URL(state.href);
  if (
    finalUrl.origin !== expectedUrl.origin ||
    finalUrl.pathname !== expectedUrl.pathname
  ) {
    throw new Error(
      `${mode} browser finished at ${finalUrl.href}, expected ${expectedUrl.href}`
    );
  }
  if (!state.rootHasContent) {
    throw new Error(`${mode} browser probe found an empty app root`);
  }
  if (state.markerMode !== mode) {
    throw new Error(
      `${mode} browser did not expose the matching mode-ready marker`
    );
  }
  if (state.currentModePath !== `/${mode}`) {
    throw new Error(
      `${mode} browser selected ${state.currentModePath ?? 'no current mode'}`
    );
  }
  if (state.hasFatalUi) {
    throw new Error(`${mode} browser rendered the fatal error boundary`);
  }
  if (!['mapbox', 'fallback'].includes(state.mapRenderer)) {
    throw new Error(`${mode} browser did not expose a map renderer`);
  }

  const actionableConsoleErrors = consoleErrors.filter(
    (message) => !isAllowedBrowserNoise(message)
  );
  const failures = [
    ...pageErrors.map((message) => `pageerror: ${message}`),
    ...actionableConsoleErrors.map((message) => `console.error: ${message}`),
    ...failedRequests.map(
      ({ url, errorText }) => `request failed: ${url} (${errorText})`
    ),
  ];
  if (failures.length > 0) {
    throw new Error(
      `${mode} browser detected frontend failures: ${failures.join(' | ')}`
    );
  }
};

const createCdpPipe = (child) => {
  const input = child.stdio[3];
  const output = child.stdio[4];
  let nextId = 1;
  let buffer = Buffer.alloc(0);
  const pending = new Map();
  const listeners = new Set();

  output.on('data', (chunk) => {
    buffer = Buffer.concat([buffer, chunk]);
    let delimiter = buffer.indexOf(0);
    while (delimiter !== -1) {
      const messageBuffer = buffer.subarray(0, delimiter);
      buffer = buffer.subarray(delimiter + 1);
      if (messageBuffer.length > 0) {
        const message = JSON.parse(messageBuffer.toString('utf8'));
        if (message.id) {
          const request = pending.get(message.id);
          if (request) {
            pending.delete(message.id);
            if (message.error) {
              request.reject(
                new Error(
                  `CDP ${request.method} failed: ${message.error.message}`
                )
              );
            } else {
              request.resolve(message.result);
            }
          }
        } else {
          for (const listener of listeners) listener(message);
        }
      }
      delimiter = buffer.indexOf(0);
    }
  });

  const send = (method, params = {}, sessionId) => {
    const id = nextId;
    nextId += 1;
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`CDP ${method} timed out`));
      }, 15_000);
      pending.set(id, {
        method,
        resolve: (value) => {
          clearTimeout(timeout);
          resolve(value);
        },
        reject: (error) => {
          clearTimeout(timeout);
          reject(error);
        },
      });
      input.write(
        `${JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) })}\0`
      );
    });
  };

  return {
    send,
    onEvent(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
};

const formatRemoteObject = (value) =>
  String(
    value.value ??
      value.unserializableValue ??
      value.description ??
      value.preview?.description ??
      ''
  );

const browserStateExpression = (mode) => `(() => {
  const marker = document.querySelector('[data-app-ready]');
  const current = document.querySelector('a[aria-current="page"][href]');
  const root = document.querySelector('#root');
  const renderer = document.querySelector('#map-container [data-map-renderer]');
  return {
    href: window.location.href,
    rootHasContent: Boolean(root && root.textContent && root.textContent.trim()),
    markerMode: marker && marker.getAttribute('data-app-ready'),
    currentModePath: current && new URL(current.href, window.location.href).pathname,
    hasFatalUi: document.body.textContent.includes('运动记录暂时无法加载'),
    mapRenderer: renderer && renderer.getAttribute('data-map-renderer')
  };
})()`;

export const buildSameOriginBypassHeaders = ({
  requestUrl,
  origin,
  requestHeaders = {},
  protectionBypass,
}) => {
  if (
    !protectionBypass ||
    new URL(requestUrl).origin !== new URL(origin).origin
  ) {
    return undefined;
  }
  return [
    ...Object.entries(requestHeaders)
      .filter(([name]) => name.toLowerCase() !== 'x-vercel-protection-bypass')
      .map(([name, value]) => ({ name, value: String(value) })),
    {
      name: 'x-vercel-protection-bypass',
      value: protectionBypass,
    },
  ];
};

const runBrowserProbe = async ({
  browserBin,
  origin,
  mode,
  protectionBypass,
}) => {
  const profileDirectory = await mkdtemp(
    join(tmpdir(), 'cycling-page-chrome-')
  );
  const childEnvironment = { ...process.env };
  for (const secretName of [
    'VERCEL_TOKEN',
    'VERCEL_AUTOMATION_BYPASS_SECRET',
    'GITHUB_TOKEN',
    'GH_TOKEN',
    'ACTIONS_ID_TOKEN_REQUEST_TOKEN',
  ]) {
    delete childEnvironment[secretName];
  }
  const child = spawn(
    browserBin,
    [
      '--headless=new',
      '--disable-dev-shm-usage',
      '--no-first-run',
      '--no-default-browser-check',
      '--remote-debugging-pipe',
      `--user-data-dir=${profileDirectory}`,
      'about:blank',
    ],
    {
      env: childEnvironment,
      stdio: ['ignore', 'ignore', 'pipe', 'pipe', 'pipe'],
    }
  );
  let stderr = '';
  child.stderr.on('data', (chunk) => {
    stderr += chunk;
  });

  try {
    const cdp = createCdpPipe(child);
    const target = await cdp.send('Target.createTarget', {
      url: 'about:blank',
    });
    const attached = await cdp.send('Target.attachToTarget', {
      targetId: target.targetId,
      flatten: true,
    });
    const sessionId = attached.sessionId;
    const consoleErrors = [];
    const pageErrors = [];
    const failedRequests = [];
    const requests = new Map();
    cdp.onEvent((event) => {
      if (event.sessionId !== sessionId) return;
      if (
        event.method === 'Runtime.consoleAPICalled' &&
        event.params.type === 'error'
      ) {
        consoleErrors.push(event.params.args.map(formatRemoteObject).join(' '));
      } else if (event.method === 'Runtime.exceptionThrown') {
        pageErrors.push(
          event.params.exceptionDetails.exception?.description ??
            event.params.exceptionDetails.text
        );
      } else if (
        event.method === 'Log.entryAdded' &&
        event.params.entry.level === 'error'
      ) {
        const { text, url } = event.params.entry;
        consoleErrors.push(url ? `${text} [source: ${url}]` : text);
      } else if (event.method === 'Network.requestWillBeSent') {
        requests.set(event.params.requestId, event.params.request.url);
      } else if (event.method === 'Network.loadingFailed') {
        const requestUrl = requests.get(event.params.requestId);
        if (requestUrl && new URL(requestUrl).origin === origin) {
          failedRequests.push({
            url: requestUrl,
            errorText: event.params.errorText,
          });
        }
      } else if (event.method === 'Fetch.requestPaused') {
        const headers = buildSameOriginBypassHeaders({
          requestUrl: event.params.request.url,
          origin,
          requestHeaders: event.params.request.headers,
          protectionBypass,
        });
        void cdp
          .send(
            'Fetch.continueRequest',
            {
              requestId: event.params.requestId,
              ...(headers ? { headers } : {}),
            },
            sessionId
          )
          .catch((error) => {
            pageErrors.push(
              `Protection bypass request interception failed: ${redactSecret(
                error,
                protectionBypass
              )}`
            );
          });
      }
    });

    await Promise.all(
      ['Page.enable', 'Runtime.enable', 'Network.enable', 'Log.enable'].map(
        (method) => cdp.send(method, {}, sessionId)
      )
    );
    if (protectionBypass) {
      await cdp.send(
        'Fetch.enable',
        {
          patterns: [
            {
              urlPattern: `${origin}/*`,
              requestStage: 'Request',
            },
          ],
        },
        sessionId
      );
    }
    await cdp.send('Page.navigate', { url: `${origin}/${mode}` }, sessionId);

    const deadline = Date.now() + 15_000;
    let state;
    while (Date.now() < deadline) {
      const evaluated = await cdp.send(
        'Runtime.evaluate',
        {
          expression: browserStateExpression(mode),
          returnByValue: true,
          awaitPromise: true,
        },
        sessionId
      );
      state = evaluated.result?.value;
      if (state?.markerMode === mode && state?.currentModePath === `/${mode}`) {
        break;
      }
      await sleep(250);
    }
    await sleep(750);
    const finalEvaluation = await cdp.send(
      'Runtime.evaluate',
      {
        expression: browserStateExpression(mode),
        returnByValue: true,
        awaitPromise: true,
      },
      sessionId
    );
    state = finalEvaluation.result?.value ?? state;
    validateBrowserProbe({
      origin,
      mode,
      state: state ?? {},
      consoleErrors,
      pageErrors,
      failedRequests,
    });
    process.stdout.write(`${mode}: browser render passed\n`);
  } catch (error) {
    const details = stderr.trim().slice(-1000);
    throw new Error(
      `${mode} browser probe failed: ${
        error instanceof Error ? error.message : String(error)
      }${details ? `; Chrome: ${details}` : ''}`
    );
  } finally {
    await disposeBrowserProbe({ child, profileDirectory });
  }
};

export const monitorDeployment = async ({
  origin,
  maxDataAgeHours = 30,
  requireCache = false,
  requireBrowser = false,
  browserBin = process.env.BROWSER_BIN,
  protectionBypass = process.env.VERCEL_AUTOMATION_BYPASS_SECRET,
}) => {
  const normalizedOrigin = normalizeOrigin(origin);
  const profiles = await loadActivityProfiles();
  if (
    !Number.isFinite(maxDataAgeHours) ||
    maxDataAgeHours <= 0 ||
    maxDataAgeHours > 24 * 90
  ) {
    throw new Error('max data age must be between 0 and 2160 hours');
  }

  for (const profile of profiles) {
    const { mode } = profile;
    const response = await fetchChecked(
      `${normalizedOrigin}/${mode}`,
      'text/html',
      { protectionBypass }
    );
    const html = await response.text();
    if (!html.includes('id="root"') && !html.includes("id='root'")) {
      throw new Error(`/${mode} did not return the SPA shell`);
    }
    await inspectActivityData({
      origin: normalizedOrigin,
      profile,
      maxDataAgeHours,
      requireCache,
      protectionBypass,
    });
    if (requireBrowser) {
      if (!browserBin) {
        throw new Error(
          'Browser monitoring is required but BROWSER_BIN is not configured'
        );
      }
      await runBrowserProbe({
        browserBin,
        origin: normalizedOrigin,
        mode,
        protectionBypass,
      });
    }
  }
};

const wait = (milliseconds) =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

const main = async () => {
  const args = parseArgs(process.argv.slice(2));
  const attempts = Number(args.attempts ?? 1);
  const retryDelayMs = Number(args['retry-delay-ms'] ?? 5_000);
  const options = {
    origin: args.origin,
    maxDataAgeHours: Number(args['max-data-age-hours'] ?? 30),
    requireCache: Boolean(args['require-cache']),
    requireBrowser: Boolean(args['require-browser']),
    browserBin: args['browser-bin'] ?? process.env.BROWSER_BIN,
    protectionBypass: process.env.VERCEL_AUTOMATION_BYPASS_SECRET,
  };

  if (!Number.isInteger(attempts) || attempts < 1 || attempts > 12) {
    throw new Error('attempts must be an integer between 1 and 12');
  }
  if (
    !Number.isFinite(retryDelayMs) ||
    retryDelayMs < 0 ||
    retryDelayMs > 30_000
  ) {
    throw new Error('retry delay must be between 0 and 30000 ms');
  }

  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      await monitorDeployment(options);
      process.stdout.write('deployment monitor passed\n');
      return;
    } catch (error) {
      lastError = error;
      process.stderr.write(
        `deployment monitor attempt ${attempt}/${attempts} failed: ${redactSecret(
          error,
          options.protectionBypass
        )}\n`
      );
      if (attempt < attempts) await wait(retryDelayMs);
    }
  }
  throw lastError;
};

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main().catch((error) => {
    process.stderr.write(
      `deployment monitor failed: ${redactSecret(
        error,
        process.env.VERCEL_AUTOMATION_BYPASS_SECRET
      )}\n`
    );
    process.exitCode = 1;
  });
}
