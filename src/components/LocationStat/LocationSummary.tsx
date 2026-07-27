import Stat from '@/components/Stat';
import useActivities from '@/hooks/useActivities';
import { useActivityMode } from '@/modules/activity/ActivityModeProvider';
import type { ActivityMode } from '@/modules/activity/profiles';

const YEARS_DESCRIPTIONS: Record<ActivityMode, string> = {
  running: ' 年里我跑过',
  cycling: ' 年里我骑过',
  hiking: ' 年里我徒步过',
};

// only support China for now
const LocationSummary = () => {
  const { mode } = useActivityMode();
  const { years, countries, provinces, cities } = useActivities();
  const yearsDescription = YEARS_DESCRIPTIONS[mode];

  return (
    <div className="cursor-pointer">
      <section>
        {years ? (
          <Stat value={`${years.length}`} description={yearsDescription} />
        ) : null}
        {countries ? (
          <Stat value={countries.length} description=" 个国家" />
        ) : null}
        {provinces ? (
          <Stat value={provinces.length} description=" 个省份" />
        ) : null}
        {cities ? (
          <Stat value={Object.keys(cities).length} description=" 个城市" />
        ) : null}
      </section>
      <hr />
    </div>
  );
};

export default LocationSummary;
