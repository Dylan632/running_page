import { Suspense, useEffect, useId, useRef } from 'react';
import { getPosterComponents } from '@assets/index';
import { useActivityMode } from '@/modules/activity/ActivityModeProvider';
import styles from './style.module.css';

interface YearSummaryModalProps {
  year: string;
  onClose: () => void;
}

const YearSummaryModal = ({ year, onClose }: YearSummaryModalProps) => {
  const { mode } = useActivityMode();
  const summaryPosters = getPosterComponents(mode).yearSummaryStats;
  const summaryPath = `./${mode}/year_summary_${year}.svg`;
  const YearSummarySVG = summaryPosters[summaryPath];
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const previouslyFocusedRef = useRef<HTMLElement | null>(null);
  const titleId = useId();

  useEffect(() => {
    previouslyFocusedRef.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    closeButtonRef.current?.focus();

    return () => {
      const previouslyFocused = previouslyFocusedRef.current;
      if (previouslyFocused?.isConnected) {
        previouslyFocused.focus();
      }
    };
  }, []);

  useEffect(() => {
    const handleDialogKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        onClose();
        return;
      }

      if (e.key !== 'Tab') return;

      const dialog = dialogRef.current;
      if (!dialog) return;

      const focusableElements = Array.from(
        dialog.querySelectorAll<HTMLElement>(
          'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
        )
      );
      if (focusableElements.length === 0) {
        e.preventDefault();
        dialog.focus();
        return;
      }

      const firstFocusable = focusableElements[0];
      const lastFocusable = focusableElements[focusableElements.length - 1];
      const activeElement = document.activeElement;
      if (
        e.shiftKey &&
        (activeElement === firstFocusable || !dialog.contains(activeElement))
      ) {
        e.preventDefault();
        lastFocusable.focus();
      } else if (
        !e.shiftKey &&
        (activeElement === lastFocusable || !dialog.contains(activeElement))
      ) {
        e.preventDefault();
        firstFocusable.focus();
      }
    };

    document.addEventListener('keydown', handleDialogKeyDown);
    return () => document.removeEventListener('keydown', handleDialogKeyDown);
  }, [onClose]);

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, []);

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div
        ref={dialogRef}
        className={styles.modal}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id={titleId} className={styles.visuallyHidden}>
          {year} 年运动总结
        </h2>
        <button
          ref={closeButtonRef}
          type="button"
          className={styles.closeButton}
          aria-label={`关闭 ${year} 年运动总结`}
          onClick={onClose}
        >
          ×
        </button>
        {YearSummarySVG && (
          <Suspense fallback={<div className={styles.loading}>Loading...</div>}>
            <YearSummarySVG className={styles.svg} />
          </Suspense>
        )}
      </div>
    </div>
  );
};

export default YearSummaryModal;
