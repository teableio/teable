import { test, expect } from '@playwright/test';
import commonJsonZh from '@teable/common-i18n/locales/zh/common.json';

const notFoundTitleZh = commonJsonZh.system.notFound.title;

test.describe('404 not found page (zh)', () => {
  test('follows the NEXT_LOCALE cookie', async ({ page, context, baseURL }) => {
    await context.addCookies([
      { name: 'NEXT_LOCALE', value: 'zh', url: baseURL ?? 'http://127.0.0.1:3000' },
    ]);
    await page.goto('/404');
    // The page is statically generated in english and re-localizes on the
    // client from the cookie, so both assertions are polling.
    await expect(page.getByTestId('not-found-title')).toHaveText(notFoundTitleZh);
    await expect(page).toHaveTitle(notFoundTitleZh);
  });
});
