import React from 'react';
import { Helmet } from 'react-helmet-async';
import Header from '@/components/Header';
import useSiteMetadata from '@/hooks/useSiteMetadata';

const Layout = ({ children }: React.PropsWithChildren) => {
  const { siteTitle, description, canonicalUrl } = useSiteMetadata();

  return (
    <>
      <Helmet>
        <html lang="zh-CN" />
        <title>{siteTitle}</title>
        <meta name="description" content={description} />
        <meta name="keywords" content="跑步,骑行,徒步,运动记录" />
        <link rel="canonical" href={canonicalUrl} />
        <meta property="og:url" content={canonicalUrl} />
        <meta property="og:title" content={siteTitle} />
        <meta property="og:description" content={description} />
        <meta
          name="viewport"
          content="width=device-width, initial-scale=1, shrink-to-fit=no"
        />
      </Helmet>
      <Header />
      <main className="kami-shell mx-auto mb-16 flex max-w-7xl flex-col px-4 py-4 md:px-6 md:py-8 lg:flex-row lg:gap-16 lg:px-16">
        {children}
      </main>
    </>
  );
};

export default Layout;
