import {
  Suspense,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { getPosterComponents } from '@assets/index';
import { useActivityMode } from '@/modules/activity/ActivityModeProvider';
import type { ActivityMode } from '@/modules/activity/profiles';
import {
  DIST_UNIT,
  M_TO_DIST,
  type Activity,
  type RunIds,
} from '@/utils/utils';
import styles from './style.module.css';

const posterPath = (mode: ActivityMode, name: string) => `./${mode}/${name}`;

interface SVGStatProps {
  runs: Activity[];
  locateActivity: (_runIds: RunIds) => void;
}

interface TotalPosterDialogProps {
  children: ReactNode;
  onClose: () => void;
  title: string;
}

const TotalPosterDialog = ({
  children,
  onClose,
  title,
}: TotalPosterDialogProps) => {
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const previouslyFocusedRef = useRef<HTMLElement | null>(null);
  const titleId = useId();
  const hintId = useId();

  useEffect(() => {
    previouslyFocusedRef.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    closeButtonRef.current?.focus();

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
        return;
      }

      const dialog = dialogRef.current;
      const closeButton = closeButtonRef.current;
      if (!dialog || !closeButton) return;

      if (document.activeElement === dialog) {
        const arrowStep = 80;
        const pageStep = Math.max(dialog.clientHeight * 0.8, arrowStep);
        const scrollDelta: Partial<Record<string, [number, number]>> = {
          ArrowDown: [0, arrowStep],
          ArrowLeft: [-arrowStep, 0],
          ArrowRight: [arrowStep, 0],
          ArrowUp: [0, -arrowStep],
          PageDown: [0, pageStep],
          PageUp: [0, -pageStep],
        };
        const delta = scrollDelta[event.key];
        if (delta) {
          event.preventDefault();
          dialog.scrollLeft += delta[0];
          dialog.scrollTop += delta[1];
          return;
        }
      }

      if (event.key !== 'Tab') return;
      event.preventDefault();
      if (document.activeElement === closeButton) {
        dialog.focus();
      } else {
        closeButton.focus();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = previousOverflow;
      const previouslyFocused = previouslyFocusedRef.current;
      if (previouslyFocused?.isConnected) {
        previouslyFocused.focus();
      }
    };
  }, [onClose]);

  return (
    <div
      className={styles.overlay}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={dialogRef}
        className={styles.dialog}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={hintId}
        tabIndex={0}
      >
        <h2 id={titleId} className={styles.visuallyHidden}>
          {title}
        </h2>
        <button
          ref={closeButtonRef}
          type="button"
          className={styles.closeButton}
          aria-label={`关闭${title}`}
          onClick={onClose}
        >
          ×
        </button>
        <p id={hintId} className={styles.panHint}>
          海报已放大，可上下左右滑动查看细节
        </p>
        <div className={styles.posterCanvas}>{children}</div>
      </div>
    </div>
  );
};

const SVGStat = ({ runs, locateActivity }: SVGStatProps) => {
  const { mode, profile } = useActivityMode();
  const posters = getPosterComponents(mode).totalStat;
  const GithubSvg = posters[posterPath(mode, 'github.svg')];
  const GridSvg = posters[posterPath(mode, 'grid.svg')];
  const [openPoster, setOpenPoster] = useState<'calendar' | 'routes' | null>(
    null
  );
  const closePoster = useCallback(() => setOpenPoster(null), []);
  const routeRuns = useMemo(
    () =>
      runs.filter(
        (run) =>
          Boolean(run.summary_polyline) &&
          run.distance >= profile.poster.gridMinimumDistanceKm * 1000
      ),
    [profile.poster.gridMinimumDistanceKm, runs]
  );
  const activityLabel = profile.copy.chineseVerb;
  const calendarTitle = `全部年份${activityLabel}日历海报`;
  const routesTitle = `长距离${activityLabel}路线海报`;

  return (
    <div id="svgStat" className={styles.container} data-activity-mode={mode}>
      <Suspense fallback={<div className="text-center">Loading...</div>}>
        {GithubSvg && (
          <section className={styles.posterSection} aria-label={calendarTitle}>
            <button
              type="button"
              className={styles.posterButton}
              aria-haspopup="dialog"
              aria-expanded={openPoster === 'calendar'}
              onClick={() => setOpenPoster('calendar')}
            >
              放大查看{calendarTitle}
            </button>
            <GithubSvg
              className="github-svg mt-4 h-auto w-full"
              role="img"
              aria-label={calendarTitle}
              focusable="false"
            />
          </section>
        )}
        {GridSvg && (
          <section className={styles.posterSection} aria-label={routesTitle}>
            <button
              type="button"
              className={styles.posterButton}
              aria-haspopup="dialog"
              aria-expanded={openPoster === 'routes'}
              onClick={() => setOpenPoster('routes')}
            >
              放大查看{routesTitle}
            </button>
            <div className={styles.routePicker}>
              <label htmlFor="total-poster-route-select">
                使用列表选择一条路线
              </label>
              <select
                id="total-poster-route-select"
                className={styles.routeSelect}
                defaultValue=""
                onChange={(event) => {
                  const runId = event.currentTarget.value;
                  locateActivity(
                    runId ? [runId] : runs.map((run) => run.run_id)
                  );
                }}
              >
                <option value="">查看全部路线</option>
                {routeRuns.map((run) => (
                  <option key={run.run_id} value={run.run_id}>
                    {run.start_date_local.slice(0, 10)} · {run.name} ·{' '}
                    {(run.distance / M_TO_DIST).toFixed(1)} {DIST_UNIT}
                  </option>
                ))}
              </select>
            </div>
            <GridSvg
              className="grid-svg mt-4 h-auto w-full"
              role="img"
              aria-label={`${routesTitle}；可点击路线，也可以使用上方列表选择`}
              focusable="false"
            />
          </section>
        )}
      </Suspense>
      {openPoster && (
        <TotalPosterDialog
          title={openPoster === 'calendar' ? calendarTitle : routesTitle}
          onClose={closePoster}
        >
          <Suspense fallback={<div className={styles.loading}>Loading...</div>}>
            {openPoster === 'calendar' && GithubSvg && (
              <GithubSvg
                className={`github-svg ${styles.dialogSvg}`}
                role="img"
                aria-label={calendarTitle}
                focusable="false"
              />
            )}
            {openPoster === 'routes' && GridSvg && (
              <GridSvg
                className={`grid-svg ${styles.dialogSvg}`}
                role="img"
                aria-label={routesTitle}
                focusable="false"
              />
            )}
          </Suspense>
        </TotalPosterDialog>
      )}
    </div>
  );
};

export default SVGStat;
