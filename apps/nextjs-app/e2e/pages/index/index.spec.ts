import { test, expect } from '@playwright/test';
import page404JsonEn from '@teable/common-i18n/locales/en/system.json';

test.describe('404 page', () => {
  test('should have the title in english by default', async ({ page }) => {
    await page.goto('/404');
    const title = await page.title();
    expect(title).toBe(page404JsonEn.notFound.title);
  });
});
