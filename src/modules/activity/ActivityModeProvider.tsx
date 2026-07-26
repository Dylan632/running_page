import {
  createContext,
  use,
  useEffect,
  useMemo,
  type PropsWithChildren,
} from 'react';
import { useLocation, useParams } from 'react-router-dom';
import {
  getActivityProfile,
  isActivityMode,
  type ActivityMode,
  type ActivityProfile,
} from './profiles';

interface ActivityModeContextValue {
  mode: ActivityMode;
  profile: ActivityProfile;
  hrefForMode: (mode: ActivityMode) => string;
}

const ActivityModeContext = createContext<ActivityModeContextValue | null>(
  null
);

export const ActivityModeProvider = ({ children }: PropsWithChildren) => {
  const params = useParams<{ activityMode?: string }>();
  const location = useLocation();
  const mode = isActivityMode(params.activityMode)
    ? params.activityMode
    : 'running';
  const profile = getActivityProfile(mode);

  const value = useMemo<ActivityModeContextValue>(() => {
    const hrefForMode = (targetMode: ActivityMode) => {
      const segments = location.pathname.split('/').filter(Boolean);
      if (segments.length && isActivityMode(segments[0])) {
        segments[0] = targetMode;
      } else {
        segments.unshift(targetMode);
      }
      return `/${segments.join('/')}${location.search}${location.hash}`;
    };

    return { mode, profile, hrefForMode };
  }, [location.hash, location.pathname, location.search, mode, profile]);

  useEffect(() => {
    document.documentElement.dataset.activityMode = mode;
  }, [mode]);

  return <ActivityModeContext value={value}>{children}</ActivityModeContext>;
};

export const useActivityMode = (): ActivityModeContextValue => {
  const value = use(ActivityModeContext);
  if (!value) {
    throw new Error('useActivityMode must be used inside ActivityModeProvider');
  }
  return value;
};
