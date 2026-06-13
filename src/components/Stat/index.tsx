import { intComma } from '@/utils/utils';

interface IStatProperties {
  value: string | number;
  description: string;
  className?: string;
  citySize?: number;
  onClick?: () => void;
}

const formatDescription = (description: string) => {
  return description.trim().toLowerCase() === 'km' ? ' KM' : description;
};

const Stat = ({
  value,
  description,
  className = 'pb-2 w-full',
  citySize,
  onClick,
}: IStatProperties) => (
  <div className={`kami-stat running-stat ${className}`} onClick={onClick}>
    <span
      className={
        citySize
          ? `kami-stat-value running-stat-number text-${citySize}xl`
          : 'kami-stat-value running-stat-number'
      }
    >
      {intComma(value.toString())}
    </span>
    <span className="kami-stat-desc running-stat-label">
      {formatDescription(description)}
    </span>
  </div>
);

export default Stat;
