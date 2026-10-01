import { expect, test } from '@playwright/test';

test('audio studio opens from a direct route and controls the spatial mix', async ({ page }) => {
  await page.goto('/audio-studio');

  const welcomeName = page.getByLabel('Your name');
  if (await welcomeName.isVisible().catch(() => false)) {
    await welcomeName.fill('Studio tester');
    await page.getByRole('button', { name: 'Continue' }).click();
  }

  await expect(page.getByRole('heading', { name: /Make every track move/i })).toBeVisible();
  const toggle = page.getByRole('switch', { name: 'Enable 8D audio' });
  await expect(toggle).toHaveAttribute('aria-checked', 'false');
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-checked', 'true');

  await page.getByRole('button', { name: /Deep space/ }).click();
  const motionButtons = page.getByRole('group', { name: 'Sound movement path' });
  await expect(motionButtons.getByRole('button', { name: /Orbit/ }).first()).toHaveAttribute('aria-pressed', 'true');
  await motionButtons.getByRole('button', { name: /Manual/ }).click();
  await expect(page.getByRole('slider', { name: 'Drag to position the sound from left to right' })).toBeVisible();
  await expect(page.getByRole('slider', { name: /Position/ })).toBeVisible();

  await expect(page.getByRole('link', { name: 'Audio Studio' })).toHaveAttribute('aria-current', 'page');
});
