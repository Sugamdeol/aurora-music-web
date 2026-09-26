import { expect, test } from '@playwright/test';

test('a direct app route renders the React app shell', async ({ page }) => {
  const response = await page.goto('/search');

  expect(response, 'the development server should answer the route').not.toBeNull();
  expect(response!.status(), 'the app route should use the HTML shell fallback').toBeLessThan(400);

  await expect(page.locator('#root')).toBeAttached();
  await expect(
    page.locator('[data-testid="app-shell"], [data-app-shell], #root > *').first(),
    'the React application should mount its app shell',
  ).toBeVisible({ timeout: 15_000 });
});
