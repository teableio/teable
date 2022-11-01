import { test, expect } from '@playwright/test';

test('should return a status of 500', async ({ request }) => {
  const resp = await request.get('/api/_monitor/sentry');
  const status = resp.status();
  expect(status).toEqual(500);
});
