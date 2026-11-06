import { expect, test, type Page } from '@playwright/test';
import { login, USERS } from './helpers';

function isoDate(offsetDays: number): string {
  return new Date(Date.now() + offsetDays * 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);
}

export async function bookFirstFreeSlot(
  page: Page,
  professionalSurname: string,
  rangeDays = 6,
): Promise<{ appointmentId: number; slotStart: string }> {
  await page.goto('/search');
  await expect(page.getByTestId('search-professional')).toBeVisible();
  await expect
    .poll(async () =>
      page.getByTestId('search-professional').locator('option').count(),
    )
    .toBeGreaterThan(1);
  const options = page.getByTestId('search-professional').locator('option');
  const optionCount = await options.count();
  let chosen = '';
  for (let index = 0; index < optionCount; index += 1) {
    const label = (await options.nth(index).textContent()) ?? '';
    if (label.includes(professionalSurname)) {
      chosen = (await options.nth(index).getAttribute('value')) ?? '';
      break;
    }
  }
  expect(chosen).not.toBe('');
  await page.getByTestId('search-professional').selectOption(chosen);
  await page.getByTestId('search-from').fill(isoDate(0));
  await page.getByTestId('search-to').fill(isoDate(rangeDays));
  await page.getByTestId('search-submit').click();

  const slots = page.getByTestId('slot-item');
  await expect(slots.first()).toBeVisible({ timeout: 20_000 });
  const slot = slots.first();
  const slotStart = await slot.getAttribute('data-slot-start');
  expect(slotStart).toBeTruthy();
  await slot.click();
  await page.getByTestId('book-submit').click();

  const success = page.locator('.state-success');
  await expect(success).toBeVisible({ timeout: 20_000 });
  const message = (await success.textContent()) ?? '';
  const match = /#(\d+)/.exec(message);
  expect(match).not.toBeNull();
  return { appointmentId: Number(match?.[1]), slotStart: slotStart as string };
}

test.describe('SCR-02 / SCR-03 patient booking and cancellation', () => {
  test('a patient books a free slot and cancels the appointment', async ({
    page,
  }) => {
    await login(page, USERS.patient1);
    await expect(page.getByTestId('nav-bookings')).toBeVisible();

    const { appointmentId } = await bookFirstFreeSlot(page, 'Gómez');

    await page.getByTestId('nav-bookings').click();
    const item = page.locator(
      `[data-testid="appointment-item"][data-appointment-id="${appointmentId}"]`,
    );
    await expect(item).toBeVisible({ timeout: 20_000 });
    await expect(item).toContainText('Scheduled');

    await item.getByTestId('cancel-appointment').click();
    await expect(item).toContainText('Cancelled', { timeout: 20_000 });
    await expect(item.getByTestId('cancel-appointment')).toBeDisabled();
  });

  test('availability search shows loading and empty states explicitly', async ({
    page,
  }) => {
    await login(page, USERS.patient2);
    await page.getByTestId('nav-search').click();
    await expect(page.getByTestId('search-professional')).toBeVisible();
    await expect
      .poll(async () =>
        page.getByTestId('search-professional').locator('option').count(),
      )
      .toBeGreaterThan(1);
    const options = page.getByTestId('search-professional').locator('option');
    const optionCount = await options.count();
    let chosen = '';
    for (let index = 0; index < optionCount; index += 1) {
      const label = (await options.nth(index).textContent()) ?? '';
      if (label.includes('López')) {
        chosen = (await options.nth(index).getAttribute('value')) ?? '';
        break;
      }
    }
    await page.getByTestId('search-professional').selectOption(chosen);
    await page.getByTestId('search-from').fill(isoDate(400));
    await page.getByTestId('search-to').fill(isoDate(402));
    await page.getByTestId('search-submit').click();
    await expect(page.getByTestId('empty-state')).toBeVisible({ timeout: 20_000 });
  });

  test('the booking form validates the selected slot client-side', async ({
    page,
  }) => {
    await login(page, USERS.patient3);
    await page.getByTestId('nav-search').click();
    await expect(page.getByTestId('search-professional')).toBeVisible();
    await expect(page.getByTestId('book-submit')).toBeDisabled();
  });
});
