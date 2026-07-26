import { useState } from 'react';
import YearSummaryModal from '@/components/YearSummaryModal';
import styles from './style.module.css';

interface YearPosterLauncherProps {
  year: string;
}

const YearPosterLauncher = ({ year }: YearPosterLauncherProps) => {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        className={styles.posterButton}
        aria-haspopup="dialog"
        onClick={() => setIsOpen(true)}
      >
        查看 {year} 年运动总结大图
      </button>
      {isOpen && (
        <YearSummaryModal year={year} onClose={() => setIsOpen(false)} />
      )}
    </>
  );
};

export default YearPosterLauncher;
