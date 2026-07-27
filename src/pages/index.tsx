import {
  useEffect,
  useState,
  useMemo,
  useCallback,
  useRef,
  useSyncExternalStore,
  startTransition,
  lazy,
  Suspense,
} from 'react';
import { Helmet } from 'react-helmet-async';
import { useSearchParams } from 'react-router-dom';
import Layout from '@/components/Layout';
import LocationStat from '@/components/LocationStat';
import RunTable from '@/components/RunTable';
import SVGStat from '@/components/SVGStat';
import YearsStat from '@/components/YearsStat';
import useActivities, {
  preloadActivitiesWithRoutes,
  useActivitiesWithRoutes,
} from '@/hooks/useActivities';
import useSiteMetadata from '@/hooks/useSiteMetadata';
import { useInterval } from '@/hooks/useInterval';
import { IS_CHINESE } from '@/utils/const';
import {
  Activity,
  ActivityId,
  filterAndSortRuns,
  filterCityRuns,
  filterTitleRuns,
  filterYearRuns,
  scrollToMap,
  sortDateFunc,
  titleForShow,
  RunIds,
} from '@/utils/utils';
import {
  geoJsonForRuns,
  getBoundsForGeoData,
  getPrimaryBoundsForGeoData,
  type IViewState,
} from '@/utils/geoUtils';
import { useTheme, useThemeChangeCounter } from '@/hooks/useTheme';
import { useActivityMode } from '@/modules/activity/ActivityModeProvider';

const RunMap = lazy(() => import('@/components/RunMap'));

const HASH_RUN_CHANGE_EVENT = 'running-page-hash-run-change';
const SVG_STAT_TARGET_SELECTOR = 'path, polyline, rect';

const getRunIdFromHash = () => {
  if (typeof window === 'undefined') return null;
  const hash = window.location.hash.replace('#', '');
  if (!hash.startsWith('run_')) return null;
  const runId = hash.slice('run_'.length);
  return runId.length > 0 ? runId : null;
};

const subscribeToRunHash = (onStoreChange: () => void) => {
  window.addEventListener('hashchange', onStoreChange);
  window.addEventListener(HASH_RUN_CHANGE_EVENT, onStoreChange);
  return () => {
    window.removeEventListener('hashchange', onStoreChange);
    window.removeEventListener(HASH_RUN_CHANGE_EVENT, onStoreChange);
  };
};

const notifyRunHashChange = () => {
  window.dispatchEvent(new Event(HASH_RUN_CHANGE_EVENT));
};

const clearRunHash = () => {
  if (window.location.hash) {
    window.history.pushState(
      null,
      '',
      `${window.location.pathname}${window.location.search}`
    );
    notifyRunHashChange();
  }
};

const setRunHash = (runId: ActivityId) => {
  const newHash = `#run_${runId}`;
  if (window.location.hash !== newHash) {
    window.history.pushState(null, '', newHash);
    notifyRunHashChange();
  }
};

const getSvgStatTarget = (
  eventTarget: EventTarget | null,
  root: Element
): Element | null => {
  if (!(eventTarget instanceof Element)) return null;
  const target = eventTarget.closest(SVG_STAT_TARGET_SELECTOR);
  return target && root.contains(target) ? target : null;
};

const useRunHashId = () =>
  useSyncExternalStore(subscribeToRunHash, getRunIdFromHash, () => null);

const Index = () => {
  const { siteTitle, siteUrl } = useSiteMetadata();
  const { mode, profile } = useActivityMode();
  const { thisYear, years } = useActivities();
  const [searchParams, setSearchParams] = useSearchParams();
  const requestedYear = searchParams.get('year');
  const year =
    requestedYear &&
    (requestedYear === 'Total' || years.includes(requestedYear))
      ? requestedYear
      : thisYear;
  const { activities } = useActivitiesWithRoutes(year);
  const themeChangeCounter = useThemeChangeCounter();
  const [runIndex, setRunIndex] = useState(-1);
  const [title, setTitle] = useState('');
  // Animation states for replacing intervalIdRef
  const [isAnimating, setIsAnimating] = useState(false);
  const [currentAnimationIndex, setCurrentAnimationIndex] = useState(0);
  const [animationRuns, setAnimationRuns] = useState<Activity[]>([]);
  const [pendingYear, setPendingYear] = useState<string | null>(null);
  const [sidebarPanel, setSidebarPanel] = useState<'years' | 'location'>(
    'years'
  );
  const [currentFilter, setCurrentFilter] = useState<{
    item: string;
    func: (_run: Activity, _value: string) => boolean;
  }>({ item: year, func: filterYearRuns });

  const selectYear = useCallback(
    async (nextYear: string, replace = false) => {
      setPendingYear(nextYear);
      const routeYears = nextYear === 'Total' ? years : [nextYear];
      await preloadActivitiesWithRoutes(mode, routeYears).catch(() => {
        // Commit the route below so the rejected resource is handled by the
        // page error boundary, where the user can retry.
      });
      startTransition(() => {
        setSearchParams(
          (current) => {
            const next = new URLSearchParams(current);
            next.set('year', nextYear);
            next.set('view', 'map');
            return next;
          },
          { replace }
        );
        setPendingYear(null);
      });
    },
    [mode, setSearchParams, years]
  );

  useEffect(() => {
    if (!requestedYear || requestedYear === year) return;
    setSearchParams(
      (current) => {
        const next = new URLSearchParams(current);
        next.set('year', year);
        return next;
      },
      { replace: true }
    );
  }, [requestedYear, setSearchParams, year]);

  // Track if we're showing a single run from URL hash
  const singleRunId = useRunHashId();

  // Animation trigger for single runs - increment this to force animation replay
  const [animationTrigger, setAnimationTrigger] = useState(0);

  const selectedRunIdRef = useRef<ActivityId | null>(null);
  const selectedRunDateRef = useRef<string | null>(null);
  const activeFilterItem =
    currentFilter.func === filterYearRuns ? year : currentFilter.item;

  useEffect(() => {
    const frameId = requestAnimationFrame(() => {
      setRunIndex(-1);
      setTitle('');
      selectedRunIdRef.current = null;
      selectedRunDateRef.current = null;
    });
    return () => cancelAnimationFrame(frameId);
  }, [mode]);

  // Memoize expensive calculations
  const runs = useMemo(() => {
    return filterAndSortRuns(
      activities,
      activeFilterItem,
      currentFilter.func,
      sortDateFunc
    );
  }, [activities, activeFilterItem, currentFilter.func]);

  const geoData = useMemo(() => {
    void themeChangeCounter;
    return geoJsonForRuns(runs);
  }, [runs, themeChangeCounter]);

  // for auto zoom
  const bounds = useMemo(() => {
    const isAnnualOverview =
      currentFilter.func === filterYearRuns && year !== 'Total';
    return isAnnualOverview
      ? getPrimaryBoundsForGeoData(geoData)
      : getBoundsForGeoData(geoData);
  }, [currentFilter.func, geoData, year]);

  const [viewState, setViewState] = useState<IViewState>(() => ({
    ...bounds,
  }));

  // Add state for animated geoData to handle the animation effect
  const [animatedGeoData, setAnimatedGeoData] = useState(geoData);

  // Use useInterval for animation instead of intervalIdRef
  useInterval(
    () => {
      if (!isAnimating || currentAnimationIndex >= animationRuns.length) {
        setIsAnimating(false);
        setAnimatedGeoData(geoData);
        return;
      }

      const runsNum = animationRuns.length;
      const sliceNum = runsNum >= 8 ? Math.ceil(runsNum / 8) : 1;
      const nextIndex = Math.min(currentAnimationIndex + sliceNum, runsNum);
      const tempRuns = animationRuns.slice(0, nextIndex);
      setAnimatedGeoData(geoJsonForRuns(tempRuns));
      setCurrentAnimationIndex(nextIndex);

      if (nextIndex >= runsNum) {
        setIsAnimating(false);
        setAnimatedGeoData(geoData);
      }
    },
    isAnimating ? 300 : null
  );

  // Helper function to start animation
  const startAnimation = useCallback(
    (runsToAnimate: Activity[]) => {
      if (runsToAnimate.length === 0) {
        setAnimatedGeoData(geoData);
        return;
      }

      const sliceNum =
        runsToAnimate.length >= 8 ? Math.ceil(runsToAnimate.length / 8) : 1;
      setAnimationRuns(runsToAnimate);
      setCurrentAnimationIndex(sliceNum);
      setIsAnimating(true);
    },
    [geoData]
  );

  const changeByItem = useCallback(
    (
      item: string,
      name: string,
      func: (_run: Activity, _value: string) => boolean
    ) => {
      scrollToMap();
      if (name != 'Year') {
        selectYear(thisYear);
      }
      setCurrentFilter({ item, func });
      setRunIndex(-1);
      setTitle(`${item} ${name} ${profile.copy.heatmapTitle}`);
      // Reset single run state when changing filters
      clearRunHash();
    },
    [profile.copy.heatmapTitle, selectYear, thisYear]
  );

  const changeYear = useCallback(
    (y: string) => {
      // default year
      void selectYear(y);

      if ((viewState.zoom ?? 0) > 3 && bounds) {
        setViewState({
          ...bounds,
        });
      }

      changeByItem(y, 'Year', filterYearRuns);
      // Stop current animation
      setIsAnimating(false);
    },
    [viewState.zoom, bounds, changeByItem, selectYear]
  );

  const changeCity = useCallback(
    (city: string) => {
      changeByItem(city, 'City', filterCityRuns);
    },
    [changeByItem]
  );

  const changeTitle = useCallback(
    (title: string) => {
      changeByItem(title, 'Title', filterTitleRuns);
    },
    [changeByItem]
  );

  const locateActivity = useCallback(
    (runIds: RunIds) => {
      const ids = new Set(runIds);

      const selectedRuns = !runIds.length
        ? runs
        : runs.filter((run: Activity) => ids.has(run.run_id));

      if (!selectedRuns.length) {
        return;
      }

      const lastRun = selectedRuns.slice().sort(sortDateFunc)[0];

      if (!lastRun) {
        return;
      }

      // Set runIndex for table highlighting when single run is selected
      if (runIds.length === 1) {
        const runId = runIds[0];
        const runIdx = runs.findIndex((run) => run.run_id === runId);
        setRunIndex(runIdx);
      } else {
        setRunIndex(-1);
      }

      // Update URL hash when a single run is located
      if (runIds.length === 1) {
        const runId = runIds[0];
        setRunHash(runId);
      } else {
        // If multiple runs or no runs, clear the hash and single run state
        clearRunHash();
      }

      // Create geoData for selected runs and calculate new bounds
      const selectedGeoData = geoJsonForRuns(selectedRuns);
      const selectedBounds = getBoundsForGeoData(selectedGeoData);

      // Stop any existing animation
      setIsAnimating(false);

      // Update the animated geoData immediately to trigger RunMap animation
      setAnimatedGeoData(selectedGeoData);

      // For single run, trigger animation by incrementing the trigger
      if (runIds.length === 1) {
        setAnimationTrigger((prev) => prev + 1);
      }

      // Update view state
      setViewState({
        ...selectedBounds,
      });
      setTitle(titleForShow(lastRun));
      scrollToMap();
    },
    [runs]
  );

  // Auto locate activity when singleRunId is set and activities are loaded
  // First, detect the run's year and switch to it if needed
  useEffect(() => {
    if (singleRunId !== null && activities.length > 0) {
      const frameId = requestAnimationFrame(() => {
        const targetRun = activities.find((run) => run.run_id === singleRunId);
        if (targetRun) {
          const runYear = targetRun.start_date_local.slice(0, 4);
          if (year !== runYear) {
            void selectYear(runYear);
          }
        } else {
          // Activity ids are mode-specific. Keep year/view state but clear an
          // incompatible selection when switching modes.
          setRunIndex(-1);
          setTitle('');
          selectedRunIdRef.current = null;
          selectedRunDateRef.current = null;
          window.history.replaceState(
            null,
            '',
            `${window.location.pathname}${window.location.search}`
          );
          notifyRunHashChange();
        }
      });
      return () => cancelAnimationFrame(frameId);
    }
  }, [singleRunId, activities, selectYear, year]);

  useEffect(() => {
    if (singleRunId !== null && runs.length > 0) {
      const frameId = requestAnimationFrame(() => {
        const runExistsInCurrentRuns = runs.some(
          (run) => run.run_id === singleRunId
        );
        if (runExistsInCurrentRuns) {
          locateActivity([singleRunId]);
        }
      });
      return () => cancelAnimationFrame(frameId);
    }
  }, [runs, singleRunId, locateActivity]);

  // Update bounds when geoData changes
  useEffect(() => {
    if (singleRunId === null) {
      const frameId = requestAnimationFrame(() => {
        setViewState((prev) => ({
          ...prev,
          ...bounds,
        }));
      });
      return () => cancelAnimationFrame(frameId);
    }
  }, [bounds, singleRunId]);

  // Animate geoData when runs change
  useEffect(() => {
    if (singleRunId === null) {
      const frameId = requestAnimationFrame(() => startAnimation(runs));
      return () => cancelAnimationFrame(frameId);
    }
  }, [runs, startAnimation, singleRunId]);

  useEffect(() => {
    if (year !== 'Total') {
      return;
    }

    let svgStat = document.getElementById('svgStat');
    if (!svgStat) {
      return;
    }

    const handleClick = (e: Event) => {
      const target = getSvgStatTarget(e.target, svgStat);
      if (!target) return;

      const descEl = target.querySelector('desc');
      if (descEl) {
        // Grid routes store run_id in <desc>; calendar cells only have <title>.
        const runId = descEl.textContent?.trim() ?? '';
        if (!runId) {
          return;
        }
        if (selectedRunIdRef.current === runId) {
          selectedRunIdRef.current = null;
          locateActivity(runs.map((r) => r.run_id));
        } else {
          selectedRunIdRef.current = runId;
          locateActivity([runId]);
        }
        return;
      }

      const titleEl = target.querySelector('title');
      if (titleEl) {
        // If the runDate exists in the <title> element, it means that a date square has been clicked.
        const [runDate] = titleEl.textContent?.match(
          /\d{4}-\d{1,2}-\d{1,2}/
        ) || [`${+thisYear + 1}`];
        const runIDsOnDate = runs
          .filter((r) => r.start_date_local.slice(0, 10) === runDate)
          .map((r) => r.run_id);
        if (!runIDsOnDate.length) {
          return;
        }
        if (selectedRunDateRef.current === runDate) {
          selectedRunDateRef.current = null;
          locateActivity(runs.map((r) => r.run_id));
        } else {
          selectedRunDateRef.current = runDate;
          locateActivity(runIDsOnDate);
        }
      }
    };
    svgStat.addEventListener('click', handleClick);
    return () => {
      svgStat && svgStat.removeEventListener('click', handleClick);
    };
  }, [year, locateActivity, runs, thisYear]);

  const { theme } = useTheme();

  return (
    <Layout>
      <Helmet>
        <html lang="zh-CN" data-theme={theme} />
      </Helmet>
      <div className="order-2 w-full lg:order-1 lg:w-1/3">
        <h1 className="my-12 mt-6 text-5xl font-extrabold italic">
          <a href={siteUrl}>{siteTitle}</a>
        </h1>
        {IS_CHINESE && (
          <div className="mb-4 flex gap-2" role="group" aria-label="统计视图">
            <button
              type="button"
              className="min-h-11 rounded-full border px-4 py-2"
              aria-pressed={sidebarPanel === 'years'}
              onClick={() => setSidebarPanel('years')}
            >
              年份
            </button>
            <button
              type="button"
              className="min-h-11 rounded-full border px-4 py-2"
              aria-pressed={sidebarPanel === 'location'}
              onClick={() => setSidebarPanel('location')}
            >
              地点
            </button>
          </div>
        )}
        {IS_CHINESE && sidebarPanel === 'location' ? (
          <LocationStat
            changeYear={changeYear}
            changeCity={changeCity}
            changeTitle={changeTitle}
          />
        ) : (
          <YearsStat year={year} onClick={changeYear} />
        )}
      </div>
      <div
        id="map-container"
        data-app-ready={mode}
        className="order-1 w-full lg:order-2 lg:w-2/3"
      >
        {pendingYear && (
          <p className="sr-only" role="status" aria-live="polite">
            正在加载 {pendingYear === 'Total' ? '全部年份' : pendingYear} 的路线
          </p>
        )}
        <Suspense
          fallback={
            <div
              className="flex h-[250px] items-center justify-center md:h-[600px]"
              role="status"
              aria-live="polite"
              aria-busy="true"
            >
              正在加载地图…
            </div>
          }
        >
          <RunMap
            title={title}
            viewState={viewState}
            geoData={animatedGeoData}
            setViewState={setViewState}
            changeYear={changeYear}
            thisYear={year}
            animationTrigger={animationTrigger}
          />
        </Suspense>
        {year === 'Total' ? (
          <SVGStat runs={runs} locateActivity={locateActivity} />
        ) : (
          <RunTable
            runs={runs}
            locateActivity={locateActivity}
            runIndex={runIndex}
            setRunIndex={setRunIndex}
          />
        )}
      </div>
    </Layout>
  );
};

export default Index;
