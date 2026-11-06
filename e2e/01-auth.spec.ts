import { expect, test } from '@playwright/test';
import { login, logout, USERS } from './helpers';

const EXPECTED_NAV: Record<string, string[]> = {
  [USERS.patient1]: ['nav-bookings', 'nav-search', 'nav-history'],
  [USERS.gomez]: ['nav-agenda', 'nav-history'],
  [USERS.staff]: ['nav-agenda', 'nav-search'],
  [USERS.admin]: ['nav-admin', 'nav-audit'],
};

const ALL_NAV = [
  'nav-bookings',
  'nav-search',
  'nav-agenda',
  'nav-history',
  'nav-admin',
  'nav-audit',
];

test.describe('SCR-01 login and role navigation', () => {
  for (const [email, expected] of Object.entries(EXPECTED_NAV)) {
    test(`signs in as ${email} and shows exactly its navigation`, async ({
      page,
    }) => {
      await login(page, email);
      for (const testId of ALL_NAV) {
        const locator = page.getByTestId(testId);
        if (expected.includes(testId)) {
          await expect(locator).toBeVisible();
        } else {
          await expect(locator).toHaveCount(0);
        }
      }
      await logout(page);
    });
  }

  test('rejects invalid credentials', async ({ page }) => {
    await page.goto('/login');
    await page.getByTestId('login-email').fill(USERS.patient1);
    await page.getByTestId('login-password').fill('wrong-password');
    await page.getByTestId('login-submit').click();
    await expect(page.getByTestId('error-banner')).toBeVisible();
    await expect(page.getByTestId('login-email')).toBeVisible();
  });

  test('redirects unauthenticated access to SCR-01', async ({ page }) => {
    await page.goto('/bookings');
    await expect(page.getByTestId('login-email')).toBeVisible();
    await page.goto('/admin');
    await expect(page.getByTestId('login-email')).toBeVisible();
    await page.goto('/audit');
    await expect(page.getByTestId('login-email')).toBeVisible();
  });
});
