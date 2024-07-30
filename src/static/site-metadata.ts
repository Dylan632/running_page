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
  logo: 'https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcQTtc69JxHNcmN1ETpMUX4dozAgAN6iPjWalQ&usqp=CAU',
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
