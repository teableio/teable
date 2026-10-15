import { test, expect } from '@playwright/test';
import authJsonEn from '@teable/common-i18n/locales/en/auth.json';

// Credentials for the seeded sign-in account. The defaults match the `--e2e`
// database seed (packages/db-main-prisma/prisma/seed.ts); override them with
// E2E_USER_EMAIL / E2E_USER_PASSWORD when pointing at another environment.
const email = process.env.E2E_USER_EMAIL ?? 'test@e2e.com';
const password = process.env.E2E_USER_PASSWORD ?? '12345678';

test.describe('sign-in', () => {
  test('rejects wrong credentials with the localized error', async ({ page }) => {
    await page.goto('/auth/login');
    await expect(page).toHaveTitle(authJsonEn.page.signin);

    // A unique address per run: the backend locks an email out after a few
    // wrong passwords, and a fixed one would trip that across CI runs.
    await page.locator('#email').fill(`nobody+${Date.now()}@e2e.invalid`);
    await page.locator('#password').fill('wrong-password');
    await page.getByRole('button', { name: authJsonEn.button.signin, exact: true }).click();

    await expect(page.locator('div[data-state="show"]')).toHaveText(authJsonEn.signError.incorrect);
  });

  test('signs in the seeded user and reaches their space', async ({ page }) => {
    // On a cold dev server the /space routes compile on first use; give this
    // end-to-end path room beyond the suite default.
    test.setTimeout(150_000);

    await page.goto('/auth/login');
    await page.locator('#email').fill(email);
    await page.locator('#password').fill(password);
    await page.getByRole('button', { name: authJsonEn.button.signin, exact: true }).click();

    await page.waitForURL(/\/space([/?#]|$)/, { timeout: 90_000 });

    // Deterministic fixtures from the `--e2e` seed: space "test space" hosting
    // base "test base" (packages/db-main-prisma/src/seeds/e2e/space-seeds.ts).
    await page.goto('/space/spcTestSpaceId');
    await expect(page).toHaveTitle('test space', { timeout: 60_000 });
    await expect(page.getByText('test base').first()).toBeVisible({ timeout: 60_000 });
  });
});
