import ActivityList from '@/components/ActivityList';
import Layout from '@/components/Layout';
import { Helmet } from 'react-helmet-async';
import { useTheme } from '@/hooks/useTheme';

const HomePage = () => {
  const { theme } = useTheme();

  return (
    <Layout>
      <Helmet>
        <html lang="zh-CN" data-theme={theme} />
      </Helmet>
      <ActivityList />
    </Layout>
  );
};

export default HomePage;
