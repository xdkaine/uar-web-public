import AxeBuilder from '@axe-core/playwright';
import { expect, type Page } from '@playwright/test';

export const TEST_PERSONA_PASSWORD = process.env.BROWSER_TEST_USER_PASSWORD ?? 'Fixture-only-42!';

export const PERSONAS = {
  userOwner: 'user-owner',
  groupAssignee: 'group-assignee',
  director: 'director',
  faculty: 'faculty',
  messageAdmin: 'message-admin',
  directoryAdmin: 'directory-admin',
  ticketAdmin: 'ticket-admin',
  auditExporter: 'audit-exporter',
  userManager: 'user-manager',
  fullAdmin: 'full-admin',
} as const;

export async function expectNoSeriousA11yViolations(page: Page) {
  await page.waitForFunction(() => Array.from(document.querySelectorAll<HTMLElement>('[style*="opacity"][style*="transform"]'))
    .every((element) => Number.parseFloat(getComputedStyle(element).opacity) >= 0.99), undefined, { timeout: 3_000 });
  await page.addStyleTag({
    content: [
      '*,*::before,*::after{animation:none!important;transition:none!important}',
      '[style*="opacity"][style*="transform"]{opacity:1!important;transform:none!important}',
    ].join(''),
  });
  await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  const result = await new AxeBuilder({ page }).analyze();
  expect(result.violations.filter((violation) => violation.impact === 'serious' || violation.impact === 'critical')).toEqual([]);
}

export async function waitForTurnstile(page: Page) {
  await expect(page.locator('input[name="cf-turnstile-response"]')).toHaveValue(/.+/, { timeout: 15_000 });
}

export async function signInThroughPortal(page: Page, username: string) {
  await page.goto('/api/auth/oidc/login?redirect=%2Fadmin');
  await expect(page).toHaveURL((url) => url.hostname === '127.0.0.1' && url.port === '4403' && url.pathname.startsWith('/interaction/'));
  await expect(page.getByRole('heading', { name: /sign in to/i })).toBeVisible();
  await page.getByLabel('Username').fill(username);
  await page.getByLabel('Password').fill(TEST_PERSONA_PASSWORD);
  await waitForTurnstile(page);
  await page.getByRole('button', { name: /sign in/i }).click();
  await expect(page).toHaveURL(
    (url) => url.hostname === '127.0.0.1' && url.port === '4402' && url.pathname.startsWith('/admin'),
    { timeout: 15_000 }
  );
}
