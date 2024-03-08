import { wrapApiHandlerWithSentry } from '@sentry/nextjs';
import type { NextApiRequest, NextApiResponse } from 'next';

// eslint-disable-next-line @typescript-eslint/require-await
async function sentryMonitorApiRoute(_req: NextApiRequest, _res: NextApiResponse): Promise<never> {
  throw new Error('Error purposely crafted for monitoring sentry (/pages/api/_monitor/sentry.tsx)');
}
export default wrapApiHandlerWithSentry(sentryMonitorApiRoute, '/api/_monitor/sentry');
