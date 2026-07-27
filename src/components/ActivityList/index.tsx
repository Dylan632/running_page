import React, {
  lazy,
  useState,
  Suspense,
  useEffect,
  useRef,
  useCallback,
  useMemo,
  useSyncExternalStore,
} from 'react';
import { Link } from 'react-router-dom';
import styles from './style.module.css';
import {
  ACTIVITY_TOTAL,
  HOME_PAGE_TITLE,
  LOADING_TEXT,
  SHOW_ELEVATION_GAIN,
} from '@/utils/const';
import { getPosterComponents } from '@assets/index';
import { DIST_UNIT, M_TO_DIST } from '@/utils/utils';
import type { Activity } from '@/utils/utils';
import useActivities, { useActivitiesWithRoutes } from '@/hooks/useActivities';
import { useActivityMode } from '@/modules/activity/ActivityModeProvider';
import type { ActivityMode } from '@/modules/activity/profiles';
import { summarizeActivities } from '@/modules/activity/insights';
import YearPosterLauncher from './YearPosterLauncher';
// Layout constants (avoid magic numbers)
const ITEM_WIDTH = 280;
const ITEM_GAP = 20;

interface SnapshotStore<T> {
  getSnapshot: () => T;
  getServerSnapshot: () => T;
  setSnapshot: (nextSnapshot: T) => void;
  subscribe: (listener: () => void) => () => void;
}

function createSnapshotStore<T>(initialSnapshot: T): SnapshotStore<T> {
  let snapshot = initialSnapshot;
  const listeners = new Set<() => void>();

  return {
    getSnapshot: () => snapshot,
    getServerSnapshot: () => initialSnapshot,
    setSnapshot: (nextSnapshot) => {
      if (Object.is(snapshot, nextSnapshot)) return;
      snapshot = nextSnapshot;
      listeners.forEach((listener) => listener());
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

const loadRoutePreview = () => import('@/components/RoutePreview');
const RoutePreview = lazy(loadRoutePreview);
const loadActivityChart = () => import('./ActivityChart');
const ActivityChart = lazy(loadActivityChart);

const MonthOfLifePoster = ({
  mode,
  sportType,
}: {
  mode: ActivityMode;
  sportType: string;
}) => {
  const posters = getPosterComponents(mode).totalStat;
  const fileName = sportType === 'all' ? 'mol.svg' : `mol_${sportType}.svg`;
  const path = `./${mode}/${fileName}`;
  const Poster = posters[path];

  return Poster ? (
    <Poster />
  ) : (
    <p role="status">当前运动没有可用的生命月历海报。</p>
  );
};

const ActivityRoutePreview = ({ activities }: { activities: Activity[] }) => {
  const year = activities[0]?.start_date_local.slice(0, 4) ?? '';
  const { activities: activitiesWithRoutes } = useActivitiesWithRoutes(year);
  const activityIds = useMemo(
    () => new Set(activities.map((activity) => activity.run_id)),
    [activities]
  );
  const selectedActivities = useMemo(
    () =>
      activitiesWithRoutes.filter((activity) =>
        activityIds.has(activity.run_id)
      ),
    [activitiesWithRoutes, activityIds]
  );

  return <RoutePreview activities={selectedActivities} />;
};

interface ActivitySummary {
  dailyDistances: number[];
  location: string;
  activities: Activity[];
}

interface DisplaySummary {
  totalDistance: number;
  averageSpeed: number;
  totalTime: number;
  count: number;
  maxDistance: number;
  maxSpeed: number;
  location: string;
  totalElevationGain?: number;
  averageHeartRate?: number; // Add heart rate display
}

interface ChartData {
  day: number;
  distance: string;
}

interface ActivityCardProps {
  period: string;
  summary: DisplaySummary;
  dailyDistances: number[];
  interval: string;
  activities?: Activity[]; // Add activities for day interval
}

interface ActivityGroups {
  [key: string]: ActivitySummary;
}

type IntervalType = 'year' | 'month' | 'week' | 'day' | 'life';

// A row group contains multiple activity card data items that will be rendered in one virtualized row
type RowGroup = Array<{ period: string; summary: ActivitySummary }>;

interface ActivityListCache {
  activityGroups: Map<string, ActivityGroups>;
  availableYears?: string[];
  periodSummaries: Map<string, RowGroup>;
  sportTypeOptions?: string[];
}

const activityListCache = new WeakMap<Activity[], ActivityListCache>();

const getActivityListCache = (activityData: Activity[]) => {
  let cache = activityListCache.get(activityData);
  if (!cache) {
    cache = {
      activityGroups: new Map(),
      periodSummaries: new Map(),
    };
    activityListCache.set(activityData, cache);
  }
  return cache;
};

const getSportTypeOptions = (activityData: Activity[]) => {
  const cache = getActivityListCache(activityData);
  if (cache.sportTypeOptions) return cache.sportTypeOptions;

  const sportTypeSet = new Set(activityData.map((activity) => activity.type));
  if (sportTypeSet.has('Run')) {
    sportTypeSet.delete('Run');
    sportTypeSet.add('running');
  }
  if (sportTypeSet.has('Walk')) {
    sportTypeSet.delete('Walk');
    sportTypeSet.add('walking');
  }
  if (sportTypeSet.has('Ride')) {
    sportTypeSet.delete('Ride');
    sportTypeSet.add('cycling');
  }
  cache.sportTypeOptions = ['all', ...sportTypeSet];
  return cache.sportTypeOptions;
};

const getAvailableActivityYears = (activityData: Activity[]) => {
  const cache = getActivityListCache(activityData);
  if (cache.availableYears) return cache.availableYears;

  cache.availableYears = Array.from(
    new Set(
      activityData.map((activity) =>
        new Date(activity.start_date_local).getFullYear().toString()
      )
    )
  ).sort((a, b) => Number(b) - Number(a));
  return cache.availableYears;
};

const formatTime = (seconds: number): string => {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  return `${h}h ${m}m ${s}s`;
};

const formatSpeedMetric = (speed: number, mode: ActivityMode): string => {
  if (!Number.isFinite(speed) || speed <= 0) {
    return mode === 'cycling' ? `0.0 ${DIST_UNIT}/h` : `0:00 min/${DIST_UNIT}`;
  }

  if (mode === 'cycling') return `${speed.toFixed(1)} ${DIST_UNIT}/h`;

  const pace = 60 / speed;
  const totalSeconds = Math.round(pace * 60);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds < 10 ? '0' : ''}${seconds} min/${DIST_UNIT}`;
};

const generateLabels = (interval: string, period: string): number[] => {
  if (interval === 'month') {
    const [year, month] = period.split('-').map(Number);
    return Array.from(
      { length: new Date(year, month, 0).getDate() },
      (_, i) => i + 1
    );
  }
  if (interval === 'week') {
    return Array.from({ length: 7 }, (_, i) => i + 1);
  }
  if (interval === 'year') {
    return Array.from({ length: 12 }, (_, i) => i + 1);
  }
  return [];
};

const matchesSportType = (activity: Activity, sportTypeArg: string) => {
  if (sportTypeArg === 'all') return true;
  if (sportTypeArg === 'running') {
    return activity.type === 'running' || activity.type === 'Run';
  }
  if (sportTypeArg === 'walking') {
    return activity.type === 'walking' || activity.type === 'Walk';
  }
  if (sportTypeArg === 'cycling') {
    return activity.type === 'cycling' || activity.type === 'Ride';
  }
  return activity.type === sportTypeArg;
};

const createEmptyActivitySummary = (): ActivitySummary => ({
  dailyDistances: [],
  location: '',
  activities: [],
});

const getActivitySummaryCacheKey = (
  intervalArg: IntervalType,
  sportTypeArg: string
) => `${intervalArg}:${sportTypeArg}`;

const groupActivitiesByInterval = (
  activityData: Activity[],
  intervalArg: IntervalType,
  sportTypeArg: string
): ActivityGroups => {
  const cache = getActivityListCache(activityData);
  const cacheKey = getActivitySummaryCacheKey(intervalArg, sportTypeArg);
  const cachedGroups = cache.activityGroups.get(cacheKey);
  if (cachedGroups) return cachedGroups;

  const activityGroups = activityData
    .filter((activity) => matchesSportType(activity, sportTypeArg))
    .reduce((acc: ActivityGroups, activity) => {
      const date = new Date(activity.start_date_local);
      let key: string;
      let index: number;
      switch (intervalArg) {
        case 'year':
          key = date.getFullYear().toString();
          index = date.getMonth();
          break;
        case 'month':
          key = `${date.getFullYear()}-${(date.getMonth() + 1).toString().padStart(2, '0')}`;
          index = date.getDate() - 1;
          break;
        case 'week': {
          const currentDate = new Date(date.valueOf());
          currentDate.setDate(
            currentDate.getDate() + 4 - (currentDate.getDay() || 7)
          );
          const yearStart = new Date(currentDate.getFullYear(), 0, 1);
          const weekNum = Math.ceil(
            ((currentDate.getTime() - yearStart.getTime()) / 86400000 + 1) / 7
          );
          key = `${currentDate.getFullYear()}-W${weekNum.toString().padStart(2, '0')}`;
          index = (date.getDay() + 6) % 7;
          break;
        }
        case 'day':
          key = date.toLocaleDateString('zh').replaceAll('/', '-');
          index = 0;
          break;
        default:
          key = date.getFullYear().toString();
          index = 0;
      }

      if (!acc[key]) acc[key] = createEmptyActivitySummary();

      const distance = activity.distance / M_TO_DIST;
      acc[key].activities.push(activity);
      acc[key].dailyDistances[index] =
        (acc[key].dailyDistances[index] || 0) + distance;
      if (intervalArg === 'day')
        acc[key].location = activity.location_country || '';

      return acc;
    }, {} as ActivityGroups);

  cache.activityGroups.set(cacheKey, activityGroups);
  return activityGroups;
};

const sortPeriodSummaries = (
  activitiesByInterval: ActivityGroups,
  interval: IntervalType
): RowGroup =>
  Object.entries(activitiesByInterval)
    .sort(([a], [b]) => {
      if (interval === 'day') {
        return new Date(b).getTime() - new Date(a).getTime();
      }
      if (interval === 'week') {
        const [yearA, weekA] = a.split('-W').map(Number);
        const [yearB, weekB] = b.split('-W').map(Number);
        return yearB - yearA || weekB - weekA;
      }
      const [yearA, monthA = 0] = a.split('-').map(Number);
      const [yearB, monthB = 0] = b.split('-').map(Number);
      return yearB - yearA || monthB - monthA;
    })
    .map(([period, summary]) => ({ period, summary }));

const getPeriodSummaries = (
  activityData: Activity[],
  intervalArg: IntervalType,
  sportTypeArg: string
): RowGroup => {
  const cache = getActivityListCache(activityData);
  const cacheKey = getActivitySummaryCacheKey(intervalArg, sportTypeArg);
  const cachedSummaries = cache.periodSummaries.get(cacheKey);
  if (cachedSummaries) return cachedSummaries;

  const summaries = sortPeriodSummaries(
    groupActivitiesByInterval(activityData, intervalArg, sportTypeArg),
    intervalArg
  );
  cache.periodSummaries.set(cacheKey, summaries);
  return summaries;
};

const toDisplaySummary = (
  summary: ActivitySummary,
  mode: ActivityMode
): DisplaySummary => {
  const insights = summarizeActivities(summary.activities, mode);
  return {
    totalDistance: insights.totalDistanceMeters / M_TO_DIST,
    averageSpeed: insights.averageMetersPerSecond * (3600 / M_TO_DIST),
    totalTime: insights.totalMovingSeconds,
    count: insights.count,
    maxDistance: insights.maxDistanceMeters / M_TO_DIST,
    maxSpeed: insights.maxMetersPerSecond * (3600 / M_TO_DIST),
    location: summary.location,
    totalElevationGain: SHOW_ELEVATION_GAIN
      ? insights.totalElevationGainMeters
      : undefined,
    averageHeartRate: insights.averageHeartRate ?? undefined,
  };
};

function useActivityListColumns(itemWidth: number, gap: number) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const containerResizeObserverRef = useRef<ResizeObserver | null>(null);
  const layoutFrameRef = useRef<number | null>(null);

  const itemsPerRowStore = useMemo(() => createSnapshotStore(0), []);
  const itemsPerRow = useSyncExternalStore(
    itemsPerRowStore.subscribe,
    itemsPerRowStore.getSnapshot,
    itemsPerRowStore.getServerSnapshot
  );

  const updateItemsPerRow = useCallback(() => {
    const container = containerRef.current;
    if (!container) return;
    const containerWidth = container.clientWidth;
    const count = Math.max(
      1,
      Math.floor((containerWidth + gap) / (itemWidth + gap))
    );
    itemsPerRowStore.setSnapshot(count);
  }, [gap, itemWidth, itemsPerRowStore]);

  const scheduleMeasurementUpdate = useCallback(() => {
    if (layoutFrameRef.current !== null) {
      cancelAnimationFrame(layoutFrameRef.current);
    }

    layoutFrameRef.current = requestAnimationFrame(() => {
      layoutFrameRef.current = null;
      updateItemsPerRow();
    });
  }, [updateItemsPerRow]);

  const disconnectContainerObserver = useCallback(() => {
    containerResizeObserverRef.current?.disconnect();
    containerResizeObserverRef.current = null;
  }, []);

  const setSummaryContainerRef = useCallback(
    (node: HTMLDivElement | null) => {
      disconnectContainerObserver();
      containerRef.current = node;

      if (!node) {
        itemsPerRowStore.setSnapshot(0);
        return;
      }

      const observer = new ResizeObserver(scheduleMeasurementUpdate);
      observer.observe(node);
      containerResizeObserverRef.current = observer;
      scheduleMeasurementUpdate();
    },
    [disconnectContainerObserver, itemsPerRowStore, scheduleMeasurementUpdate]
  );

  useEffect(() => {
    scheduleMeasurementUpdate();
    window.addEventListener('resize', scheduleMeasurementUpdate);
    return () => {
      window.removeEventListener('resize', scheduleMeasurementUpdate);
    };
  }, [scheduleMeasurementUpdate]);

  useEffect(
    () => () => {
      disconnectContainerObserver();
      if (layoutFrameRef.current !== null) {
        cancelAnimationFrame(layoutFrameRef.current);
        layoutFrameRef.current = null;
      }
    },
    [disconnectContainerObserver]
  );

  return { itemsPerRow, setSummaryContainerRef };
}

const ActivityCardInner: React.FC<ActivityCardProps> = ({
  period,
  summary,
  dailyDistances,
  interval,
  activities = [],
}) => {
  const { mode } = useActivityMode();
  const [isFlipped, setIsFlipped] = useState(false);
  const [shouldRenderChart, setShouldRenderChart] = useState(false);
  const chartObserverRef = useRef<IntersectionObserver | null>(null);
  const showChart = ['month', 'week', 'year'].includes(interval);
  const setChartContainerRef = useCallback(
    (node: HTMLDivElement | null) => {
      chartObserverRef.current?.disconnect();
      chartObserverRef.current = null;

      if (!node || !showChart || shouldRenderChart) return;
      if (typeof IntersectionObserver === 'undefined') {
        setShouldRenderChart(true);
        return;
      }

      const observer = new IntersectionObserver(
        (entries) => {
          if (!entries.some((entry) => entry.isIntersecting)) return;
          setShouldRenderChart(true);
          observer.disconnect();
          chartObserverRef.current = null;
        },
        { rootMargin: '600px 0px' }
      );
      observer.observe(node);
      chartObserverRef.current = observer;
    },
    [shouldRenderChart, showChart]
  );

  useEffect(
    () => () => {
      chartObserverRef.current?.disconnect();
    },
    []
  );

  const handleCardClick = useCallback(() => {
    if (interval === 'day' && activities.length > 0) {
      setIsFlipped((current) => !current);
    }
  }, [activities.length, interval]);

  const data: ChartData[] = useMemo(() => {
    if (!showChart) return [];
    return generateLabels(interval, period).map((day) => ({
      day,
      distance: (dailyDistances[day - 1] || 0).toFixed(2),
    }));
  }, [dailyDistances, interval, period, showChart]);

  const { yAxisMax, yAxisTicks } = useMemo(() => {
    if (!showChart) {
      return { yAxisMax: 0, yAxisTicks: [] };
    }
    const max = Math.ceil(
      Math.max(...data.map((d) => parseFloat(d.distance))) + 10
    );
    return {
      yAxisMax: max,
      yAxisTicks: Array.from(
        { length: Math.ceil(max / 5) + 1 },
        (_, i) => i * 5
      ),
    };
  }, [data, showChart]);

  const isInteractive = interval === 'day' && activities.length > 0;
  const cardClassName = `${styles.activityCard} ${
    isInteractive ? styles.activityCardFlippable : ''
  }`;
  const cardContent = (
    <div className={`${styles.cardInner} ${isFlipped ? styles.flipped : ''}`}>
      {/* Front side - Activity details */}
      <div className={styles.cardFront}>
        <h2 className={styles.activityName}>{period}</h2>
        <div className={styles.activityDetails}>
          <p>
            <strong>{ACTIVITY_TOTAL.TOTAL_DISTANCE_TITLE}:</strong>{' '}
            {summary.totalDistance.toFixed(2)} {DIST_UNIT}
          </p>
          {SHOW_ELEVATION_GAIN && summary.totalElevationGain !== undefined && (
            <p>
              <strong>{ACTIVITY_TOTAL.TOTAL_ELEVATION_GAIN_TITLE}:</strong>{' '}
              {summary.totalElevationGain.toFixed(0)} m
            </p>
          )}
          <p>
            <strong>{ACTIVITY_TOTAL.AVERAGE_SPEED_TITLE}:</strong>{' '}
            {formatSpeedMetric(summary.averageSpeed, mode)}
          </p>
          <p>
            <strong>{ACTIVITY_TOTAL.TOTAL_TIME_TITLE}:</strong>{' '}
            {formatTime(summary.totalTime)}
          </p>
          {summary.averageHeartRate !== undefined && (
            <p>
              <strong>{ACTIVITY_TOTAL.AVERAGE_HEART_RATE_TITLE}:</strong>{' '}
              {summary.averageHeartRate.toFixed(0)} bpm
            </p>
          )}
          {interval !== 'day' && (
            <>
              <p>
                <strong>{ACTIVITY_TOTAL.ACTIVITY_COUNT_TITLE}:</strong>{' '}
                {summary.count}
              </p>
              <p>
                <strong>{ACTIVITY_TOTAL.MAX_DISTANCE_TITLE}:</strong>{' '}
                {summary.maxDistance.toFixed(2)} {DIST_UNIT}
              </p>
              <p>
                <strong>{ACTIVITY_TOTAL.MAX_SPEED_TITLE}:</strong>{' '}
                {formatSpeedMetric(summary.maxSpeed, mode)}
              </p>
              <p>
                <strong>{ACTIVITY_TOTAL.AVERAGE_DISTANCE_TITLE}:</strong>{' '}
                {(summary.totalDistance / summary.count).toFixed(2)} {DIST_UNIT}
              </p>
            </>
          )}
          {showChart && (
            <div ref={setChartContainerRef} className={styles.chart}>
              {shouldRenderChart && (
                <Suspense fallback={null}>
                  <ActivityChart
                    data={data}
                    yAxisMax={yAxisMax}
                    yAxisTicks={yAxisTicks}
                  />
                </Suspense>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Back side - Route preview */}
      {interval === 'day' && activities.length > 0 && isFlipped && (
        <div className={styles.cardBack}>
          <div className={styles.routeContainer}>
            <Suspense
              fallback={
                <div role="status" aria-live="polite">
                  正在加载路线…
                </div>
              }
            >
              <ActivityRoutePreview activities={activities} />
            </Suspense>
          </div>
        </div>
      )}
    </div>
  );

  if (isInteractive) {
    return (
      <button
        type="button"
        className={cardClassName}
        aria-label={`${period} 活动详情，${isFlipped ? '显示统计' : '显示路线'}`}
        aria-pressed={isFlipped}
        onClick={handleCardClick}
      >
        {cardContent}
      </button>
    );
  }

  return <article className={cardClassName}>{cardContent}</article>;
};

// custom equality for memo: compare key summary fields, dailyDistances values and activities length
const activityCardAreEqual = (
  prev: ActivityCardProps,
  next: ActivityCardProps
) => {
  if (prev.period !== next.period) return false;
  if (prev.interval !== next.interval) return false;
  const s1 = prev.summary;
  const s2 = next.summary;
  if (
    s1.totalDistance !== s2.totalDistance ||
    s1.averageSpeed !== s2.averageSpeed ||
    s1.totalTime !== s2.totalTime ||
    s1.count !== s2.count ||
    s1.maxDistance !== s2.maxDistance ||
    s1.maxSpeed !== s2.maxSpeed ||
    s1.location !== s2.location ||
    (s1.totalElevationGain ?? undefined) !==
      (s2.totalElevationGain ?? undefined) ||
    (s1.averageHeartRate ?? undefined) !== (s2.averageHeartRate ?? undefined)
  ) {
    return false;
  }
  const d1 = prev.dailyDistances || [];
  const d2 = next.dailyDistances || [];
  if (d1.length !== d2.length) return false;
  for (let i = 0; i < d1.length; i++) if (d1[i] !== d2[i]) return false;
  const a1 = prev.activities || [];
  const a2 = next.activities || [];
  if (a1.length !== a2.length) return false;
  return true;
};

const ActivityCard = React.memo(ActivityCardInner, activityCardAreEqual);

const ActivityList: React.FC = () => {
  const { mode, profile } = useActivityMode();
  const { activities: activityData } = useActivities();
  const [interval, setInterval] = useState<IntervalType>('month');
  const [sportType, setSportType] = useState<string>('all');
  const [selectedYear, setSelectedYear] = useState<string | null>(null);

  const availableYears = useMemo(
    () => getAvailableActivityYears(activityData),
    [activityData]
  );
  const sportTypeOptions = useMemo(
    () => getSportTypeOptions(activityData),
    [activityData]
  );

  // Keyboard navigation for year selection in Life view
  useEffect(() => {
    if (interval !== 'life') return;

    const handleKeyDown = (e: KeyboardEvent) => {
      // Only handle arrow keys
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;

      // Prevent default scrolling behavior
      e.preventDefault();

      // Remove focus from current element to avoid visual confusion
      if (document.activeElement instanceof HTMLElement) {
        document.activeElement.blur();
      }

      const currentIndex = selectedYear
        ? availableYears.indexOf(selectedYear)
        : -1;

      if (e.key === 'ArrowLeft') {
        // Move to newer year (left in UI, lower index since sorted descending)
        if (currentIndex === -1) {
          // No year selected, select the last (oldest) year
          setSelectedYear(availableYears[availableYears.length - 1]);
        } else if (currentIndex > 0) {
          setSelectedYear(availableYears[currentIndex - 1]);
        } else if (currentIndex === 0) {
          // At the most recent year, deselect to show Life view
          setSelectedYear(null);
        }
      } else if (e.key === 'ArrowRight') {
        // Move to older year (right in UI, higher index since sorted descending)
        if (currentIndex === -1) {
          // No year selected, select the first (most recent) year
          setSelectedYear(availableYears[0]);
        } else if (currentIndex < availableYears.length - 1) {
          setSelectedYear(availableYears[currentIndex + 1]);
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [interval, selectedYear, availableYears]);

  function toggleInterval(newInterval: IntervalType): void {
    if (newInterval === 'life' && sportType !== 'all') {
      setSportType('all');
    }
    if (newInterval === 'day') {
      void loadRoutePreview();
    }
    setInterval(newInterval);
  }

  const dataList = useMemo(
    () => getPeriodSummaries(activityData, interval, sportType),
    [activityData, interval, sportType]
  );

  const { itemsPerRow, setSummaryContainerRef } = useActivityListColumns(
    ITEM_WIDTH,
    ITEM_GAP
  );

  const calcGroup: RowGroup[] = useMemo(() => {
    if (itemsPerRow < 1) return [];
    const groupLength = Math.ceil(dataList.length / itemsPerRow);
    const arr: RowGroup[] = [];
    for (let i = 0; i < groupLength; i++) {
      const start = i * itemsPerRow;
      arr.push(dataList.slice(start, start + itemsPerRow));
    }
    return arr;
  }, [dataList, itemsPerRow]);

  // Compute a row width so the list stays centered while cards remain left-aligned.
  const rowWidth =
    itemsPerRow < 1
      ? '100%'
      : `${itemsPerRow * ITEM_WIDTH + Math.max(0, itemsPerRow - 1) * ITEM_GAP}px`;

  const loading = itemsPerRow < 1;
  return (
    <div className={styles.activityList}>
      <div className={styles.filterContainer}>
        <Link className={styles.smallHomeButton} lang="en" to={profile.route}>
          {HOME_PAGE_TITLE}
        </Link>
        <select
          aria-label="运动类型筛选"
          onChange={(e) => setSportType(e.target.value)}
          value={sportType}
        >
          {sportTypeOptions.map((type) => (
            <option
              key={type}
              value={type}
              disabled={interval === 'life' && type !== 'all'}
            >
              {type}
            </option>
          ))}
        </select>
        <select
          aria-label="时间范围筛选"
          onChange={(e) => toggleInterval(e.target.value as IntervalType)}
          value={interval}
        >
          <option value="year">{ACTIVITY_TOTAL.YEARLY_TITLE}</option>
          <option value="month">{ACTIVITY_TOTAL.MONTHLY_TITLE}</option>
          <option value="week">{ACTIVITY_TOTAL.WEEKLY_TITLE}</option>
          <option value="day">{ACTIVITY_TOTAL.DAILY_TITLE}</option>
          <option value="life">Life</option>
        </select>
      </div>

      {interval === 'life' && (
        <div className={styles.lifeContainer}>
          {/* Year selector buttons */}
          <div className={styles.yearSelector}>
            {availableYears.map((year) => (
              <button
                key={year}
                type="button"
                className={`${styles.yearButton} ${selectedYear === year ? styles.yearButtonActive : ''}`}
                aria-pressed={selectedYear === year}
                onClick={() =>
                  setSelectedYear(selectedYear === year ? null : year)
                }
              >
                {year}
              </button>
            ))}
          </div>
          <Suspense fallback={<div>Loading SVG...</div>}>
            {selectedYear ? (
              <YearPosterLauncher year={selectedYear} />
            ) : (
              <MonthOfLifePoster mode={mode} sportType={sportType} />
            )}
          </Suspense>
        </div>
      )}

      {interval !== 'life' && (
        <div className={styles.summaryContainer} ref={setSummaryContainerRef}>
          <div className={styles.summaryInner}>
            <div style={{ width: rowWidth }}>
              {loading ? (
                <div
                  style={{
                    minHeight: 240,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <div
                    style={{
                      padding: 20,
                      color: 'var(--color-run-table-thead)',
                    }}
                  >
                    {LOADING_TEXT}
                  </div>
                </div>
              ) : (
                calcGroup.map((row) => (
                  <div
                    key={row[0]?.period ?? ''}
                    className={styles.rowContainer}
                    style={{ gap: `${ITEM_GAP}px` }}
                  >
                    {row.map(
                      (cardData: {
                        period: string;
                        summary: ActivitySummary;
                      }) => (
                        <ActivityCard
                          key={cardData.period}
                          period={cardData.period}
                          summary={toDisplaySummary(cardData.summary, mode)}
                          dailyDistances={cardData.summary.dailyDistances}
                          interval={interval}
                          activities={
                            interval === 'day'
                              ? cardData.summary.activities
                              : undefined
                          }
                        />
                      )
                    )}
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default ActivityList;
