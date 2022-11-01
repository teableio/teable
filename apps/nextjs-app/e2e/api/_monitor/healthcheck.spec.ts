import { test, expect } from '@playwright/test';
import { isIsoDateString } from '@teable-group/ts-utils';
import type { HealthCheckApiPayload } from '@/pages/api/_monitor/healthcheck';
import packageJson from '../../../package.json';

test('should return a success payload', async ({ request }) => {
  const resp = await request.get('/api/_monitor/healthcheck');
  const headers = resp.headers();
  const json = (await resp.json()) as HealthCheckApiPayload;
  const { timestamp, ...restJson } = json;
  expect(headers['content-type']).toEqual('application/json');
  expect(isIsoDateString(timestamp)).toBeTruthy();
  expect(restJson).toMatchObject({
    status: 'ok',
    message: 'Health check successful for API route',
    appName: packageJson.name,
    appVersion: packageJson.version,
  });
});
