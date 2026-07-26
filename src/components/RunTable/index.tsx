import React, { useState, useMemo, useCallback } from 'react';
import {
  sortDateFunc,
  sortDateFuncReverse,
  convertMovingTime2Sec,
  Activity,
  RunIds,
} from '@/utils/utils';
import { SHOW_ELEVATION_GAIN } from '@/utils/const';
import { DIST_UNIT } from '@/utils/utils';
import { useActivityMode } from '@/modules/activity/ActivityModeProvider';

import RunRow from './RunRow';
import styles from './style.module.css';

interface IRunTableProperties {
  runs: Activity[];
  locateActivity: (_runIds: RunIds) => void;
  runIndex: number;
  setRunIndex: (_index: number) => void;
}

type SortFunc = (_a: Activity, _b: Activity) => number;
type SortDirection = 'ascending' | 'descending';

interface SortState {
  direction: SortDirection;
  key: string;
}

const RunTable = ({
  runs,
  locateActivity,
  runIndex,
  setRunIndex,
}: IRunTableProperties) => {
  const { mode, profile } = useActivityMode();
  const speedOrPaceKey = mode === 'cycling' ? `Speed(${DIST_UNIT}/h)` : 'Pace';
  const [sortState, setSortState] = useState<SortState | null>(null);

  const sortKeys = useMemo(() => {
    const keys = [DIST_UNIT, 'Elev', speedOrPaceKey, 'BPM', 'Time', 'Date'];
    return SHOW_ELEVATION_GAIN ? keys : keys.filter((key) => key !== 'Elev');
  }, [speedOrPaceKey]);

  const getSortFunction = useCallback(
    (key: string, direction: SortDirection): SortFunc | undefined => {
      const multiplier = direction === 'ascending' ? 1 : -1;

      if (key === DIST_UNIT) {
        return (a, b) => (a.distance - b.distance) * multiplier;
      }
      if (key === 'Elev') {
        return (a, b) =>
          ((a.elevation_gain ?? 0) - (b.elevation_gain ?? 0)) * multiplier;
      }
      if (key === speedOrPaceKey) {
        return (a, b) => (a.average_speed - b.average_speed) * multiplier;
      }
      if (key === 'BPM') {
        return (a, b) =>
          ((a.average_heartrate ?? 0) - (b.average_heartrate ?? 0)) *
          multiplier;
      }
      if (key === 'Time') {
        return (a, b) =>
          (convertMovingTime2Sec(a.moving_time) -
            convertMovingTime2Sec(b.moving_time)) *
          multiplier;
      }
      if (key === 'Date') {
        return direction === 'ascending' ? sortDateFuncReverse : sortDateFunc;
      }

      return undefined;
    },
    [speedOrPaceKey]
  );

  const displayedRuns = useMemo(() => {
    if (!sortState) return runs;

    const sortFunction = getSortFunction(sortState.key, sortState.direction);
    if (!sortFunction) return runs;

    return runs.slice().sort(sortFunction);
  }, [getSortFunction, runs, sortState]);

  const runIndexById = useMemo(
    () => new Map(runs.map((run, index) => [run.run_id, index])),
    [runs]
  );

  const handleClick = useCallback(
    (key: string) => {
      setRunIndex(-1);
      setSortState((currentState) => {
        const initialDirection = key === 'Date' ? 'ascending' : 'descending';
        const nextDirection =
          currentState?.key === key && currentState.direction === 'descending'
            ? 'ascending'
            : initialDirection;

        return { key, direction: nextDirection };
      });
    },
    [setRunIndex]
  );

  const selectedRun =
    runIndex >= 0 && runIndex < runs.length ? runs[runIndex] : null;
  const statusMessage = [
    sortState
      ? `已按 ${sortState.key} ${sortState.direction === 'ascending' ? '升序' : '降序'}排列`
      : '',
    selectedRun ? `已在地图上定位 ${selectedRun.start_date_local}` : '',
  ]
    .filter(Boolean)
    .join('；');

  return (
    <div className={styles.tableContainer}>
      <table className={styles.runTable} cellSpacing="0" cellPadding="0">
        <caption className={styles.visuallyHidden}>
          活动记录，可使用列标题按钮排序，并使用活动名称按钮在地图上定位
        </caption>
        <thead>
          <tr>
            <th scope="col">活动</th>
            {sortKeys.map((k) => (
              <th
                key={k}
                aria-sort={
                  sortState?.key === k ? sortState.direction : undefined
                }
                className={styles.sortableHeader}
                scope="col"
              >
                <button
                  type="button"
                  className={styles.sortButton}
                  aria-label={`按 ${k} 排序`}
                  onClick={() => handleClick(k)}
                >
                  <span>{k}</span>
                  {sortState?.key === k && (
                    <span aria-hidden="true">
                      {sortState.direction === 'ascending' ? ' ↑' : ' ↓'}
                    </span>
                  )}
                </button>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {displayedRuns.length === 0 ? (
            <tr>
              <td colSpan={sortKeys.length + 1} data-empty-state role="status">
                暂无{profile.label}记录
              </td>
            </tr>
          ) : (
            displayedRuns.map((run) => {
              const sourceIndex = runIndexById.get(run.run_id) ?? -1;
              return (
                <RunRow
                  key={run.run_id}
                  elementIndex={sourceIndex}
                  locateActivity={locateActivity}
                  run={run}
                  runIndex={runIndex}
                  setRunIndex={setRunIndex}
                />
              );
            })
          )}
        </tbody>
      </table>
      <p
        className={styles.visuallyHidden}
        role="status"
        aria-live="polite"
        aria-atomic="true"
      >
        {statusMessage}
      </p>
    </div>
  );
};

export default RunTable;
