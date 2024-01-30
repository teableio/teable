import { test, expect } from '@playwright/test';
import systemJsonEn from '@teable/common-i18n/locales/en/system.json';

const pageSlug = 'this-page-does-not-exist';

test.describe('404 not found page', () => {
  test('should have the title in english any way', async ({ page }) => {
    await page.goto(`/${pageSlug}`);
    const title = await page.title();
    expect(title).toBe(systemJsonEn.notFound.title);
  });
});
