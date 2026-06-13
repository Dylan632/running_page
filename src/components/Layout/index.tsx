import React from 'react';
import { Helmet } from 'react-helmet-async';
import Header from '@/components/Header';
import getSiteMetadata from '@/hooks/useSiteMetadata';

const Layout = ({ children }: React.PropsWithChildren) => {
  const { siteTitle, description } = getSiteMetadata();

  return (
    <>
      <Helmet>
        <html lang="en" />
        <title>{siteTitle}</title>
        <meta name="description" content={description} />
        <meta name="keywords" content="running" />
        <meta
          name="viewport"
          content="width=device-width, initial-scale=1, shrink-to-fit=no"
        />
      </Helmet>
      <Header />
      <main className="kami-shell mx-auto mb-16 max-w-screen-2xl p-5 lg:flex lg:gap-8 lg:p-10 xl:p-12">
        {children}
      </main>
    </>
  );
};

export default Layout;
