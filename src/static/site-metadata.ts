interface ISiteMetadataResult {
  siteTitle: string;
  siteUrl: string;
  description: string;
  logo: string;
  navLinks: {
    name: string;
    url: string;
  }[];
}

const data: ISiteMetadataResult = {
  siteTitle: '我的跑步日志',
  siteUrl: 'https://dylan632.github.io/running_page/',
  logo: 'https://github.com/Dylan632/running_page/blob/master/logo.jpeg',
  description: 'Personal site',
  navLinks: [
    {
      name: 'Blog',
      url: 'https://github.com/Dylan632',
    },
    {
      name: 'About',
      url: 'https://github.com/Dylan632/running_page',
    },
  ],
};

export default data;
