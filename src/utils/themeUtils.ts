export type Theme = 'light' | 'dark';

export const THEME_STORAGE_KEY = 'theme';
export const THEME_PREFERENCE_STORAGE_KEY = 'theme-preference';

const SHANGHAI_TIME_ZONE = 'Asia/Shanghai';
const DAY_START_HOUR = 6;
const NIGHT_START_HOUR = 18;

const isTheme = (value: string | null): value is Theme =>
  value === 'light' || value === 'dark';

export const getAsiaShanghaiHour = (date = new Date()): number => {
  try {
    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone: SHANGHAI_TIME_ZONE,
      hour: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(date);
    const hour = Number(parts.find((part) => part.type === 'hour')?.value);
    if (Number.isFinite(hour)) return hour;
  } catch {
    // Fall through to a UTC based calculation for older runtimes.
  }

  return (date.getUTCHours() + 8) % 24;
};

export const getAsiaShanghaiTheme = (date = new Date()): Theme => {
  const hour = getAsiaShanghaiHour(date);
  return hour >= DAY_START_HOUR && hour < NIGHT_START_HOUR ? 'light' : 'dark';
};

export const getEffectiveTheme = (): Theme => {
  if (typeof window === 'undefined') return getAsiaShanghaiTheme();

  const dataTheme = document.documentElement.getAttribute('data-theme');
  if (isTheme(dataTheme)) return dataTheme;

  return getAsiaShanghaiTheme();
};

export const persistManualTheme = (_theme: Theme): void => {
  if (typeof window === 'undefined') return;
  localStorage.removeItem(THEME_PREFERENCE_STORAGE_KEY);
  localStorage.removeItem(THEME_STORAGE_KEY);
};

export const syncThemeStorage = (_theme: Theme): void => {
  if (typeof window === 'undefined') return;
  localStorage.removeItem(THEME_PREFERENCE_STORAGE_KEY);
  localStorage.removeItem(THEME_STORAGE_KEY);
};
