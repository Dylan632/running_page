import { ACTIVITY_MODE } from '@/utils/activityMode';

interface ISiteMetadataResult {
  siteTitle: string;
  siteUrl: string;
  description: string;
  logo: string;
  navLinks: {
    name: string;
    url: string;
  }[]
}

const CYCLING_SITE_URL = 'https://dylan632.github.io/running_page/';
const RUNNING_SITE_URL =
  'https://running-page-git-master-dylans-projects-7285da27.vercel.app/';

const data: ISiteMetadataResult = {
  siteTitle: 'Dylan',
  siteUrl: ACTIVITY_MODE === 'cycling' ? RUNNING_SITE_URL : CYCLING_SITE_URL,
  logo: 'https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcQTtc69JxHNcmN1ETpMUX4dozAgAN6iPjWalQ&usqp=CAU',
  description:
    ACTIVITY_MODE === 'cycling'
      ? 'Personal cycling records'
      : 'Personal running records',
  navLinks: [
    {
      name: 'Github',
      url: 'https://github.com/Dylan632',
    },
    {
      name: 'About',
      url: 'https://github.com/yihong0618/running_page',
    },
  ],
};

export default data;
