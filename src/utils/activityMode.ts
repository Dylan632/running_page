import {
  isActivityForMode,
  type ActivityMode,
} from '@/modules/activity/profiles';

export type { ActivityMode };

interface ActivityFilterCandidate {
  distance?: number | null;
  type: string;
}

export const isCyclingActivity = (activity: ActivityFilterCandidate): boolean =>
  isActivityForMode(activity, 'cycling');

export const isSelectedActivity = (
  activity: ActivityFilterCandidate,
  mode: ActivityMode,
  minDistanceMeters = 0
): boolean => {
  if (!isActivityForMode(activity, mode)) {
    return false;
  }

  if (minDistanceMeters > 0 && (activity.distance ?? 0) <= minDistanceMeters) {
    return false;
  }

  return true;
};
