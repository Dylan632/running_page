import { ACTIVITY_MODE, type ActivityMode } from '@/utils/activityMode';

interface ISiteMetadataResult {
  siteTitle: string;
  siteUrl: string;
  activityLinks: {
    mode: ActivityMode;
    name: string;
    url: string;
  }[];
  profileUrl: string;
  description: string;
  logo: string;
  navLinks: {
    name: string;
    url: string;
  }[];
}

const CYCLING_SITE_URL = 'https://dylan632.github.io/cycling_page/';
const RUNNING_SITE_URL = 'https://running-page-zeta-lake.vercel.app/';
const PROFILE_URL = 'https://github.com/Dylan632';

const data: ISiteMetadataResult = {
  siteTitle: ACTIVITY_MODE === 'cycling' ? 'Cycling Page' : 'Running Page',
  siteUrl: ACTIVITY_MODE === 'cycling' ? CYCLING_SITE_URL : RUNNING_SITE_URL,
  activityLinks: [
    {
      mode: 'running',
      name: '跑步',
      url: RUNNING_SITE_URL,
    },
    {
      mode: 'cycling',
      name: '骑行',
      url: CYCLING_SITE_URL,
    },
  ],
  profileUrl: PROFILE_URL,
  logo: 'https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcQTtc69JxHNcmN1ETpMUX4dozAgAN6iPjWalQ&usqp=CAU',
  description:
    ACTIVITY_MODE === 'cycling'
      ? 'Personal cycling records'
      : 'Personal running records',
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
};

export default data;
