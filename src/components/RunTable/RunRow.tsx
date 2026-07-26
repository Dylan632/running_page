import {
  formatPace,
  titleForRun,
  formatRunTime,
  Activity,
  RunIds,
} from '@/utils/utils';
import { SHOW_ELEVATION_GAIN } from '@/utils/const';
import { M_TO_DIST, M_TO_ELEV } from '@/utils/utils';
import { useActivityMode } from '@/modules/activity/ActivityModeProvider';
import styles from './style.module.css';

interface IRunRowProperties {
  elementIndex: number;
  locateActivity: (_runIds: RunIds) => void;
  run: Activity;
  runIndex: number;
  setRunIndex: (_ndex: number) => void;
}

const RunRow = ({
  elementIndex,
  locateActivity,
  run,
  runIndex,
  setRunIndex,
}: IRunRowProperties) => {
  const { mode } = useActivityMode();
  const distance = (run.distance / M_TO_DIST).toFixed(2);
  const paceParts = run.average_speed
    ? formatPace(run.average_speed, mode)
    : null;
  const heartRate = run.average_heartrate;
  const runTime = formatRunTime(run.moving_time);
  const runTitle = titleForRun(run);
  const isSelected = runIndex === elementIndex;
  const handleClick = () => {
    if (isSelected) {
      setRunIndex(-1);
      locateActivity([]);
      return;
    }
    setRunIndex(elementIndex);
    locateActivity([run.run_id]);
  };

  return (
    <tr
      className={`${styles.runRow} ${isSelected ? styles.selected : ''}`}
      key={run.start_date_local}
    >
      <td>
        <button
          type="button"
          className={styles.rowAction}
          aria-label={`在地图上${isSelected ? '取消定位' : '定位'} ${runTitle}，${run.start_date_local}`}
          aria-pressed={isSelected}
          onClick={handleClick}
        >
          {runTitle}
        </button>
      </td>
      <td>{distance}</td>
      {SHOW_ELEVATION_GAIN && (
        <td>{((run.elevation_gain ?? 0) * M_TO_ELEV).toFixed(1)}</td>
      )}
      {paceParts && <td>{paceParts}</td>}
      <td>{heartRate && heartRate.toFixed(0)}</td>
      <td>{runTime}</td>
      <td className={styles.runDate}>{run.start_date_local}</td>
    </tr>
  );
};

export default RunRow;
