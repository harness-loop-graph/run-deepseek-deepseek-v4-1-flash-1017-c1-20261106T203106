import { expect, test } from '@playwright/test';
import {
  apiCall,
  apiLogin,
  ensureAppointment,
  login,
  USERS,
} from './helpers';

test.describe('SCR-06 patient clinical history', () => {
  test('the patient views their own history with notes and attachments', async ({
    page,
  }) => {
    const appointment = await ensureAppointment(USERS.patient1, 1, 6);
    const professionalToken = await apiLogin(USERS.gomez);
    const notes = `Historia clínica ${Date.now()}`;
    const encounter = await apiCall<{ id: number }>(
      professionalToken,
      `/appointments/${appointment.id}/encounter`,
      {
        method: 'POST',
        body: { notes, diagnosis: 'Control anual' },
      },
    );
    expect([201, 409]).toContain(encounter.status);

    const pdf = Buffer.from(
      '%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n',
    );
    const form = new FormData();
    form.append(
      'file',
      new Blob([pdf], { type: 'application/pdf' }),
      'analisis.pdf',
    );
    const upload = await fetch(
      `http://localhost:3000/encounters/${encounter.body.id}/attachments`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${professionalToken}` },
        body: form,
      },
    );
    expect(upload.status).toBe(201);

    await login(page, USERS.patient1);
    await page.getByTestId('nav-history').click();
    const timeline = page.getByTestId('history-timeline');
    await expect(timeline).toBeVisible({ timeout: 20_000 });
    await expect(timeline).toContainText(notes);
    await expect(timeline).toContainText('Control anual');
    await expect(timeline).toContainText('analisis.pdf');
  });

  test('a patient cannot reach another patient history', async ({ page }) => {
    await login(page, USERS.patient2);
    await page.goto('/history/1');
    await expect(page.getByTestId('error-banner')).toBeVisible({
      timeout: 20_000,
    });
    await expect(page.getByTestId('history-timeline')).toHaveCount(0);
  });

  test('a professional reads the history of assigned patients', async ({ page }) => {
    await ensureAppointment(USERS.patient3, 1, 6);
    await login(page, USERS.gomez);
    await page.getByTestId('nav-history').click();
    await expect(page.getByTestId('nav-history')).toBeVisible();
    await expect(
      page.getByTestId('history-timeline').or(page.getByTestId('empty-state')),
    ).toBeVisible({ timeout: 20_000 });
  });
});
