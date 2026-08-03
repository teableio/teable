import { test, expect } from '@playwright/test';
import commonJsonZh from '@teable/common-i18n/locales/zh/common.json';

test.use({
  locale: 'zh',
});

test.describe('Demo page', () => {
  test('should have the title in english by default', async ({ page }) => {
    await page.goto('/');
    const title = await page.title();
    expect(title).toBe(commonJsonZh.system.notFound.title);
  });
});
