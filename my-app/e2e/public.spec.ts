import { expect, test } from '@playwright/test';
import { expectNoSeriousA11yViolations } from './helpers';

test.describe('anonymous portal', () => {
  test('home has one main landmark and passes the serious axe gate', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('main')).toHaveCount(1);
    await expect(page.locator('#main-content')).toHaveCount(1);
    await expectNoSeriousA11yViolations(page);
    await expect(page).toHaveScreenshot('home.png', { fullPage: true });
  });

  test('external request exposes a coherent loaded collection state', async ({ page }) => {
    await page.goto('/request/external');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await expect(page.getByText('Browser fixture event')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Submit Request' })).toBeDisabled();
    await expectNoSeriousA11yViolations(page);
  });

  test('events failure is focused and blocks submission', async ({ page }) => {
    await page.route('**/api/events/active', (route) => route.fulfill({ status: 503, contentType: 'application/json', body: '{"error":"unavailable"}' }));
    await page.goto('/request/external');
    const alert = page.getByRole('alert').filter({ hasText: 'Events are unavailable' });
    await expect(alert).toContainText('Events are unavailable');
    await expect(alert).toBeFocused();
    await expect(page.getByRole('button', { name: 'Retry' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Contact Support' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Submit Request' })).toBeDisabled();
  });
});
