import useActivities from '@/hooks/useActivities';
import styles from './style.module.css';

const RunMapButtons = ({
  changeYear,
  thisYear,
}: {
  changeYear: (_year: string) => void;
  thisYear: string;
}) => {
  const { years } = useActivities();
  const yearsButtons = years.slice();
  yearsButtons.push('Total');

  return (
    <ul className={styles.buttons} aria-label="地图年份筛选">
      {yearsButtons.map((year) => (
        <li key={`${year}button`}>
          <button
            type="button"
            className={
              styles.button + ` ${year === thisYear ? styles.selected : ''}`
            }
            aria-label={`在地图上显示${year === 'Total' ? '全部年份' : `${year} 年`}活动`}
            aria-pressed={year === thisYear}
            onClick={() => {
              changeYear(year);
            }}
          >
            {year}
          </button>
        </li>
      ))}
    </ul>
  );
};

export default RunMapButtons;
