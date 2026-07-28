import type { Activity } from '@/utils/utils';
import type { ActivityMode } from './profiles';

export interface ActivityRouteRecord {
  run_id: Activity['run_id'];
  summary_polyline: string | null;
}

export interface ActivityDataManifest {
  schemaVersion: 1;
  mode: ActivityMode;
  activityCount: number;
  publishedAt: string;
  latestActivityDate: string;
  latestYear: string;
  years: string[];
  routeCount: number;
  routeRatio: number;
  checksum: string;
  artifactChecksum: string;
  metadataChecksum: string;
  routeChecksums: Record<string, string>;
  source: string;
}

type WireActivity = Omit<Activity, 'run_id'> & {
  run_id: string;
};

type WireActivityRouteRecord = Omit<ActivityRouteRecord, 'run_id'> & {
  run_id: string;
};

interface ActivityDataRepositoryOptions {
  baseUrl: string;
  fetcher?: typeof fetch;
  requestTimeoutMs?: number;
}

const normalizeBaseUrl = (value: string) => value.replace(/\/+$/, '');
const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const YEAR_PATTERN = /^\d{4}$/;
const DEFAULT_REQUEST_TIMEOUT_MS = 1_800;

const configuredRequestTimeoutMs = Number(
  import.meta.env.VITE_ACTIVITY_DATA_REQUEST_TIMEOUT_MS
);
const requestTimeoutMs =
  Number.isFinite(configuredRequestTimeoutMs) && configuredRequestTimeoutMs > 0
    ? configuredRequestTimeoutMs
    : DEFAULT_REQUEST_TIMEOUT_MS;

const dataIntegrityError = (message: string) =>
  new Error(`Activity data integrity check failed: ${message}`);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const validateManifest = (
  value: unknown,
  expectedMode: ActivityMode
): ActivityDataManifest => {
  if (!isRecord(value)) {
    throw dataIntegrityError(`${expectedMode} manifest is not an object`);
  }

  const years = value.years;
  const routeChecksums = value.routeChecksums;
  if (
    value.schemaVersion !== 1 ||
    value.mode !== expectedMode ||
    typeof value.activityCount !== 'number' ||
    !Number.isInteger(value.activityCount) ||
    value.activityCount <= 0 ||
    typeof value.publishedAt !== 'string' ||
    !Number.isFinite(Date.parse(value.publishedAt)) ||
    typeof value.latestActivityDate !== 'string' ||
    typeof value.latestYear !== 'string' ||
    !Array.isArray(years) ||
    years.length === 0 ||
    years.some(
      (year) => typeof year !== 'string' || !YEAR_PATTERN.test(year)
    ) ||
    new Set(years).size !== years.length ||
    !years.includes(value.latestYear) ||
    typeof value.routeCount !== 'number' ||
    !Number.isInteger(value.routeCount) ||
    value.routeCount < 0 ||
    value.routeCount > value.activityCount ||
    typeof value.routeRatio !== 'number' ||
    value.routeRatio < 0 ||
    value.routeRatio > 1 ||
    typeof value.checksum !== 'string' ||
    !SHA256_PATTERN.test(value.checksum) ||
    typeof value.artifactChecksum !== 'string' ||
    !SHA256_PATTERN.test(value.artifactChecksum) ||
    typeof value.metadataChecksum !== 'string' ||
    !SHA256_PATTERN.test(value.metadataChecksum) ||
    !isRecord(routeChecksums) ||
    years.some(
      (year) =>
        typeof routeChecksums[year] !== 'string' ||
        !SHA256_PATTERN.test(routeChecksums[year])
    ) ||
    typeof value.source !== 'string' ||
    value.source.length === 0
  ) {
    throw dataIntegrityError(`${expectedMode} manifest has an invalid schema`);
  }

  return value as unknown as ActivityDataManifest;
};

const validateMetadata = (
  value: unknown,
  manifest: ActivityDataManifest
): Activity[] => {
  if (!Array.isArray(value)) {
    throw dataIntegrityError(`${manifest.mode} metadata is not an array`);
  }

  const seenIds = new Set<string>();
  const activities = value.map((candidate, index) => {
    if (
      !isRecord(candidate) ||
      typeof candidate.run_id !== 'string' ||
      candidate.run_id.length === 0 ||
      typeof candidate.start_date_local !== 'string'
    ) {
      throw dataIntegrityError(
        `${manifest.mode} metadata entry ${index} is invalid`
      );
    }
    if (seenIds.has(candidate.run_id)) {
      throw dataIntegrityError(
        `${manifest.mode} metadata contains duplicate run_id ${candidate.run_id}`
      );
    }
    seenIds.add(candidate.run_id);
    return candidate as unknown as WireActivity;
  });

  const metadataYears = [
    ...new Set(
      activities.map((activity) => activity.start_date_local.slice(0, 4))
    ),
  ].sort((left, right) => right.localeCompare(left));
  if (
    activities.length !== manifest.activityCount ||
    metadataYears.length !== manifest.years.length ||
    metadataYears.some((year, index) => year !== manifest.years[index])
  ) {
    throw dataIntegrityError(
      `${manifest.mode} metadata does not match its manifest`
    );
  }

  return activities;
};

const validateRouteGroup = (
  value: unknown,
  manifest: ActivityDataManifest,
  year: string
): ActivityRouteRecord[] => {
  if (!Array.isArray(value)) {
    throw dataIntegrityError(
      `${manifest.mode} ${year} routes are not an array`
    );
  }

  const seenIds = new Set<string>();
  return value.map((candidate, index) => {
    if (
      !isRecord(candidate) ||
      typeof candidate.run_id !== 'string' ||
      candidate.run_id.length === 0 ||
      (candidate.summary_polyline !== null &&
        typeof candidate.summary_polyline !== 'string')
    ) {
      throw dataIntegrityError(
        `${manifest.mode} ${year} route entry ${index} is invalid`
      );
    }
    if (seenIds.has(candidate.run_id)) {
      throw dataIntegrityError(
        `${manifest.mode} ${year} routes contain duplicate run_id ${candidate.run_id}`
      );
    }
    seenIds.add(candidate.run_id);
    return candidate as unknown as WireActivityRouteRecord;
  });
};

const sha256 = async (content: string) => {
  if (!globalThis.crypto?.subtle) {
    throw dataIntegrityError('Web Crypto is unavailable');
  }
  const digest = await globalThis.crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(content)
  );
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
};

export const createActivityDataRepository = ({
  baseUrl,
  fetcher = fetch,
  requestTimeoutMs = 1_800,
}: ActivityDataRepositoryOptions) => {
  const normalizedBaseUrl = normalizeBaseUrl(baseUrl);
  const requestCache = new Map<string, Promise<unknown>>();

  const loadText = (path: string): Promise<string> => {
    const cached = requestCache.get(path);
    if (cached) return cached as Promise<string>;

    const request = (async () => {
      const controller = new AbortController();
      const timeoutId = globalThis.setTimeout(() => {
        controller.abort(new Error(`Activity data request timed out: ${path}`));
      }, requestTimeoutMs);
      try {
        const response = await fetcher(path, { signal: controller.signal });
        if (!response.ok) {
          throw new Error(`Failed to load activity data: ${response.status}`);
        }
        return response.text();
      } finally {
        globalThis.clearTimeout(timeoutId);
      }
    })().catch((error: unknown) => {
      requestCache.delete(path);
      throw error;
    });
    requestCache.set(path, request);
    return request;
  };

  const parseJson = (text: string, path: string): unknown => {
    try {
      return JSON.parse(text);
    } catch {
      throw dataIntegrityError(`${path} is not valid JSON`);
    }
  };

  const loadJson = async (path: string) =>
    parseJson(await loadText(path), path);

  const loadVerifiedJson = async (path: string, checksum: string) => {
    const versionedPath = `${path}?v=${checksum}`;
    const text = await loadText(versionedPath);
    const actualChecksum = await sha256(text);
    if (actualChecksum !== checksum) {
      throw dataIntegrityError(`${path} checksum does not match its manifest`);
    }
    return parseJson(text, path);
  };

  const loadManifest = async (mode: ActivityMode) =>
    validateManifest(
      await loadJson(`${normalizedBaseUrl}/${mode}/manifest.json`),
      mode
    );

  const loadMetadata = async (mode: ActivityMode) => {
    const manifest = await loadManifest(mode);
    return validateMetadata(
      await loadVerifiedJson(
        `${normalizedBaseUrl}/${mode}/metadata.json`,
        manifest.metadataChecksum
      ),
      manifest
    );
  };

  const loadRoutes = async (mode: ActivityMode, years: string[]) => {
    const manifest = await loadManifest(mode);
    const uniqueYears = [...new Set(years)];
    const invalidYear = uniqueYears.find(
      (year) => !manifest.years.includes(year)
    );
    if (invalidYear) {
      throw dataIntegrityError(
        `${mode} routes for ${invalidYear} are absent from the manifest`
      );
    }

    const routeGroups = await Promise.all(
      uniqueYears.map(async (year) =>
        validateRouteGroup(
          await loadVerifiedJson(
            `${normalizedBaseUrl}/${mode}/routes/${year}.json`,
            manifest.routeChecksums[year]
          ),
          manifest,
          year
        )
      )
    );
    const routes = new Map<Activity['run_id'], ActivityRouteRecord>();
    for (const route of routeGroups.flat()) {
      if (routes.has(route.run_id)) {
        throw dataIntegrityError(
          `${mode} routes contain duplicate run_id ${route.run_id}`
        );
      }
      routes.set(route.run_id, route);
    }
    return routes;
  };

  const loadActivities = async (mode: ActivityMode, years: string[]) => {
    const [metadata, routes] = await Promise.all([
      loadMetadata(mode),
      loadRoutes(mode, years),
    ]);
    const metadataById = new Map(
      metadata.map((activity) => [activity.run_id, activity])
    );
    const requestedYears = new Set(years);
    for (const [runId] of routes) {
      const activity = metadataById.get(runId);
      if (
        !activity ||
        !requestedYears.has(activity.start_date_local.slice(0, 4))
      ) {
        throw dataIntegrityError(
          `${mode} route ${runId} does not match the requested metadata`
        );
      }
    }
    for (const activity of metadata) {
      if (
        requestedYears.has(activity.start_date_local.slice(0, 4)) &&
        !routes.has(activity.run_id)
      ) {
        throw dataIntegrityError(
          `${mode} route ${activity.run_id} is missing from its yearly artifact`
        );
      }
    }

    return metadata.map((activity) => {
      const route = routes.get(activity.run_id);
      return route
        ? { ...activity, summary_polyline: route.summary_polyline }
        : activity;
    });
  };

  return {
    clear: () => requestCache.clear(),
    loadActivities,
    loadManifest,
    loadMetadata,
    loadRoutes,
  };
};

const dataBaseUrl = `${import.meta.env.BASE_URL}data`.replace(/\/+/g, '/');

export const activityDataRepository = createActivityDataRepository({
  baseUrl: dataBaseUrl,
  requestTimeoutMs,
});
