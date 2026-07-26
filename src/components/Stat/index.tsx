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
}: IStatProperties) => {
  const content = (
    <>
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
    </>
  );

  if (onClick) {
    return (
      <button
        type="button"
        className={`kami-stat kami-stat-actionable running-stat ${className}`}
        onClick={onClick}
      >
        {content}
      </button>
    );
  }

  return <div className={`kami-stat running-stat ${className}`}>{content}</div>;
};

export default Stat;
