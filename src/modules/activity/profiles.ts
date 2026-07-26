import profileSource from './activity-profiles.json';

export type ActivityMode = 'running' | 'cycling';

export interface ActivityProfile {
  mode: ActivityMode;
  route: `/${ActivityMode}`;
  label: string;
  siteTitle: string;
  description: string;
  copy: {
    chineseVerb: string;
    countDescription: string;
    heatmapTitle: string;
    journeyTitle: string;
    name: string;
  };
  activityTypes: ReadonlySet<string>;
  publication: {
    minDistanceMeters: number;
    excludeRunIds: ReadonlySet<string>;
    minimumRouteRatio: number;
  };
  poster: {
    title: string;
    gridTitle: string;
    activityLabel: string;
    sportType: ActivityMode;
    minimumDistanceKm: number;
    gridMinimumDistanceKm: number;
    specialDistance: number;
    specialDistance2: number;
    colors: {
      background: string;
      track: string;
      text: string;
      special: string;
      special2: string;
    };
    outputNamespace: ActivityMode;
  };
}

type RawProfile = (typeof profileSource.profiles)[ActivityMode];

const createProfile = (raw: RawProfile): ActivityProfile => ({
  ...raw,
  mode: raw.mode as ActivityMode,
  route: raw.route as `/${ActivityMode}`,
  activityTypes: new Set(raw.activityTypes),
  publication: {
    ...raw.publication,
    excludeRunIds: new Set(raw.publication.excludeRunIds),
  },
  poster: {
    ...raw.poster,
    sportType: raw.poster.sportType as ActivityMode,
    specialDistance: raw.poster.specialDistancesKm[0],
    specialDistance2: raw.poster.specialDistancesKm[1],
    outputNamespace: raw.poster.outputNamespace as ActivityMode,
  },
});

const profiles: Record<ActivityMode, ActivityProfile> = {
  running: createProfile(profileSource.profiles.running),
  cycling: createProfile(profileSource.profiles.cycling),
};

export const ACTIVITY_MODES = Object.freeze([
  profiles.running,
  profiles.cycling,
]);

export const isActivityMode = (value: unknown): value is ActivityMode =>
  value === 'running' || value === 'cycling';

export const getActivityProfile = (mode: ActivityMode): ActivityProfile =>
  profiles[mode];

export const isActivityForMode = (
  activity: { type: string },
  mode: ActivityMode
): boolean => profiles[mode].activityTypes.has(activity.type);
