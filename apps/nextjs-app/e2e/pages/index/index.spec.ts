import { test, expect } from '@playwright/test';
import authJsonEn from '@teable/common-i18n/locales/en/auth.json';

test.describe('root route', () => {
  test('sends first-time visitors from / to sign-up, remembering /space', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveURL(/\/auth\/signup\?redirect=%2Fspace$/);
    await expect(page).toHaveTitle(authJsonEn.page.signup);
  });

  test('sends returning browsers from / to sign-in', async ({ page, context, baseURL }) => {
    await context.addCookies([
      { name: 'teable_returning', value: '1', url: baseURL ?? 'http://127.0.0.1:3000' },
    ]);
    await page.goto('/');
    await expect(page).toHaveURL(/\/auth\/login\?redirect=%2Fspace$/);
    await expect(page).toHaveTitle(authJsonEn.page.signin);
  });
});
