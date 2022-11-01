import { test, expect } from '@playwright/test';

test.describe('Sentry monitor pages', () => {
  test.describe('Client-side rendered', () => {
    test('should have a title containing error', async ({ page }) => {
      await page.goto('/_monitor/sentry/csr-page');
      await expect(page).toHaveTitle(/error/i);
    });
  });

  test.describe('Server-side rendered', () => {
    test('should have a title containing error', async ({ page }) => {
      await page.goto('/_monitor/sentry/ssr-page');
      await expect(page).toHaveTitle(/error/i);
    });
  });
});
