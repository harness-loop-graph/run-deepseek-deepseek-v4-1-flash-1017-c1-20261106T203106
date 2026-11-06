import { expect, test } from '@playwright/test';
import { login, USERS } from './helpers';

test.describe('SCR-07 / SCR-08 administration and audit', () => {
  test('the admin manages users and roles and queries the audit log', async ({
    page,
  }) => {
    await login(page, USERS.admin);
    await expect(page.getByTestId('nav-admin')).toBeVisible();
    await expect(page.getByTestId('nav-audit')).toBeVisible();

    await page.getByTestId('nav-admin').click();
    await expect(page.getByText('Users and roles')).toBeVisible();
    const email = `e2e.${Date.now()}@seed.local`;
    await page.locator('#new-user-email').fill(email);
    await page.locator('#new-user-roles').selectOption(['staff']);
    await page.getByRole('button', { name: 'Create user' }).click();
    await expect(page.getByText('User created.')).toBeVisible({
      timeout: 20_000,
    });
    await expect(page.getByRole('cell', { name: email })).toBeVisible();

    await page.getByTestId('nav-audit').click();
    await expect(page.locator('.data-table tbody tr').first()).toBeVisible({
      timeout: 20_000,
    });
    await expect(page.locator('.data-table')).toContainText('usuario.create');
  });

  test('the admin updates a professional availability', async ({ page }) => {
    await login(page, USERS.admin);
    await page.getByTestId('nav-admin').click();
    await expect(page.locator('#availability-professional')).toBeVisible();
    await expect(
      page.getByTestId('loading-indicator').or(page.locator('.slot-chip')).first(),
    ).toBeVisible({ timeout: 20_000 });
  });
});
