import { useMemo } from 'react';
import YearStat from '@/components/YearStat';
import useActivities from '@/hooks/useActivities';
import { INFO_MESSAGE } from '@/utils/const';
import { useActivityMode } from '@/modules/activity/ActivityModeProvider';
import './style.css';

const YearsStat = ({
  year,
  onClick,
}: {
  year: string;
  onClick: (_year: string) => void;
}) => {
  const { mode } = useActivityMode();
  const { years } = useActivities();

  // Memoize the years array calculation
  const yearsArrayUpdate = useMemo(() => {
    // make sure the year click on front
    let updatedYears = years.slice();
    updatedYears.push('Total');
    updatedYears = updatedYears.filter((x) => x !== year);
    updatedYears.unshift(year);
    return updatedYears;
  }, [years, year]);

  const infoMessage = useMemo(() => {
    return INFO_MESSAGE(years.length, year, mode);
  }, [mode, years.length, year]);

  return (
    <div className="running-sidebar kami-sidebar w-full pb-16 lg:w-full">
      <section className="pb-0">
        <p
          className="kami-sidebar-intro running-sidebar-hero"
          role="status"
          aria-live="polite"
          aria-atomic="true"
        >
          {infoMessage}
          <br />
        </p>
      </section>
      <hr className="kami-sidebar-rule running-sidebar-rule" />
      {yearsArrayUpdate.map((yearItem) => (
        <YearStat
          key={yearItem}
          year={yearItem}
          onClick={onClick}
          selected={yearItem === year}
        />
      ))}
    </div>
  );
};

export default YearsStat;
