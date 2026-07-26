import type { Activity } from '@/utils/utils';
import type { ActivityMode } from './profiles';

export interface ActivityInsights {
  mode: ActivityMode;
  count: number;
  totalDistanceMeters: number;
  totalMovingSeconds: number;
  totalElevationGainMeters: number;
  averageMetersPerSecond: number;
  maxMetersPerSecond: number;
  maxDistanceMeters: number;
  averageHeartRate: number | null;
  maxStreakDays: number;
}

interface ActivityInsightsAccumulator {
  count: number;
  totalDistanceMeters: number;
  totalMovingSeconds: number;
  totalElevationGainMeters: number;
  maxMetersPerSecond: number;
  maxDistanceMeters: number;
  heartRateTotal: number;
  heartRateCount: number;
  maxStreakDays: number;
}

const createAccumulator = (): ActivityInsightsAccumulator => ({
  count: 0,
  totalDistanceMeters: 0,
  totalMovingSeconds: 0,
  totalElevationGainMeters: 0,
  maxMetersPerSecond: 0,
  maxDistanceMeters: 0,
  heartRateTotal: 0,
  heartRateCount: 0,
  maxStreakDays: 0,
});

export const movingTimeToSeconds = (movingTime: string): number => {
  if (!movingTime) return 0;
  const parts = movingTime.split(', ');
  const dayMatch = parts.length > 1 ? parts[0].match(/^\d+/) : null;
  const days = dayMatch ? Number(dayMatch[0]) : 0;
  const time = parts.at(-1) ?? '';
  const timeParts = time.split(':').map(Number);
  if (
    timeParts.length !== 3 ||
    timeParts.some((part) => !Number.isFinite(part) || part < 0)
  ) {
    return 0;
  }
  const [hours, minutes, seconds] = timeParts;
  return ((days * 24 + hours) * 60 + minutes) * 60 + seconds;
};

const addActivity = (
  accumulator: ActivityInsightsAccumulator,
  activity: Activity
) => {
  const distance = Math.max(0, Number(activity.distance) || 0);
  const movingSeconds = movingTimeToSeconds(activity.moving_time);
  const metersPerSecond = movingSeconds > 0 ? distance / movingSeconds : 0;

  accumulator.count += 1;
  accumulator.totalDistanceMeters += distance;
  accumulator.totalMovingSeconds += movingSeconds;
  accumulator.totalElevationGainMeters += Math.max(
    0,
    Number(activity.elevation_gain) || 0
  );
  accumulator.maxDistanceMeters = Math.max(
    accumulator.maxDistanceMeters,
    distance
  );
  accumulator.maxMetersPerSecond = Math.max(
    accumulator.maxMetersPerSecond,
    metersPerSecond
  );
  accumulator.maxStreakDays = Math.max(
    accumulator.maxStreakDays,
    Number(activity.streak) || 0
  );

  const heartRate = Number(activity.average_heartrate);
  if (Number.isFinite(heartRate) && heartRate > 0) {
    accumulator.heartRateTotal += heartRate;
    accumulator.heartRateCount += 1;
  }
};

const finalize = (
  accumulator: ActivityInsightsAccumulator,
  mode: ActivityMode
): ActivityInsights => ({
  mode,
  count: accumulator.count,
  totalDistanceMeters: accumulator.totalDistanceMeters,
  totalMovingSeconds: accumulator.totalMovingSeconds,
  totalElevationGainMeters: accumulator.totalElevationGainMeters,
  averageMetersPerSecond:
    accumulator.totalMovingSeconds > 0
      ? accumulator.totalDistanceMeters / accumulator.totalMovingSeconds
      : 0,
  maxMetersPerSecond: accumulator.maxMetersPerSecond,
  maxDistanceMeters: accumulator.maxDistanceMeters,
  averageHeartRate:
    accumulator.heartRateCount > 0
      ? accumulator.heartRateTotal / accumulator.heartRateCount
      : null,
  maxStreakDays: accumulator.maxStreakDays,
});

export const summarizeActivities = (
  activities: Activity[],
  mode: ActivityMode
): ActivityInsights => {
  const accumulator = createAccumulator();
  activities.forEach((activity) => addActivity(accumulator, activity));
  return finalize(accumulator, mode);
};

export const summarizeActivitiesByYear = (
  activities: Activity[],
  mode: ActivityMode
): Map<string, ActivityInsights> => {
  const accumulators = new Map<string, ActivityInsightsAccumulator>([
    ['Total', createAccumulator()],
  ]);

  for (const activity of activities) {
    const year = activity.start_date_local.slice(0, 4);
    if (!accumulators.has(year)) {
      accumulators.set(year, createAccumulator());
    }
    addActivity(accumulators.get('Total')!, activity);
    addActivity(accumulators.get(year)!, activity);
  }

  return new Map(
    [...accumulators].map(([year, accumulator]) => [
      year,
      finalize(accumulator, mode),
    ])
  );
};
