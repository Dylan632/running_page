import type { ActivityMode } from '@/modules/activity/profiles';

export type DashboardLocale = 'zh' | 'en';

interface ActivityPresentation {
  icon: string;
  labelZh: string;
  labelEn: string;
  primaryColor: string;
  highlightColor: string;
  longDistanceKm: number;
  performanceKind: 'pace' | 'speed';
}

const PRESENTATIONS: Record<ActivityMode, ActivityPresentation> = {
  running: {
    icon: '🏃',
    labelZh: '跑步',
    labelEn: 'Run',
    primaryColor: '#f97316',
    highlightColor: '#ef4444',
    longDistanceKm: 20,
    performanceKind: 'pace',
  },
};

const formatPace = (speedMs: number): string => {
  if (!Number.isFinite(speedMs) || speedMs <= 0) return '--';
  const totalSeconds = Math.round(1000 / speedMs);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
};

export const getActivityPresentation = (
  mode: ActivityMode
): ActivityPresentation => PRESENTATIONS[mode];

export const formatActivityPerformance = (
  speedMs: number,
  mode: ActivityMode,
  locale: DashboardLocale
) => {
  const presentation = getActivityPresentation(mode);
  const isPace = presentation.performanceKind === 'pace';
  const value =
    Number.isFinite(speedMs) && speedMs > 0
      ? isPace
        ? formatPace(speedMs)
        : (speedMs * 3.6).toFixed(1)
      : '--';
  const unit = isPace ? '/km' : 'km/h';

  return {
    label: isPace
      ? locale === 'zh'
        ? '配速'
        : 'Pace'
      : locale === 'zh'
        ? '速度'
        : 'Speed',
    averageLabel: isPace
      ? locale === 'zh'
        ? '均配速'
        : 'Avg Pace'
      : locale === 'zh'
        ? '均速'
        : 'Avg Speed',
    bestLabel: isPace
      ? locale === 'zh'
        ? '最快配速'
        : 'Fastest pace'
      : locale === 'zh'
        ? '最高均速'
        : 'Top avg speed',
    value,
    unit,
    display: value === '--' ? value : `${value} ${unit}`,
  };
};

export const getDistanceFilterOptions = (
  _mode: ActivityMode
): readonly number[] => {
  return [10, 20, 40];
};

export const getTrackColor = (
  mode: ActivityMode,
  distanceMeters: number
): string => {
  const presentation = getActivityPresentation(mode);
  return distanceMeters / 1000 >= presentation.longDistanceKm
    ? presentation.highlightColor
    : presentation.primaryColor;
};

export const getActivityTypeLabel = (
  mode: ActivityMode,
  type: string,
  locale: DashboardLocale
): string => {
  const presentation = getActivityPresentation(mode);
  return locale === 'zh' ? presentation.labelZh : presentation.labelEn;
};
