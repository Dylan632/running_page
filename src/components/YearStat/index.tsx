import { Suspense } from 'react';
import Stat from '@/components/Stat';
import useActivities from '@/hooks/useActivities';
import type { Activity } from '@/utils/utils';
import { formatPace } from '@/utils/utils';
import useHover from '@/hooks/useHover';
import { getPosterComponents } from '@assets/index';
import { SHOW_ELEVATION_GAIN } from '@/utils/const';
import { DIST_UNIT, M_TO_DIST, M_TO_ELEV } from '@/utils/utils';
import { useActivityMode } from '@/modules/activity/ActivityModeProvider';
import type { ActivityMode } from '@/modules/activity/profiles';
import {
  summarizeActivitiesByYear,
  type ActivityInsights,
} from '@/modules/activity/insights';

const yearStatCache = new WeakMap<
  Activity[],
  Map<ActivityMode, Map<string, ActivityInsights>>
>();

const getYearStatSummaries = (activityData: Activity[], mode: ActivityMode) => {
  let summariesByMode = yearStatCache.get(activityData);
  const cachedSummaries = summariesByMode?.get(mode);
  if (cachedSummaries) return cachedSummaries;

  const summaries = summarizeActivitiesByYear(activityData, mode);
  if (!summariesByMode) {
    summariesByMode = new Map();
    yearStatCache.set(activityData, summariesByMode);
  }
  summariesByMode.set(mode, summaries);
  return summaries;
};

const YearStat = ({
  year,
  onClick,
  selected = true,
}: {
  year: string;
  onClick: (_year: string) => void;
  selected?: boolean;
}) => {
  const { activities } = useActivities();
  const { mode, profile } = useActivityMode();
  // for hover
  const [hovered, eventHandlers] = useHover();
  const posterComponents = getPosterComponents(mode);
  const yearPosterPath = `./${mode}/year_${year}.svg`;
  const githubPosterPath = `./${mode}/github_${year}.svg`;
  const YearSVG = posterComponents.yearStats[yearPosterPath];
  const GithubYearSVG = posterComponents.githubYearStats[githubPosterPath];
  const summary = getYearStatSummaries(activities, mode).get(year);

  if (!summary) return null;

  const averagePace = summary.averageMetersPerSecond
    ? formatPace(summary.averageMetersPerSecond, mode)
    : '0';
  const averageSpeed = (
    summary.averageMetersPerSecond *
    (3600 / M_TO_DIST)
  ).toFixed(1);
  const averageMetricValue = mode === 'cycling' ? averageSpeed : averagePace;
  const averageMetricDescription =
    mode === 'cycling' ? ` ${DIST_UNIT}/h Avg Speed` : ' Avg Pace';
  const yearLabel = year === 'Total' ? '全部年份' : `${year} 年`;

  return (
    <article
      className="kami-year-stat"
      data-selected={selected}
      {...eventHandlers}
    >
      <button
        type="button"
        className="kami-year-stat-action"
        data-year={year}
        aria-label={`显示${yearLabel}活动`}
        aria-pressed={selected}
        onClick={() => onClick(year)}
      />
      <section>
        <Stat value={year} description=" Journey" />
        <Stat
          value={summary.count}
          description={profile.copy.countDescription}
        />
        <Stat
          value={parseFloat(
            (summary.totalDistanceMeters / M_TO_DIST).toFixed(1)
          )}
          description={` ${DIST_UNIT}`}
        />
        {SHOW_ELEVATION_GAIN && (
          <Stat
            value={(summary.totalElevationGainMeters * M_TO_ELEV).toFixed(0)}
            description=" Elevation Gain"
          />
        )}
        <Stat
          value={averageMetricValue}
          description={averageMetricDescription}
        />
        <Stat value={`${summary.maxStreakDays} day`} description=" Streak" />
        {summary.averageHeartRate !== null && (
          <Stat
            value={summary.averageHeartRate.toFixed(0)}
            description=" Avg Heart Rate"
          />
        )}
      </section>
      {year !== 'Total' && hovered && YearSVG && GithubYearSVG && (
        <Suspense fallback="loading...">
          <YearSVG className="year-svg my-4 h-4/6 w-4/6 border-0 p-0" />
          <GithubYearSVG className="github-year-svg my-4 h-auto w-full border-0 p-0" />
        </Suspense>
      )}
    </article>
  );
};

export default YearStat;
