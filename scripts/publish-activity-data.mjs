import { createHash, randomBytes } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { normalizeActivityId, readActivityJson } from './lib/activity-json.mjs';

const DEFAULT_PROFILE_PATH = new URL(
  '../src/modules/activity/activity-profiles.json',
  import.meta.url
);

const parseArgs = (argv) => {
  const args = {
    excludeRunIds: new Set(),
    input: '',
    minDistance: undefined,
    mode: '',
    output: 'public/data',
    profile: DEFAULT_PROFILE_PATH,
    publishedAt: '',
  };

  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (flag === '--exclude-run-ids') {
      index += 1;
      while (argv[index] && !argv[index].startsWith('--')) {
        args.excludeRunIds.add(String(argv[index]));
        index += 1;
      }
      index -= 1;
    } else if (flag === '--input') {
      args.input = value;
      index += 1;
    } else if (flag === '--min-distance') {
      args.minDistance = Number(value);
      index += 1;
    } else if (flag === '--mode') {
      args.mode = value;
      index += 1;
    } else if (flag === '--output') {
      args.output = value;
      index += 1;
    } else if (flag === '--profile') {
      args.profile = value;
      index += 1;
    } else if (flag === '--published-at') {
      args.publishedAt = value;
      index += 1;
    } else {
      throw new Error(`Unknown argument: ${flag}`);
    }
  }

  if (!args.mode) throw new Error('--mode is required');
  if (!args.input) throw new Error('--input is required');
  args.publishedAt = normalizePublishedAt(args.publishedAt);
  if (
    args.minDistance !== undefined &&
    (!Number.isFinite(args.minDistance) || args.minDistance < 0)
  ) {
    throw new Error('--min-distance must be a non-negative number');
  }
  return args;
};

const stableJson = (value) => `${JSON.stringify(value)}\n`;
const checksum = (content) =>
  createHash('sha256').update(content).digest('hex');

const normalizePublishedAt = (value) => {
  const match =
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?Z$/.exec(
      value ?? ''
    );
  if (!match) {
    throw new Error('--published-at must be an ISO 8601 UTC timestamp');
  }

  const [, year, month, day, hour, minute, second, milliseconds = '0'] = match;
  const parts = [year, month, day, hour, minute, second].map(Number);
  const candidate = new Date(
    Date.UTC(
      parts[0],
      parts[1] - 1,
      parts[2],
      parts[3],
      parts[4],
      parts[5],
      Number(milliseconds.padEnd(3, '0'))
    )
  );
  if (
    candidate.getUTCFullYear() !== parts[0] ||
    candidate.getUTCMonth() !== parts[1] - 1 ||
    candidate.getUTCDate() !== parts[2] ||
    candidate.getUTCHours() !== parts[3] ||
    candidate.getUTCMinutes() !== parts[4] ||
    candidate.getUTCSeconds() !== parts[5]
  ) {
    throw new Error('--published-at must be a valid ISO 8601 UTC timestamp');
  }
  return candidate.toISOString();
};

const isValidLocalDate = (value) => {
  const match =
    /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?)?$/.exec(
      value
    );
  if (!match) return false;

  const [, year, month, day, hour = '00', minute = '00', second = '00'] = match;
  const parts = [year, month, day, hour, minute, second].map(Number);
  const candidate = new Date(
    Date.UTC(...parts.map((part, index) => (index === 1 ? part - 1 : part)))
  );

  return (
    candidate.getUTCFullYear() === parts[0] &&
    candidate.getUTCMonth() === parts[1] - 1 &&
    candidate.getUTCDate() === parts[2] &&
    candidate.getUTCHours() === parts[3] &&
    candidate.getUTCMinutes() === parts[4] &&
    candidate.getUTCSeconds() === parts[5]
  );
};

const loadProfile = async (args) => {
  const source = JSON.parse(await readFile(args.profile, 'utf8'));
  const profile = source?.profiles?.[args.mode];
  if (!profile) {
    throw new Error(`Unknown activity profile: ${args.mode}`);
  }
  if (
    !Array.isArray(profile.activityTypes) ||
    profile.activityTypes.length === 0
  ) {
    throw new Error(`Profile ${args.mode} has no activityTypes`);
  }

  const profileMinimum = Number(profile.publication?.minDistanceMeters);
  const minimumRouteRatio = Number(profile.publication?.minimumRouteRatio);
  if (!Number.isFinite(profileMinimum) || profileMinimum < 0) {
    throw new Error(`Profile ${args.mode} has an invalid minDistanceMeters`);
  }
  if (
    !Number.isFinite(minimumRouteRatio) ||
    minimumRouteRatio < 0 ||
    minimumRouteRatio > 1
  ) {
    throw new Error(`Profile ${args.mode} has an invalid minimumRouteRatio`);
  }

  return {
    activityTypes: new Set(profile.activityTypes),
    excludeRunIds: new Set([
      ...(profile.publication?.excludeRunIds ?? []).map(String),
      ...args.excludeRunIds,
    ]),
    minDistance: args.minDistance ?? profileMinimum,
    minimumRouteRatio,
    schemaVersion: Number(source.schemaVersion) || 1,
  };
};

const validateAndNormalize = (raw, args, profile) => {
  if (!Array.isArray(raw)) {
    throw new Error('Activity snapshot must be a JSON array');
  }

  const seenIds = new Set();
  const filtered = [];

  for (const activity of raw) {
    if (!activity || typeof activity !== 'object') {
      throw new Error('Every activity must be an object');
    }
    const runId = normalizeActivityId(activity.run_id);
    if (seenIds.has(runId)) {
      throw new Error(`Duplicate run_id: ${runId}`);
    }
    seenIds.add(runId);

    if (!profile.activityTypes.has(activity.type)) continue;
    if (profile.excludeRunIds.has(runId)) continue;

    const distance = Number(activity.distance ?? 0);
    if (!Number.isFinite(distance) || distance <= profile.minDistance) continue;

    const localDate = String(activity.start_date_local ?? '');
    if (!isValidLocalDate(localDate)) {
      throw new Error(`Activity ${runId} has an invalid start_date_local`);
    }

    filtered.push({ ...activity, run_id: runId, distance });
  }

  if (filtered.length === 0) {
    throw new Error(`No ${args.mode} activities remain after filtering`);
  }

  return filtered.sort((left, right) => {
    const dateCompare = String(left.start_date_local).localeCompare(
      String(right.start_date_local)
    );
    return dateCompare || left.run_id.localeCompare(right.run_id);
  });
};

const createArtifact = (activities, args, profile) => {
  const round = (value, precision) => {
    if (value === null || value === undefined || value === '') return value;
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return value;
    const factor = 10 ** precision;
    return Math.round(numeric * factor) / factor;
  };
  const metadata = activities.map(
    ({ start_date: _utcDate, summary_polyline: _route, ...activity }) => ({
      ...activity,
      distance: round(activity.distance, 2),
      elevation_gain: round(activity.elevation_gain, 2),
      average_speed: round(activity.average_speed, 4),
      average_heartrate: round(activity.average_heartrate, 1),
    })
  );
  const routesByYear = new Map();

  for (const activity of activities) {
    const year = String(activity.start_date_local).slice(0, 4);
    const routes = routesByYear.get(year) ?? [];
    routes.push({
      run_id: activity.run_id,
      summary_polyline: activity.summary_polyline ?? null,
    });
    routesByYear.set(year, routes);
  }

  const years = [...routesByYear.keys()].sort().reverse();
  const metadataText = stableJson(metadata);
  const routeTexts = Object.fromEntries(
    years.map((year) => [year, stableJson(routesByYear.get(year))])
  );
  const routeCount = activities.filter(
    (activity) =>
      typeof activity.summary_polyline === 'string' &&
      activity.summary_polyline.length > 0
  ).length;
  const routeRatio = routeCount / activities.length;
  if (routeRatio < profile.minimumRouteRatio) {
    throw new Error(
      `${args.mode} route ratio ${routeRatio.toFixed(3)} is below ${profile.minimumRouteRatio}`
    );
  }

  const metadataChecksum = checksum(metadataText);
  const routeChecksums = Object.fromEntries(
    years.map((year) => [year, checksum(routeTexts[year])])
  );
  const activityChecksum = checksum(stableJson(activities));
  const artifactChecksum = checksum(
    stableJson({ metadataChecksum, routeChecksums })
  );

  return {
    manifest: {
      schemaVersion: profile.schemaVersion,
      mode: args.mode,
      activityCount: activities.length,
      publishedAt: args.publishedAt,
      latestActivityDate: activities.at(-1).start_date_local,
      latestYear: years[0],
      years,
      routeCount,
      routeRatio,
      checksum: activityChecksum,
      artifactChecksum,
      metadataChecksum,
      routeChecksums,
      source: basename(args.input),
    },
    metadata,
    metadataText,
    routeTexts,
    years,
  };
};

const writeCandidate = async (directory, artifact) => {
  const routeDirectory = join(directory, 'routes');
  await mkdir(routeDirectory, { recursive: true });
  await Promise.all([
    writeFile(
      join(directory, 'manifest.json'),
      stableJson(artifact.manifest),
      'utf8'
    ),
    writeFile(join(directory, 'metadata.json'), artifact.metadataText, 'utf8'),
    ...artifact.years.map((year) =>
      writeFile(
        join(routeDirectory, `${year}.json`),
        artifact.routeTexts[year],
        'utf8'
      )
    ),
  ]);
};

const validateCandidate = async (directory, artifact, profile) => {
  const manifest = JSON.parse(
    await readFile(join(directory, 'manifest.json'), 'utf8')
  );
  const metadataText = await readFile(join(directory, 'metadata.json'), 'utf8');
  const metadata = JSON.parse(metadataText);
  if (
    metadata.some(
      ({ run_id: runId }) => typeof runId !== 'string' || runId.length === 0
    )
  ) {
    throw new Error('Candidate metadata IDs must be lossless strings');
  }
  const metadataIds = new Set(metadata.map(({ run_id: runId }) => runId));
  if (
    metadata.length !== artifact.metadata.length ||
    metadataIds.size !== metadata.length
  ) {
    throw new Error('Candidate metadata count or unique ID validation failed');
  }
  if (checksum(metadataText) !== manifest.metadataChecksum) {
    throw new Error('Candidate metadata checksum validation failed');
  }

  let routeCount = 0;
  const routeIds = new Set();
  for (const year of manifest.years) {
    const routeText = await readFile(
      join(directory, 'routes', `${year}.json`),
      'utf8'
    );
    if (checksum(routeText) !== manifest.routeChecksums[year]) {
      throw new Error(`Candidate ${year} route checksum validation failed`);
    }
    for (const route of JSON.parse(routeText)) {
      const runId = route.run_id;
      if (typeof runId !== 'string' || runId.length === 0) {
        throw new Error('Candidate route IDs must be lossless strings');
      }
      if (routeIds.has(runId) || !metadataIds.has(runId)) {
        throw new Error('Candidate route ID validation failed');
      }
      routeIds.add(runId);
      if (route.summary_polyline) routeCount += 1;
    }
  }

  if (routeIds.size !== metadata.length) {
    throw new Error('Candidate route coverage validation failed');
  }
  const routeRatio = routeCount / metadata.length;
  if (
    routeRatio < profile.minimumRouteRatio ||
    routeRatio !== manifest.routeRatio
  ) {
    throw new Error('Candidate route ratio validation failed');
  }
  const artifactChecksum = checksum(
    stableJson({
      metadataChecksum: manifest.metadataChecksum,
      routeChecksums: manifest.routeChecksums,
    })
  );
  if (artifactChecksum !== manifest.artifactChecksum) {
    throw new Error('Candidate artifact checksum validation failed');
  }
};

const replaceDirectory = async (candidateDirectory, modeDirectory) => {
  const suffix = `${process.pid}-${randomBytes(4).toString('hex')}`;
  const backupDirectory = `${modeDirectory}.backup-${suffix}`;
  let hadPrevious = false;

  try {
    await rename(modeDirectory, backupDirectory);
    hadPrevious = true;
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }

  try {
    await rename(candidateDirectory, modeDirectory);
  } catch (error) {
    if (hadPrevious) await rename(backupDirectory, modeDirectory);
    throw error;
  }

  if (hadPrevious) {
    await rm(backupDirectory, { recursive: true, force: true });
  }
};

const publish = async (args) => {
  const profile = await loadProfile(args);
  const raw = await readActivityJson(args.input);
  const activities = validateAndNormalize(raw, args, profile);
  const artifact = createArtifact(activities, args, profile);
  const suffix = `${process.pid}-${randomBytes(4).toString('hex')}`;
  const candidateDirectory = join(
    args.output,
    `.${args.mode}.candidate-${suffix}`
  );
  const modeDirectory = join(args.output, args.mode);

  await mkdir(args.output, { recursive: true });
  try {
    await writeCandidate(candidateDirectory, artifact);
    await validateCandidate(candidateDirectory, artifact, profile);
    await replaceDirectory(candidateDirectory, modeDirectory);
  } finally {
    await rm(candidateDirectory, { recursive: true, force: true });
  }

  process.stdout.write(
    `Published ${activities.length} ${args.mode} activities (${artifact.years.join(', ')}) to ${modeDirectory}\n`
  );
};

try {
  await publish(parseArgs(process.argv.slice(2)));
} catch (error) {
  process.stderr.write(
    `${error instanceof Error ? error.message : String(error)}\n`
  );
  process.exitCode = 1;
}
