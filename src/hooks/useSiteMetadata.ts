import { useMemo } from 'react';
import { useActivityMode } from '@/modules/activity/ActivityModeProvider';
import { createSiteMetadata } from '@/static/site-metadata';

const useSiteMetadata = () => {
  const { profile } = useActivityMode();
  return useMemo(() => createSiteMetadata(profile), [profile]);
};

export default useSiteMetadata;
