import { test, expect } from '@playwright/test';
import homeJsonEn from '@teable-group/common-i18n/locales/en/app.json';

test.describe('Demo page', () => {
  test('should have the title in english by default', async ({ page }) => {
    await page.goto('/');
    const title = await page.title();
    expect(title).toBe(homeJsonEn.page.title);
  });
});
