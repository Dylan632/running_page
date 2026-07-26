import YearStat from '@/components/YearStat';
import { getChineseLocationInfoMessages } from '@/utils/const';
import { useActivityMode } from '@/modules/activity/ActivityModeProvider';
import CitiesStat from './CitiesStat';
import LocationSummary from './LocationSummary';
import PeriodStat from './PeriodStat';

interface ILocationStatProps {
  changeYear: (_year: string) => void;
  changeCity: (_city: string) => void;
  changeTitle: (_title: string) => void;
}

const LocationStat = ({
  changeYear,
  changeCity,
  changeTitle,
}: ILocationStatProps) => {
  const { mode } = useActivityMode();
  const [firstMessage, secondMessage] = getChineseLocationInfoMessages(mode);

  return (
    <div className="w-full pb-16 lg:w-full lg:pr-16">
      <section className="pb-0">
        <p className="leading-relaxed">
          {firstMessage}.
          <br />
          {secondMessage}.
          <br />
          <br />
          Yesterday you said tomorrow.
        </p>
      </section>
      <hr />
      <LocationSummary />
      <CitiesStat onClick={changeCity} />
      <PeriodStat onClick={changeTitle} />
      <YearStat year="Total" onClick={changeYear} />
    </div>
  );
};

export default LocationStat;
