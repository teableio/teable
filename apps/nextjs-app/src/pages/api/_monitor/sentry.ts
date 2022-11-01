import { withSentry } from '@sentry/nextjs';
import type { NextApiRequest, NextApiResponse } from 'next';

async function sentryMonitorApiRoute(
  _req: NextApiRequest,
  _res: NextApiResponse
) {
  throw new Error(
    'Error purposely crafted for monitoring sentry (/pages/api/_monitor/sentry.tsx)'
  );
}
export default withSentry(sentryMonitorApiRoute);
