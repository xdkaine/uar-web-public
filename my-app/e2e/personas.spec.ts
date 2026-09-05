import { expect, test } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { expectNoSeriousA11yViolations, PERSONAS, signInThroughPortal, TEST_PERSONA_PASSWORD, waitForTurnstile } from './helpers';

const expectedLanding = [
  [PERSONAS.groupAssignee, '/admin/support'],
  [PERSONAS.director, '/admin/requests'],
  [PERSONAS.faculty, '/admin/requests'],
  [PERSONAS.messageAdmin, '/admin/settings'],
  [PERSONAS.directoryAdmin, '/admin/settings'],
  [PERSONAS.ticketAdmin, '/admin/support'],
  [PERSONAS.auditExporter, '/admin/logs'],
  [PERSONAS.userManager, '/admin/users'],
  [PERSONAS.fullAdmin, '/admin'],
] as const;

const forbiddenApiByPersona = [
  [PERSONAS.groupAssignee, '/api/admin/users'],
  [PERSONAS.director, '/api/admin/config/messages'],
  [PERSONAS.faculty, '/api/admin/config/messages'],
  [PERSONAS.messageAdmin, '/api/admin/users'],
  [PERSONAS.directoryAdmin, '/api/admin/config/messages'],
  [PERSONAS.ticketAdmin, '/api/admin/logs'],
  [PERSONAS.auditExporter, '/api/admin/users'],
  [PERSONAS.userManager, '/api/admin/logs'],
] as const;

test.describe('authenticated capability surfaces', () => {
  for (const [username, allowedHref] of expectedLanding) {
    test(`${username} receives a reachable authorized surface`, async ({ page }) => {
      await signInThroughPortal(page, username);
      const allowedLink = page.locator(`a[href="${allowedHref}"]`).first();
      await expect(page.locator('main')).toHaveCount(1);
      await expect(allowedLink.or(page.getByText(/Admin|Configuration|Requests|Tickets|Users/i).first())).toBeVisible();
      await expectNoSeriousA11yViolations(page);
    });
  }

  for (const [username, forbiddenApi] of forbiddenApiByPersona) {
    test(`${username} receives a complementary API denial`, async ({ page }) => {
      await signInThroughPortal(page, username);
      const status = await page.evaluate(async (url) => (await fetch(url, { cache: 'no-store' })).status, forbiddenApi);
      expect(status).toBe(403);
    });
  }

  test('director controls do not expose provisioning without its capability', async ({ page }) => {
    await signInThroughPortal(page, PERSONAS.director);
    await page.goto('/admin/requests/browser-director-request');
    await expect(page.getByRole('button', { name: /Create AD Account|Manual Assignment|Generate Password/i })).toHaveCount(0);
    await expect(page.getByText('Comments & Notes')).toHaveCount(0);
  });

  test('full-catalog operator can search every operational area', async ({ page }) => {
    await signInThroughPortal(page, PERSONAS.fullAdmin);
    await page.getByRole('link', { name: 'Search records' }).click();
    await expect(page.getByRole('heading', { name: 'Global Search' })).toBeVisible();

    for (const scope of ['Requests', 'Lifecycle', 'VPN', 'Tickets', 'Audit']) {
      await expect(page.getByRole('button', { name: scope, exact: true })).toBeVisible();
    }

    await page.getByPlaceholder('Name, email, username, ticket or request ID…').fill('Director Fixture');
    await expect(page.getByText('Director Fixture', { exact: true })).toBeVisible();
  });

  test('partial operator cannot open Global Search without admin.search', async ({ page }) => {
    await signInThroughPortal(page, PERSONAS.director);
    await expect(page.getByRole('link', { name: 'Search records' })).toHaveCount(0);

    await page.goto('/admin/search');
    await expect(page.getByText(/privileges do not include|not authorized|forbidden/i).first()).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Global Search' })).toHaveCount(0);
  });

  test('ordinary owner cannot mount an admin panel', async ({ page }) => {
    await signInThroughPortal(page, PERSONAS.userOwner);
    await page.goto('/admin/settings?section=directory');
    await expect(page.getByText(/access|forbidden|not authorized/i).first()).toBeVisible();
    await expect(page.locator('[data-config-section="directory"]')).toHaveCount(0);
  });

  test('live LDAP membership loss revokes full administrator access', async ({ page }) => {
    await signInThroughPortal(page, PERSONAS.fullAdmin);
    const dockerCommand = process.env.BROWSER_TEST_DOCKER_COMMAND ?? 'docker';
    const composeProject = process.env.BROWSER_TEST_COMPOSE_PROJECT ?? 'uar-browser-test';
    const composeArgs = ['compose', '-p', composeProject, '-f', '../tests/browser/docker-compose.yml', 'exec', '-T', 'directory', 'samba-tool', 'group'];
    try {
      execFileSync(dockerCommand, [...composeArgs, 'removemembers', 'role-full-admin', PERSONAS.fullAdmin], { cwd: process.cwd(), stdio: 'pipe' });
      await page.goto('/admin/users');
      await expect(page.getByText(/access|forbidden|not authorized/i).first()).toBeVisible();
    } finally {
      execFileSync(dockerCommand, [...composeArgs, 'addmembers', 'role-full-admin', PERSONAS.fullAdmin], { cwd: process.cwd(), stdio: 'pipe' });
    }
  });
});

test.describe('Auth Manager', () => {
  test('full administrator can sign in with keyboard controls', async ({ page }) => {
    await page.goto('http://127.0.0.1:4403/admin');
    await page.getByLabel('Username').fill(PERSONAS.fullAdmin);
    await page.getByLabel('Password').fill(TEST_PERSONA_PASSWORD);
    await waitForTurnstile(page);
    await page.getByRole('button', { name: 'Sign in' }).press('Enter');
    await expect(page.getByRole('heading', { name: 'Overview' })).toBeVisible();
    await expectNoSeriousA11yViolations(page);
  });
});
