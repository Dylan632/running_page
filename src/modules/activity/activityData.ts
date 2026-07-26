import type { Activity } from '@/utils/utils';
import type { ActivityMode } from './profiles';

export interface ActivityRouteRecord {
  run_id: Activity['run_id'];
  summary_polyline: string | null;
}

interface ActivityDataRepositoryOptions {
  baseUrl: string;
  fetcher?: typeof fetch;
  requestTimeoutMs?: number;
}

const normalizeBaseUrl = (value: string) => value.replace(/\/+$/, '');

export const createActivityDataRepository = ({
  baseUrl,
  fetcher = fetch,
  requestTimeoutMs = 1_800,
}: ActivityDataRepositoryOptions) => {
  const normalizedBaseUrl = normalizeBaseUrl(baseUrl);
  const requestCache = new Map<string, Promise<unknown>>();

  const loadJson = <Result>(path: string): Promise<Result> => {
    const cached = requestCache.get(path);
    if (cached) return cached as Promise<Result>;

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
        return (await response.json()) as Result;
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

  const loadMetadata = (mode: ActivityMode) =>
    loadJson<Activity[]>(`${normalizedBaseUrl}/${mode}/metadata.json`);

  const loadRoutes = async (mode: ActivityMode, years: string[]) => {
    const routeGroups = await Promise.all(
      [...new Set(years)].map((year) =>
        loadJson<ActivityRouteRecord[]>(
          `${normalizedBaseUrl}/${mode}/routes/${year}.json`
        )
      )
    );
    return new Map(
      routeGroups.flat().map((route) => [String(route.run_id), route])
    );
  };

  const loadActivities = async (mode: ActivityMode, years: string[]) => {
    const [metadata, routes] = await Promise.all([
      loadMetadata(mode),
      loadRoutes(mode, years),
    ]);
    return metadata.map((activity) => {
      const route = routes.get(String(activity.run_id));
      return route
        ? { ...activity, summary_polyline: route.summary_polyline }
        : activity;
    });
  };

  return {
    clear: () => requestCache.clear(),
    loadActivities,
    loadMetadata,
    loadRoutes,
  };
};

const dataBaseUrl = `${import.meta.env.BASE_URL}data`.replace(/\/+/g, '/');

export const activityDataRepository = createActivityDataRepository({
  baseUrl: dataBaseUrl,
});
