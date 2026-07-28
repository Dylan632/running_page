import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  access,
  appendFile,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rename,
  rm,
} from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { readActivityJson } from './lib/activity-json.mjs';
import {
  assertPublishedActivitiesMatchPolicy,
  createActivityPublicationPolicy,
} from './lib/activity-policy.mjs';

const DEFAULT_PROFILE_PATH = 'src/modules/activity/activity-profiles.json';
const KNOWN_COMMANDS = new Set([
  'export-profile',
  'generate',
  'plan',
  'verify',
]);

const parseArgs = (argv) => {
  const command = argv[0];
  if (!KNOWN_COMMANDS.has(command)) {
    throw new Error(
      'Usage: generate-activity-artifacts.mjs <export-profile|generate|plan|verify> [options]'
    );
  }

  const args = {
    assetsOutput: 'assets',
    athlete: 'Dylan',
    birthMonth: '1989-03',
    command,
    dataOutput: 'public/data',
    githubEnv: '',
    input: '',
    mode: command === 'verify' ? 'all' : '',
    profilePath: DEFAULT_PROFILE_PATH,
    publishedAt: '',
    python: 'python3',
  };

  for (let index = 1; index < argv.length; index += 1) {
    const flag = argv[index];
    const value = argv[index + 1];
    const options = {
      '--assets-output': 'assetsOutput',
      '--athlete': 'athlete',
      '--birth-month': 'birthMonth',
      '--data-output': 'dataOutput',
      '--github-env': 'githubEnv',
      '--input': 'input',
      '--mode': 'mode',
      '--profile': 'profilePath',
      '--published-at': 'publishedAt',
      '--python': 'python',
    };
    const property = options[flag];
    if (!property || value === undefined || value.startsWith('--')) {
      throw new Error(`Unknown or incomplete argument: ${flag}`);
    }
    args[property] = value;
    index += 1;
  }

  if (command !== 'verify' && !args.mode) {
    throw new Error('--mode is required');
  }
  if (['generate', 'plan'].includes(command) && !args.input) {
    throw new Error('--input is required');
  }
  if (['generate', 'plan'].includes(command) && !args.publishedAt) {
    throw new Error('--published-at is required');
  }
  if (args.publishedAt) {
    const timestamp = Date.parse(args.publishedAt);
    if (!Number.isFinite(timestamp) || !args.publishedAt.endsWith('Z')) {
      throw new Error('--published-at must be an ISO-8601 UTC timestamp');
    }
    args.publishedAt = new Date(timestamp).toISOString();
  }
  if (command === 'export-profile' && !args.githubEnv) {
    throw new Error('--github-env is required');
  }
  return args;
};

const readProfiles = async (profilePath) => {
  const source = JSON.parse(await readFile(profilePath, 'utf8'));
  if (
    source?.schemaVersion !== 1 ||
    !source.profiles ||
    typeof source.profiles !== 'object'
  ) {
    throw new Error(`Invalid activity profile schema: ${profilePath}`);
  }
  return source.profiles;
};

const requireProfile = (profiles, mode) => {
  const profile = profiles[mode];
  if (!profile || profile.mode !== mode) {
    throw new Error(`Unknown activity mode: ${mode}`);
  }
  if (
    !Array.isArray(profile.activityTypes) ||
    !Array.isArray(profile.publication?.excludeRunIds) ||
    !Array.isArray(profile.publication?.excludeSubtypes) ||
    !Array.isArray(profile.poster?.specialDistancesKm) ||
    profile.poster.specialDistancesKm.length !== 2 ||
    !profile.poster.outputNamespace
  ) {
    throw new Error(`Incomplete activity profile: ${mode}`);
  }
  if (
    profile.poster.outputNamespace.includes('/') ||
    profile.poster.outputNamespace.includes('\\') ||
    profile.poster.outputNamespace.startsWith('.')
  ) {
    throw new Error(`Unsafe poster output namespace: ${mode}`);
  }
  return profile;
};

const getYears = async (inputPath, profile) => {
  const activities = await readActivityJson(inputPath);
  if (!Array.isArray(activities)) {
    throw new Error('Activity input must be a JSON array');
  }

  const acceptedTypes = new Set(profile.activityTypes);
  const excludedIds = new Set(profile.publication.excludeRunIds.map(String));
  const excludedSubtypes = new Set(
    profile.publication.excludeSubtypes.map((subtype) =>
      subtype.trim().toLowerCase()
    )
  );
  const minimumDistance = Number(profile.publication.minDistanceMeters);
  const years = new Set();

  for (const activity of activities) {
    if (
      !activity ||
      !acceptedTypes.has(activity.type) ||
      excludedIds.has(String(activity.run_id)) ||
      excludedSubtypes.has(
        String(activity.subtype ?? '')
          .trim()
          .toLowerCase()
      ) ||
      Number(activity.distance ?? 0) <= minimumDistance
    ) {
      continue;
    }
    const match = String(activity.start_date_local ?? '').match(/^(\d{4})-/);
    if (match) years.add(match[1]);
  }

  if (years.size === 0) {
    throw new Error(`No ${profile.mode} years remain for artifact generation`);
  }
  return [...years].sort();
};

const option = (name, value) => [name, String(value)];

const posterBaseCommand = (args, profile) => {
  const [specialDistance, specialDistance2] = profile.poster.specialDistancesKm;
  const colors = profile.poster.colors;

  return [
    args.python,
    'run_page/gen_svg.py',
    ...option('--from-json', args.input),
    ...profile.activityTypes.flatMap((activityType) =>
      option('--activity-type', activityType)
    ),
    ...profile.publication.excludeRunIds.flatMap((runId) =>
      option('--exclude-run-id', runId)
    ),
    ...profile.publication.excludeSubtypes.flatMap((subtype) =>
      option('--exclude-subtype', subtype)
    ),
    ...option('--athlete', args.athlete),
    ...option('--sport-type', profile.poster.sportType),
    '--use-localtime',
    ...option('--special-distance', specialDistance),
    ...option('--special-distance2', specialDistance2),
    ...option('--background-color', colors.background),
    ...option('--track-color', colors.track),
    ...option('--text-color', colors.text),
    ...option('--special-color', colors.special),
    ...option('--special-color2', colors.special2),
  ];
};

const posterCommand = (base, values) => [...base, ...values.flat()];

const buildPlan = async (
  args,
  profiles,
  { assetsOutput = args.assetsOutput, dataOutput = args.dataOutput } = {}
) => {
  const profile = requireProfile(profiles, args.mode);
  const years = await getYears(args.input, profile);
  const namespace = profile.poster.outputNamespace;
  const assetDirectory = join(assetsOutput, namespace);
  const base = posterBaseCommand(args, profile);
  const yearLabel =
    profile.copy?.heatmapTitle?.replace(/\s+Heatmap$/u, '') ||
    profile.poster.sportType;
  const monthTitle = `${profile.poster.activityLabel} Month of Life`;
  const posters = [
    {
      kind: 'heatmap',
      command: posterCommand(base, [
        option('--type', 'github'),
        option('--github-style', 'align-firstday'),
        option('--title', profile.poster.title),
        option('--min-distance', profile.poster.minimumDistanceKm),
        option('--output', join(assetDirectory, 'github.svg')),
      ]),
    },
    {
      kind: 'grid',
      command: posterCommand(base, [
        option('--type', 'grid'),
        option('--title', profile.poster.gridTitle),
        option('--min-distance', profile.poster.gridMinimumDistanceKm),
        option('--output', join(assetDirectory, 'grid.svg')),
      ]),
    },
    {
      kind: 'circular-years',
      command: posterCommand(base, [
        option('--type', 'circular'),
        option('--min-distance', profile.poster.minimumDistanceKm),
        option('--output', join(assetDirectory, 'year.svg')),
      ]),
    },
    ...years.map((year) => ({
      kind: `heatmap-${year}`,
      command: posterCommand(base, [
        option('--type', 'github'),
        option('--github-style', 'align-firstday'),
        option('--language', 'zh_CN'),
        option('--year', year),
        option('--title', `${year} ${yearLabel}`),
        option('--min-distance', profile.poster.minimumDistanceKm),
        option('--output', join(assetDirectory, `github_${year}.svg`)),
      ]),
    })),
    {
      kind: 'month-of-life',
      command: posterCommand(base, [
        option('--type', 'monthoflife'),
        option('--birth', args.birthMonth),
        option('--title', monthTitle),
        option('--min-distance', profile.poster.minimumDistanceKm),
        option('--output', join(assetDirectory, 'mol.svg')),
      ]),
    },
    {
      kind: 'mode-month-of-life',
      command: posterCommand(base, [
        option('--type', 'monthoflife'),
        option('--birth', args.birthMonth),
        option('--title', monthTitle),
        option('--min-distance', profile.poster.minimumDistanceKm),
        option(
          '--output',
          join(assetDirectory, `mol_${profile.poster.sportType}.svg`)
        ),
      ]),
    },
    {
      kind: 'year-summaries',
      command: posterCommand(base, [
        option('--type', 'year_summary'),
        option('--min-distance', profile.poster.minimumDistanceKm),
        option('--output', join(assetDirectory, 'year_summary.svg')),
      ]),
    },
  ];

  return {
    mode: args.mode,
    namespace,
    years,
    profilePath: args.profilePath,
    publication: {
      command: [
        process.execPath,
        'scripts/publish-activity-data.mjs',
        '--profile',
        args.profilePath,
        '--mode',
        args.mode,
        '--input',
        args.input,
        '--published-at',
        args.publishedAt,
        '--output',
        dataOutput,
      ],
    },
    posters,
  };
};

const runCommand = (command) =>
  new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(command[0], command.slice(1), {
      cwd: process.cwd(),
      env: process.env,
      stdio: 'inherit',
    });
    child.on('error', rejectPromise);
    child.on('close', (code, signal) => {
      if (code === 0) {
        resolvePromise();
        return;
      }
      rejectPromise(
        new Error(
          `${basename(command[0])} exited with ${signal ? `signal ${signal}` : `status ${code}`}`
        )
      );
    });
  });

const pathExists = async (path) => {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
};

const checksum = (content) =>
  createHash('sha256').update(content).digest('hex');

const verifyMode = async (profile, dataOutput, assetsOutput) => {
  const namespace = profile.poster.outputNamespace;
  const modeData = join(dataOutput, profile.mode);
  const modeAssets = join(assetsOutput, namespace);
  const manifest = JSON.parse(
    await readFile(join(modeData, 'manifest.json'), 'utf8')
  );

  if (
    manifest.mode !== profile.mode ||
    !Number.isInteger(manifest.activityCount) ||
    manifest.activityCount < 1 ||
    !Number.isFinite(Date.parse(manifest.publishedAt)) ||
    !String(manifest.publishedAt).endsWith('Z') ||
    !Array.isArray(manifest.years) ||
    manifest.years.length < 1
  ) {
    throw new Error(`Invalid ${profile.mode} publication manifest`);
  }

  const metadataText = await readFile(join(modeData, 'metadata.json'), 'utf8');
  const metadata = JSON.parse(metadataText);
  assertPublishedActivitiesMatchPolicy({
    activities: metadata,
    expectedCount: manifest.activityCount,
    policy: createActivityPublicationPolicy(profile),
  });
  if (
    metadata.length !== manifest.activityCount ||
    checksum(metadataText) !== manifest.metadataChecksum ||
    metadata.some(
      ({ run_id: runId }) => typeof runId !== 'string' || runId.length === 0
    )
  ) {
    throw new Error(`Invalid ${profile.mode} publication metadata`);
  }

  const metadataIds = new Set(metadata.map(({ run_id: runId }) => runId));
  const routeIds = new Set();
  let routeCount = 0;
  for (const year of manifest.years) {
    const routeText = await readFile(
      join(modeData, 'routes', `${year}.json`),
      'utf8'
    );
    if (checksum(routeText) !== manifest.routeChecksums?.[year]) {
      throw new Error(`Invalid ${profile.mode} ${year} route checksum`);
    }
    for (const route of JSON.parse(routeText)) {
      const runId = route.run_id;
      if (
        typeof runId !== 'string' ||
        runId.length === 0 ||
        routeIds.has(runId) ||
        !metadataIds.has(runId)
      ) {
        throw new Error(`Invalid ${profile.mode} ${year} route activity ID`);
      }
      routeIds.add(runId);
      if (route.summary_polyline) routeCount += 1;
    }
  }
  if (
    metadataIds.size !== metadata.length ||
    routeIds.size !== metadata.length ||
    routeCount !== manifest.routeCount ||
    routeCount / metadata.length !== manifest.routeRatio
  ) {
    throw new Error(`Invalid ${profile.mode} publication route coverage`);
  }

  const artifactChecksum = checksum(
    `${JSON.stringify({
      metadataChecksum: manifest.metadataChecksum,
      routeChecksums: manifest.routeChecksums,
    })}\n`
  );
  if (artifactChecksum !== manifest.artifactChecksum) {
    throw new Error(`Invalid ${profile.mode} artifact checksum`);
  }

  const assetNames = await readdir(modeAssets);
  const requiredExact = ['github.svg', 'grid.svg', 'mol.svg'];
  for (const name of requiredExact) {
    if (!assetNames.includes(name)) {
      throw new Error(`Missing ${profile.mode} poster: ${name}`);
    }
  }
  for (const pattern of [
    /^github_\d{4}\.svg$/,
    /^year_\d{4}\.svg$/,
    /^year_summary_\d{4}\.svg$/,
  ]) {
    if (!assetNames.some((name) => pattern.test(name))) {
      throw new Error(
        `Missing ${profile.mode} poster matching ${String(pattern)}`
      );
    }
  }

  return {
    mode: profile.mode,
    activityCount: manifest.activityCount,
    years: manifest.years,
    posters: assetNames.filter((name) => name.endsWith('.svg')).length,
  };
};

const replaceModeDirectories = async (replacements) => {
  const prepared = replacements.map(({ candidate, target }) => ({
    backup: `${target}.last-known-good-${process.pid}`,
    backedUp: false,
    candidate,
    installed: false,
    target,
  }));

  try {
    for (const item of prepared) {
      await rm(item.backup, { recursive: true, force: true });
      await mkdir(dirname(item.target), { recursive: true });
      if (await pathExists(item.target)) {
        await rename(item.target, item.backup);
        item.backedUp = true;
      }
    }
    for (const item of prepared) {
      await rename(item.candidate, item.target);
      item.installed = true;
    }
  } catch (error) {
    for (const item of [...prepared].reverse()) {
      if (item.installed) {
        await rm(item.target, { recursive: true, force: true });
      }
      if (item.backedUp && (await pathExists(item.backup))) {
        await rename(item.backup, item.target);
      }
    }
    throw error;
  }

  for (const item of prepared) {
    await rm(item.backup, { recursive: true, force: true });
  }
};

const exportProfile = async (args, profiles) => {
  const profile = requireProfile(profiles, args.mode);
  const lines = [
    `ACTIVITY_MODE=${profile.mode}`,
    `ACTIVITY_TYPES=${profile.activityTypes.join(' ')}`,
    `ACTIVITY_MIN_DISTANCE_METERS=${profile.publication.minDistanceMeters}`,
    `ACTIVITY_EXCLUDE_RUN_IDS=${profile.publication.excludeRunIds.join(' ')}`,
    `ACTIVITY_EXCLUDE_SUBTYPES=${profile.publication.excludeSubtypes.join(' ')}`,
    `ACTIVITY_POSTER_NAMESPACE=${profile.poster.outputNamespace}`,
  ];
  await appendFile(args.githubEnv, `${lines.join('\n')}\n`, 'utf8');
  process.stdout.write(`Exported ${profile.mode} publication profile\n`);
};

const generate = async (args, profiles) => {
  const profile = requireProfile(profiles, args.mode);
  const dataRoot = resolve(args.dataOutput);
  const assetsRoot = resolve(args.assetsOutput);
  await Promise.all([
    mkdir(dataRoot, { recursive: true }),
    mkdir(assetsRoot, { recursive: true }),
  ]);

  const dataStaging = await mkdtemp(join(dataRoot, `.candidate-${args.mode}-`));
  const assetsStaging = await mkdtemp(
    join(assetsRoot, `.candidate-${args.mode}-`)
  );
  const plan = await buildPlan(args, profiles, {
    dataOutput: dataStaging,
    assetsOutput: assetsStaging,
  });

  try {
    await mkdir(join(assetsStaging, plan.namespace), { recursive: true });
    await runCommand(plan.publication.command);
    for (const poster of plan.posters) {
      await runCommand(poster.command);
    }
    await verifyMode(profile, dataStaging, assetsStaging);
    await replaceModeDirectories([
      {
        candidate: join(dataStaging, args.mode),
        target: join(dataRoot, args.mode),
      },
      {
        candidate: join(assetsStaging, plan.namespace),
        target: join(assetsRoot, plan.namespace),
      },
    ]);
  } finally {
    await Promise.all([
      rm(dataStaging, { recursive: true, force: true }),
      rm(assetsStaging, { recursive: true, force: true }),
    ]);
  }

  process.stdout.write(
    `Generated validated ${args.mode} data and poster artifacts\n`
  );
};

const verify = async (args, profiles) => {
  const modes =
    args.mode === 'all'
      ? Object.keys(profiles).sort()
      : [requireProfile(profiles, args.mode).mode];
  const results = [];
  for (const mode of modes) {
    results.push(
      await verifyMode(
        requireProfile(profiles, mode),
        args.dataOutput,
        args.assetsOutput
      )
    );
  }
  process.stdout.write(`${JSON.stringify({ verified: results })}\n`);
};

try {
  const args = parseArgs(process.argv.slice(2));
  const profiles = await readProfiles(args.profilePath);
  if (args.command === 'export-profile') {
    await exportProfile(args, profiles);
  } else if (args.command === 'plan') {
    process.stdout.write(
      `${JSON.stringify(await buildPlan(args, profiles), null, 2)}\n`
    );
  } else if (args.command === 'generate') {
    await generate(args, profiles);
  } else {
    await verify(args, profiles);
  }
} catch (error) {
  process.stderr.write(
    `${error instanceof Error ? error.message : String(error)}\n`
  );
  process.exitCode = 1;
}
