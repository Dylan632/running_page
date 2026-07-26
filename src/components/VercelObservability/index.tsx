import { Analytics } from '@vercel/analytics/react';
import { SpeedInsights } from '@vercel/speed-insights/react';

const VercelObservability = () => (
  <>
    <Analytics />
    <SpeedInsights />
  </>
);

export default VercelObservability;
