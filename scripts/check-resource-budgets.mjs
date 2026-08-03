import { gzipSync } from 'node:zlib';
import { readFile } from 'node:fs/promises';
import { resolve, sep } from 'node:path';

const parseArgs = (argv) => {
  const args = {
    activityBudget: 40_000,
    criticalBudget: 350_000,
    data: 'public/data',
    dist: 'dist',
    profile: 'src/modules/activity/activity-profiles.json',
  };

  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (!value) throw new Error(`Missing value for ${flag}`);

    if (flag === '--activity-budget') {
      args.activityBudget = Number(value);
    } else if (flag === '--critical-budget') {
      args.criticalBudget = Number(value);
    } else if (flag === '--data') {
      args.data = value;
    } else if (flag === '--dist') {
      args.dist = value;
    } else if (flag === '--profile') {
      args.profile = value;
    } else {
      throw new Error(`Unknown argument: ${flag}`);
    }
  }

  if (
    !Number.isFinite(args.activityBudget) ||
    args.activityBudget <= 0 ||
    !Number.isFinite(args.criticalBudget) ||
    args.criticalBudget <= 0
  ) {
    throw new Error('Resource budgets must be positive numbers');
  }
  return args;
};

const readJson = async (path) => JSON.parse(await readFile(path, 'utf8'));

const resolveInside = (directory, relativePath) => {
  const root = resolve(directory);
  const path = resolve(root, relativePath);
  if (path !== root && !path.startsWith(`${root}${sep}`)) {
    throw new Error(`Manifest path escapes its root: ${relativePath}`);
  }
  return path;
};

const gzipSize = async (path) => gzipSync(await readFile(path)).byteLength;

const collectStaticFiles = (manifest, entryKey, collected = new Set()) => {
  if (collected.has(entryKey)) return collected;
  const entry = manifest[entryKey];
  if (!entry) throw new Error(`Missing manifest entry: ${entryKey}`);
  collected.add(entryKey);
  for (const dependency of entry.imports ?? []) {
    collectStaticFiles(manifest, dependency, collected);
  }
  return collected;
};

const checkCriticalRoute = async ({
  budget,
  distDirectory,
  manifest,
  routeKey,
}) => {
  const entries = collectStaticFiles(manifest, routeKey);
  entries.add('index.html');
  const files = new Set(['index.html']);

  for (const key of entries) {
    const entry = manifest[key];
    if (!entry) continue;
    if (entry.file) files.add(entry.file);
    for (const css of entry.css ?? []) files.add(css);
    for (const asset of entry.assets ?? []) files.add(asset);
  }

  let compressedBytes = 0;
  for (const file of files) {
    compressedBytes += await gzipSize(resolveInside(distDirectory, file));
  }
  if (compressedBytes >= budget) {
    throw new Error(
      `${routeKey} critical resources are ${compressedBytes} bytes gzip; budget is ${budget}`
    );
  }
  process.stdout.write(
    `${routeKey}: ${compressedBytes}/${budget} critical gzip bytes\\n`
  );
};

const checkActivityData = async ({ budget, dataDirectory, mode }) => {
  const modeDirectory = resolveInside(dataDirectory, mode);
  const manifest = await readJson(
    resolveInside(modeDirectory, 'manifest.json')
  );
  const latestYear = String(manifest.latestYear ?? '');
  if (!/^\\d{4}$/.test(latestYear)) {
    throw new Error(`${mode} manifest has no valid latestYear`);
  }

  const metadataBytes = await gzipSize(
    resolveInside(modeDirectory, 'metadata.json')
  );
  const routeBytes = await gzipSize(
    resolveInside(modeDirectory, `routes/${latestYear}.json`)
  );
  const totalBytes = metadataBytes + routeBytes;
  if (totalBytes >= budget) {
    throw new Error(
      `${mode} initial activity data is ${totalBytes} bytes gzip; budget is ${budget}`
    );
  }
  process.stdout.write(
    `${mode}: ${totalBytes}/${budget} initial activity gzip bytes\\n`
  );
};

const check = async (args) => {
  const distDirectory = resolve(args.dist);
  const dataDirectory = resolve(args.data);
  const profileSource = await readJson(resolve(args.profile));
  const activityModes = Object.keys(profileSource?.profiles ?? {});
  if (activityModes.length === 0) {
    throw new Error('Activity profile has no modes to check');
  }
  const manifest = await readJson(
    resolveInside(distDirectory, '.vite/manifest.json')
  );
  const homeRouteKey = 'src/pages/index.tsx';
  const summaryRouteKey = 'src/pages/total.tsx';
  const mapKey = 'src/components/RunMap/index.tsx';
  const homeStaticEntries = collectStaticFiles(manifest, homeRouteKey);

  if (homeStaticEntries.has(mapKey)) {
    throw new Error('Mapbox is in the route-critical static import closure');
  }
  if (!(manifest[homeRouteKey]?.dynamicImports ?? []).includes(mapKey)) {
    throw new Error('RunMap must remain a dynamic import of the activity page');
  }
  process.stdout.write(
    'Mapbox remains dynamic and outside the critical path\\n'
  );

  await Promise.all([
    checkCriticalRoute({
      budget: args.criticalBudget,
      distDirectory,
      manifest,
      routeKey: homeRouteKey,
    }),
    checkCriticalRoute({
      budget: args.criticalBudget,
      distDirectory,
      manifest,
      routeKey: summaryRouteKey,
    }),
    ...activityModes.map((mode) =>
      checkActivityData({
        budget: args.activityBudget,
        dataDirectory,
        mode,
      })
    ),
  ]);
};

try {
  await check(parseArgs(process.argv.slice(2)));
} catch (error) {
  process.stderr.write(
    `${error instanceof Error ? error.message : String(error)}\\n`
  );
  process.exitCode = 1;
}
