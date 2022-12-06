import type { NextApiRequest, NextApiResponse } from 'next';

export type IHealthCheckApiPayload = {
  status: 'ok' | 'error';
  message: string;
  appName: string;
  appVersion: string;
  timestamp: string;
};

export default async function healthCheckApiRoute(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    res.status(400).end();
    return;
  }

  res.setHeader('Content-Type', 'application/json');

  const payload: IHealthCheckApiPayload = {
    status: 'ok',
    message: 'Health check successful for API route',
    appName: process.env.APP_NAME ?? 'unknown',
    appVersion: process.env.APP_VERSION ?? 'unknown',
    timestamp: new Date().toISOString(),
  };

  res.status(200).send(JSON.stringify(payload, undefined, 2));
  res.end();
}
