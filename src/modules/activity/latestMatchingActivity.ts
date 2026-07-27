import type { Activity } from '@/utils/utils';
import { sortDateFunc } from '@/utils/utils';

type ActivityMatcher = (activity: Activity, item: string) => boolean;
type YearActivityLoader = (year: string) => Promise<Activity[]>;

interface MatchingActivitiesOptions {
  activities: Activity[];
  item: string;
  matches: ActivityMatcher;
}

interface LatestRoutedActivityOptions {
  activitiesByRecency: Activity[];
  loadYear: YearActivityLoader;
}

export const getMatchingActivitiesByRecency = ({
  activities,
  item,
  matches,
}: MatchingActivitiesOptions): Activity[] =>
  activities.filter((activity) => matches(activity, item)).sort(sortDateFunc);

export const findLatestRoutedActivity = async ({
  activitiesByRecency,
  loadYear,
}: LatestRoutedActivityOptions): Promise<Activity | null> => {
  const candidatesByYear = new Map<string, Activity[]>();

  for (const candidate of activitiesByRecency) {
    const year = candidate.start_date_local.slice(0, 4);
    const yearCandidates = candidatesByYear.get(year) ?? [];
    yearCandidates.push(candidate);
    candidatesByYear.set(year, yearCandidates);
  }

  for (const [year, yearCandidates] of candidatesByYear) {
    const routedActivities = await loadYear(year);
    const routedById = new Map(
      routedActivities.map((activity) => [activity.run_id, activity])
    );
    const latestRoutedCandidate = yearCandidates
      .map((candidate) => routedById.get(candidate.run_id))
      .find((candidate) => Boolean(candidate?.summary_polyline));

    if (latestRoutedCandidate) {
      return latestRoutedCandidate;
    }
  }

  return null;
};
