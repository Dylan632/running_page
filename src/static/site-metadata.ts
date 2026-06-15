import { ACTIVITY_MODE } from '@/utils/activityMode';

interface ISiteMetadataResult {
  siteTitle: string;
  siteUrl: string;
  activitySwitchUrl: string;
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
  activitySwitchUrl:
    ACTIVITY_MODE === 'cycling' ? RUNNING_SITE_URL : CYCLING_SITE_URL,
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
