type ActivityMode = 'running' | 'cycling';

interface ActivityFilterCandidate {
  distance?: number | null;
  type: string;
}

const requestedMode = import.meta.env.VITE_ACTIVITY_MODE;

export const ACTIVITY_MODE: ActivityMode =
  requestedMode === 'cycling' ? 'cycling' : 'running';

const parsedMinDistance = Number(
  import.meta.env.VITE_ACTIVITY_MIN_DISTANCE_METERS ?? 0
);

export const ACTIVITY_MIN_DISTANCE_METERS = Number.isFinite(parsedMinDistance)
  ? parsedMinDistance
  : 0;

const ACTIVITY_TYPE_MAP: Record<ActivityMode, Set<string>> = {
  running: new Set(['Run', 'VirtualRun', 'running']),
  cycling: new Set(['Ride', 'VirtualRide', 'cycling']),
};

export const ACTIVITY_COPY = {
  running: {
    chineseVerb: '跑步',
    countDescription: ' Runs',
    heatmapTitle: 'Running Heatmap',
    journeyTitle: 'Running Journey',
    name: 'Run',
  },
  cycling: {
    chineseVerb: '骑行',
    countDescription: ' Rides',
    heatmapTitle: 'Cycling Heatmap',
    journeyTitle: 'Cycling Journey',
    name: 'Ride',
  },
} as const;

export const selectedActivityCopy = ACTIVITY_COPY[ACTIVITY_MODE];

export const isCyclingActivity = (activity: ActivityFilterCandidate): boolean =>
  ACTIVITY_TYPE_MAP.cycling.has(activity.type);

export const isSelectedActivity = (
  activity: ActivityFilterCandidate
): boolean => {
  if (!ACTIVITY_TYPE_MAP[ACTIVITY_MODE].has(activity.type)) {
    return false;
  }

  if (
    ACTIVITY_MIN_DISTANCE_METERS > 0 &&
    (activity.distance ?? 0) <= ACTIVITY_MIN_DISTANCE_METERS
  ) {
    return false;
  }

  return true;
};
