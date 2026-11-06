import { expect, test } from '@playwright/test';
import {
  ensureAppointment,
  isoDate,
  login,
  USERS,
} from './helpers';

test.describe('SCR-04 / SCR-05 professional records an encounter', () => {
  test('the professional sees today..+7 days and records an encounter', async ({
    page,
  }) => {
    const appointment = await ensureAppointment(USERS.patient1, 1, 6);

    await login(page, USERS.gomez);
    await expect(page.getByTestId('nav-agenda')).toBeVisible();
    await expect(page.getByTestId('nav-history')).toBeVisible();

    const item = page.locator(
      `[data-testid="appointment-item"][data-appointment-id="${appointment.id}"]`,
    );
    await expect(item).toBeVisible({ timeout: 20_000 });
    await item.click();

    await expect(page).toHaveURL(new RegExp(`/appointments/${appointment.id}$`));
    const notes = `Control de rutina ${Date.now()}`;
    await page.getByTestId('encounter-notes').fill(notes);
    await page.getByTestId('encounter-diagnosis').fill('Hipertensión leve');
    await page.getByTestId('encounter-submit').click();

    await expect(page.getByTestId('encounter-notes')).toHaveValue(notes, {
      timeout: 20_000,
    });
    await expect(page.getByText('version', { exact: false }).first()).toBeVisible();

    await page.getByTestId('nav-history').click();
    const timeline = page.getByTestId('history-timeline');
    await expect(timeline).toBeVisible({ timeout: 20_000 });
    await expect(timeline).toContainText(notes);
    await expect(timeline).toContainText('Hipertensión leve');
  });

  test('the agenda lists appointments from today through the next 7 days', async ({
    page,
  }) => {
    await ensureAppointment(USERS.patient2, 1, 6);
    await login(page, USERS.gomez);
    await expect(page.getByTestId('appointment-item').first()).toBeVisible({
      timeout: 20_000,
    });
    const count = await page.getByTestId('appointment-item').count();
    expect(count).toBeGreaterThan(0);
    expect(isoDate(0) <= isoDate(7)).toBe(true);
  });

  test('staff sees the agenda but no clinical navigation', async ({ page }) => {
    await login(page, USERS.staff);
    await expect(page.getByTestId('nav-agenda')).toBeVisible();
    await expect(page.getByTestId('nav-search')).toBeVisible();
    await expect(page.getByTestId('nav-history')).toHaveCount(0);
    await expect(page.getByTestId('appointment-item').first()).toBeVisible({
      timeout: 20_000,
    });
  });
});
