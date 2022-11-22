import { test, expect } from '@playwright/test';
import homeJsonZh from '@teable-group/common-i18n/locales/zh/app.json';

test.use({
  locale: 'zh',
});

test.describe('Demo page', () => {
  test('should have the title in english by default', async ({ page }) => {
    await page.goto('/');
    const title = await page.title();
    expect(title).toBe(homeJsonZh.page.title);
  });
});
