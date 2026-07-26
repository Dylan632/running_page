import React, { lazy, Suspense } from 'react';
import ReactDOM from 'react-dom/client';
import {
  Navigate,
  Outlet,
  RouterProvider,
  createBrowserRouter,
  useLocation,
  useParams,
} from 'react-router-dom';
import { HelmetProvider } from 'react-helmet-async';
import AppErrorBoundary from '@/components/AppErrorBoundary';
import { ActivityModeProvider } from '@/modules/activity/ActivityModeProvider';
import { isActivityMode } from '@/modules/activity/profiles';
import {
  initializeGoogleAnalytics,
  USE_GOOGLE_ANALYTICS,
} from './utils/analytics';
import '@/styles/index.css';
import { withOptionalGAPageTracking } from './utils/trackRoute';

const Index = lazy(() => import('./pages'));
const HomePage = lazy(() => import('@/pages/total'));
const NotFound = lazy(() => import('./pages/404'));
const VercelObservability = lazy(
  () => import('@/components/VercelObservability')
);

const createRouteElement = (element: React.ReactElement) =>
  withOptionalGAPageTracking(
    <AppErrorBoundary>
      <Suspense
        fallback={
          <div
            className="flex min-h-[50vh] items-center justify-center"
            role="status"
            aria-live="polite"
            aria-busy="true"
          >
            正在加载运动记录…
          </div>
        }
      >
        {element}
      </Suspense>
    </AppErrorBoundary>
  );

const ActivityShell = () => {
  const { activityMode } = useParams();
  const location = useLocation();
  if (!isActivityMode(activityMode)) {
    return (
      <Navigate to={`/running${location.search}${location.hash}`} replace />
    );
  }
  return (
    <ActivityModeProvider>
      <Outlet />
    </ActivityModeProvider>
  );
};

const DefaultActivityRedirect = () => {
  const location = useLocation();
  return <Navigate to={`/running${location.search}${location.hash}`} replace />;
};

if (USE_GOOGLE_ANALYTICS) {
  void initializeGoogleAnalytics();
}

const routes = createBrowserRouter(
  [
    {
      path: '/',
      element: <DefaultActivityRedirect />,
    },
    {
      path: ':activityMode',
      element: <ActivityShell />,
      children: [
        {
          index: true,
          element: createRouteElement(<Index />),
        },
        {
          path: 'summary',
          element: createRouteElement(<HomePage />),
        },
        {
          path: '*',
          element: createRouteElement(<NotFound />),
        },
      ],
    },
    {
      path: '*',
      element: <DefaultActivityRedirect />,
    },
  ],
  { basename: import.meta.env.BASE_URL }
);

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <HelmetProvider>
      <RouterProvider router={routes} />
      {import.meta.env.VERCEL && (
        <Suspense fallback={null}>
          <VercelObservability />
        </Suspense>
      )}
    </HelmetProvider>
  </React.StrictMode>
);
