import { test, expect } from '@playwright/test';
import commonJsonEn from '@teable/common-i18n/locales/en/common.json';

const notFoundTitle = commonJsonEn.system.notFound.title;

test.describe('404 not found page', () => {
  test('renders the english title on /404', async ({ page }) => {
    await page.goto('/404');
    await expect(page).toHaveTitle(notFoundTitle);
    await expect(page.getByTestId('not-found-title')).toHaveText(notFoundTitle);
  });

  test('renders the english title on unknown in-app routes', async ({ page }) => {
    // Only top-level paths on the NextController allow-list reach the Next app;
    // a typo inside one of its trees is what an in-app 404 looks like in practice.
    await page.goto('/auth/this-page-does-not-exist');
    await expect(page).toHaveTitle(notFoundTitle);
    await expect(page.getByTestId('not-found-title')).toHaveText(notFoundTitle);
  });
});
