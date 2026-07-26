import {
  ACTIVITY_MODES,
  type ActivityProfile,
} from '@/modules/activity/profiles';

interface ISiteMetadataResult {
  siteTitle: string;
  siteUrl: string;
  canonicalUrl: string;
  activityLinks: {
    mode: ActivityProfile['mode'];
    name: string;
  }[];
  profileUrl: string;
  description: string;
  logo: string;
  navLinks: {
    name: string;
    url: string;
  }[];
}

const PROFILE_URL = 'https://github.com/Dylan632';
export const CANONICAL_ORIGIN = 'https://running-page-zeta-lake.vercel.app';

export const createSiteMetadata = (
  profile: ActivityProfile
): ISiteMetadataResult => ({
  siteTitle: profile.siteTitle,
  siteUrl: profile.route,
  canonicalUrl: `${CANONICAL_ORIGIN}${profile.route}`,
  activityLinks: ACTIVITY_MODES.map((activity) => ({
    mode: activity.mode,
    name: activity.label,
  })),
  profileUrl: PROFILE_URL,
  logo: 'https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcQTtc69JxHNcmN1ETpMUX4dozAgAN6iPjWalQ&usqp=CAU',
  description: profile.description,
  navLinks: [
    {
      name: 'Github',
      url: PROFILE_URL,
    },
    {
      name: 'About',
      url: 'https://github.com/yihong0618/running_page',
    },
  ],
});
