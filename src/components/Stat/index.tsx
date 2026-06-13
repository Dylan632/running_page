import { intComma } from '@/utils/utils';

interface IStatProperties {
  value: string | number;
  description: string;
  className?: string;
  citySize?: number;
  onClick?: () => void;
}

const Stat = ({
  value,
  description,
  className = 'pb-2 w-full',
  citySize,
  onClick,
}: IStatProperties) => (
  <div className={`kami-stat ${className}`} onClick={onClick}>
    <span
      className={citySize ? `kami-stat-value text-${citySize}xl` : 'kami-stat-value'}
    >
      {intComma(value.toString())}
    </span>
    <span className="kami-stat-desc">{description}</span>
  </div>
);

export default Stat;
