import assert from 'node:assert/strict';
import { createServer } from 'vite';
import { chromium } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import ts from 'typescript';

const root = process.cwd();
const mocks = {
  'next/navigation': `const router = { push(path) { window.fixtureRedirects ??= []; window.fixtureRedirects.push(path); }, back() {} }; export const useRouter = () => router;`,
  'next/link': `import React from 'react'; export default function Link(props) { return React.createElement('a', props); }`,
  '@/components/PortalNav': `import React from 'react'; export default function PortalNav({sessionState}) { return React.createElement('p', {'data-testid':'navbar-state'}, sessionState); }`,
  '@/lib/use-appearance': `const appearance = {}; export const useAppearance = () => appearance;`,
};
const server = await createServer({
  configFile: false, root, cacheDir: 'node_modules/.vite-react-doctor-core',
  define: { 'process.env': '{}' },
  resolve: { alias: [...Object.keys(mocks).map(key => ({find: key, replacement: '\0fixture:' + key})), { find: '@', replacement: root }] },
  server: { host: '127.0.0.1', port: 0 },
  plugins: [{
    name: 'core-lifecycle-fixture', enforce: 'pre',
    resolveId(id) { if (id.startsWith('\0fixture:')) return id; if (Object.hasOwn(mocks, id)) return `\0fixture:${id}`; },
    load(id) { if (id.startsWith('\0fixture:')) return mocks[id.slice(9)]; },
    transform(code, id) {
      if (id.endsWith('.tsx') && !id.includes('node_modules')) return ts.transpileModule(code, {
        compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
      }).outputText;
    },
    configureServer(vite) {
      vite.middlewares.use(async (req, res, next) => {
        if (!req.url?.startsWith('/core-fixture')) return next();
        res.setHeader('content-type', 'text/html');
        res.end(await vite.transformIndexHtml(req.url, '<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script type="module" src="/e2e/components/core-lifecycle.fixture.tsx"></script></body></html>'));
      });
    },
  }],
});
await server.listen();
const origin = `http://127.0.0.1:${server.httpServer.address().port}`;
const browser = await chromium.launch();
try {
  {
    const page = await browser.newPage({ timezoneId: 'Asia/Tokyo' });
    await page.route('**/*', route => route.request().url().startsWith(origin) ? route.continue() : route.abort());
    await page.goto(`${origin}/core-fixture?localdate-hydration`);
    await page.waitForFunction(() => document.querySelector('[data-testid="localdate-result"]')?.textContent === '9/5/2026');
    assert.deepEqual(await page.evaluate(() => window.hydrationErrors ?? []), [], 'initial server and visitor markup must agree');
    await page.evaluate(() => window.updateLocalDate('invalid-date'));
    await page.waitForTimeout(100);
    assert.equal(await page.getByTestId('localdate-result').textContent(), '', 'invalid replacement must not retain the previous valid date');
    await page.evaluate(() => window.updateLocalDate('2026-09-06T23:00:00Z'));
    await page.waitForFunction(() => document.querySelector('[data-testid="localdate-result"]')?.textContent === '9/7/2026');
    await page.close();
  }
  for (const width of [390, 1280]) {
    const page = await browser.newPage({ viewport: { width, height: 900 } });
    await page.addInitScript(() => {
      const originalFetch = window.fetch.bind(window);
      window.fetch = async (...args) => {
        const response = await originalFetch(...args);
        if (String(args[0]).includes('route=fixture-a')) {
          const originalJson = response.json.bind(response);
          response.json = async () => {
            const data = await originalJson();
            await new Promise(resolve => { window.fixtureReleaseOldEvidence = resolve; });
            return data;
          };
        }
        return response;
      };
    });
    let failures = 0;
    const registry = ['a', 'b', 'c'].map(id => ({ route: `fixture-${id}`, label: `Fixture job ${id.toUpperCase()}`, description: `Synthetic job ${id}`, expectedIntervalSeconds: 60, enabledEnvKey: null, enabled: true }));
    await page.route('**/*', route => {
      if (!route.request().url().startsWith(origin)) return route.abort();
      const url = new URL(route.request().url());
      if (url.pathname === '/api/admin/cron-runs') {
        const selected = url.searchParams.get('route');
        if (selected === 'fixture-c' && failures++ === 0) return route.fulfill({ status: 500, json: { error: 'Synthetic evidence failure' } });
        if (selected) return route.fulfill({ json: { runs: [{ id: `run-${selected}`, route: selected, outcome: 'success', startedAt: '2026-09-04T12:00:00Z', durationMs: 12, itemsProcessed: 2, errorClass: null, detail: { summary: `Evidence for ${selected}` } }], operationalSignals: [], signalEvents: [], evidencePolicy: null } });
        return route.fulfill({ json: { registry, routeHealth: [], runs: [], flowRuns: [] } });
      }
      if (url.pathname === '/api/admin/service-alerts') return route.fulfill({ status: 403, json: { error: 'Forbidden' } });
      if (url.pathname === '/api/admin/operational-signals') return route.fulfill({ json: { signals: [], capabilities: { accessRequestsRead: false } } });
      return route.continue();
    });
    await page.goto(`${origin}/core-fixture?operations`);
    await page.getByRole('button', { name: 'View Fixture job A run details', exact: true }).click();
    await page.waitForFunction(() => typeof window.fixtureReleaseOldEvidence === 'function');
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'View Fixture job B run details', exact: true }).click();
    await page.getByText('Evidence for fixture-b', { exact: true }).waitFor();
    await page.evaluate(() => window.fixtureReleaseOldEvidence());
    await page.waitForTimeout(100);
    assert.equal(await page.getByText('Evidence for fixture-a', { exact: true }).count(), 0, 'old parsed evidence cannot overwrite the newer selected job');
    assert.equal(await page.getByText('Evidence for fixture-b', { exact: true }).count(), 1);
    await page.screenshot({ path: `test-results/operations-doctor-${width}.png` });
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'View Fixture job C run details', exact: true }).click();
    await page.getByText('Run evidence is unavailable', { exact: true }).waitFor();
    assert.equal(await page.getByText('Loading run evidence', { exact: true }).count(), 0, 'failed evidence must stop loading');
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'View Fixture job C run details', exact: true }).click();
    await page.getByText('Evidence for fixture-c', { exact: true }).waitFor();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await page.close();
  }
  for (const width of [390, 1280]) {
    const page = await browser.newPage({ viewport: { width, height: 900 } });
    await page.route('**/*', route => route.request().url().startsWith(origin) ? route.continue() : route.abort());
    await page.goto(`${origin}/core-fixture?template`);
    const editor = page.locator('.tiptap[contenteditable="true"]');
    await editor.waitFor().catch(async (error) => { throw new Error(`${error.message}\n${await page.locator('body').innerText()}`); });
    await editor.fill('Welcome ');
    await editor.press('End');
    await editor.pressSequentially('{{');
    await page.getByRole('option').first().waitFor();
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => document.querySelector('[data-testid="template-result"]')?.textContent.includes('{{request.id}}'));
    await editor.press('End');
    await editor.pressSequentially(' {{user');
    await page.getByRole('option').filter({ hasText: 'Recipient name' }).click();
    await page.waitForFunction(() => document.querySelector('[data-testid="template-result"]')?.textContent.includes('{{user.name}}'));
    await page.getByRole('button', { name: 'Bold', exact: true }).click();
    await editor.pressSequentially(' bold text');
    await page.waitForFunction(() => document.querySelector('[data-testid="template-result"]')?.textContent.includes('<strong>'));
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await page.close();
  }
  for (const width of [390, 1280]) {
    const page = await browser.newPage({ viewport: { width, height: 900 } });
    await page.context().addCookies([{ name: 'csrf-token', value: 'synthetic-csrf', url: origin }]);
    const pendingComments = [];
    let commentsReleased = false;
    const savedComments = [{ id: 'comment-one', comment: 'Synthetic note', author: 'fixture.operator', createdAt: '2026-09-04T12:00:00Z', updatedAt: '2026-09-04T12:00:00Z' }];
    let attempts = 0;
    await page.route('**/*', route => {
      if (!route.request().url().startsWith(origin)) return route.abort();
      const path = new URL(route.request().url()).pathname;
      if (path.endsWith('/fixture-vpn/comments')) {
        if (route.request().method() === 'POST') {
          attempts++;
          assert.deepEqual(route.request().postDataJSON(), { comment: 'Synthetic follow-up' });
          assert.equal(route.request().headers()['x-csrf-token'], 'synthetic-csrf');
          if (attempts === 1) return route.fulfill({ status: 500, json: { error: 'Synthetic save failure' } });
          savedComments.push({ ...savedComments[0], id: 'comment-two', comment: 'Synthetic follow-up' });
          return route.fulfill({ json: { success: true } });
        }
        if (commentsReleased) return route.fulfill({ json: { comments: savedComments } });
        pendingComments.push(route); return;
      }
      if (path.endsWith('/fixture-vpn')) return route.fulfill({ json: { account: {
        id: 'fixture-vpn', username: 'fixture.user', name: 'Synthetic VPN user', email: 'fixture@example.test',
        portalType: 'Limited', status: 'active', isInternal: true, createdBy: 'fixture.operator',
        createdAt: '2026-09-04T12:00:00Z', updatedAt: '2026-09-04T12:00:00Z', createdByFaculty: false, canRestore: false,
        disabledAt: '2026-09-03T12:00:00Z', disabledBy: 'fixture.operator', disabledReason: 'Synthetic disable reason',
        revokedAt: '2026-09-03T13:00:00Z', revokedBy: 'fixture.operator', revokedReason: 'Synthetic revoke reason',
        restoredAt: '2026-09-04T12:00:00Z', restoredBy: 'fixture.operator',
        statusLogs: [{ id: 'status-one', oldStatus: 'disabled', newStatus: 'active', changedBy: 'fixture.operator', reason: 'Synthetic restore reason', createdAt: '2026-09-04T12:00:00Z' }],
      } } });
      return route.continue();
    });
    await page.goto(`${origin}/core-fixture?vpndetail`);
    const username = page.locator('dt').filter({ hasText: /^Username$/ });
    await username.waitFor();
    await username.evaluate(element => { element.dataset.identityCheck = 'same-row'; });
    assert.ok(pendingComments.length > 0);
    commentsReleased = true;
    await Promise.all(pendingComments.map(route => route.fulfill({ json: { comments: savedComments } })));
    await page.getByRole('tab', { name: 'Comments (1)', exact: true }).waitFor();
    assert.equal(await username.getAttribute('data-identity-check'), 'same-row', 'independent comment loading must not remount all account metadata rows');
    await page.getByText('Synthetic disable reason', { exact: true }).waitFor();
    await page.getByText('Synthetic revoke reason', { exact: true }).waitFor();
    assert.equal(await page.locator('dt').filter({ hasText: /^Restored By$/ }).count(), 1);
    await page.getByRole('tab', { name: 'Timeline', exact: true }).click();
    await page.getByText('Synthetic restore reason', { exact: true }).waitFor();
    await page.getByRole('tab', { name: 'Comments (1)', exact: true }).click();
    await page.getByText('Synthetic note', { exact: true }).waitFor();
    const comment = page.getByPlaceholder('Enter your comment here...');
    const submit = page.getByRole('button', { name: 'Add Comment', exact: true });
    assert.equal(await submit.isDisabled(), true);
    await comment.fill('Synthetic follow-up');
    await submit.click();
    await page.getByText('Synthetic save failure', { exact: true }).waitFor();
    assert.equal(await comment.inputValue(), 'Synthetic follow-up', 'failed save retains the draft');
    await submit.click();
    await page.getByRole('tab', { name: 'Comments (2)', exact: true }).waitFor();
    await page.getByText('Synthetic follow-up', { exact: true }).waitFor();
    assert.equal(await comment.inputValue(), '');
    assert.equal(attempts, 2);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await page.screenshot({ path: `test-results/vpn-detail-doctor-${width}.png` });
    await page.close();
  }
  {
    const page = await browser.newPage();
    await page.route('**/*', route => {
      if (!route.request().url().startsWith(origin)) return route.abort();
      const path = new URL(route.request().url()).pathname;
      if (path.endsWith('/fixture-vpn/comments')) return route.fulfill({ json: { comments: [] } });
      if (path.endsWith('/fixture-vpn')) return route.fulfill({ status: 404, json: { error: 'Synthetic unavailable account' } });
      return route.continue();
    });
    await page.goto(`${origin}/core-fixture?vpndetail`);
    await page.getByText('VPN account not found', { exact: true }).waitFor();
    assert.equal(await page.getByRole('dialog', { name: 'VPN account unavailable', exact: true }).count(), 1, 'failed-load dialog needs an accessible title');
    await page.close();
  }
  {
    const page = await browser.newPage();
    const accounts = [];
    const comments = [];
    await page.route('**/*', route => {
      if (!route.request().url().startsWith(origin)) return route.abort();
      const path = new URL(route.request().url()).pathname;
      if (path.endsWith('/fixture-vpn/comments')) { comments.push(route); return; }
      if (path.endsWith('/fixture-vpn')) { accounts.push(route); return; }
      return route.continue();
    });
    await page.goto(`${origin}/core-fixture?vpndetail`);
    await page.getByRole('dialog').waitFor();
    assert.equal(await page.getByRole('dialog', { name: 'Loading VPN account details', exact: true }).count(), 1, 'loading dialog needs an accessible title');
    await page.close();
  }
  for (const width of [390, 1280]) {
    const page = await browser.newPage({ timezoneId: 'Asia/Tokyo', viewport: { width, height: 900 } });
    await page.route('**/*', route => route.request().url().startsWith(origin) ? route.continue() : route.abort());
    await page.goto(`${origin}/core-fixture?datetime`);
    const field = page.getByRole('button', { name: 'Expires', exact: true });
    await field.getByText(/Sep 5, 2026, 8:00 AM/).waitFor();
    await field.press('Enter');
    const dialog = page.getByRole('dialog', { name: 'Select date and time', exact: true });
    assert.equal(await dialog.getByRole('button', { name: '4', exact: true }).isDisabled(), true);
    await dialog.getByRole('button', { name: '6', exact: true }).click();
    await dialog.getByRole('combobox', { name: 'Minute', exact: true }).click();
    await page.getByRole('option', { name: '30', exact: true }).click();
    await page.screenshot({ path: `test-results/datetime-doctor-${width}.png` });
    await dialog.getByRole('button', { name: 'Confirm date and time', exact: true }).click();
    assert.equal(await page.getByTestId('datetime-result').textContent(), '2026-09-06T08:30');
    await field.press('Enter');
    await dialog.getByRole('button', { name: '7', exact: true }).click();
    await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
    assert.equal(await page.getByTestId('datetime-result').textContent(), '2026-09-06T08:30');
    await page.getByRole('button', { name: 'Clear Expires', exact: true }).click();
    assert.equal(await page.getByTestId('datetime-result').textContent(), 'none');
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await page.close();
  }
  for (const width of [390, 1280]) {
    const context = await browser.newContext({ viewport: { width, height: 900 } });
    const page = await context.newPage();
    await page.route('**/*', route => route.request().url().startsWith(origin) ? route.continue() : route.abort());
    await page.goto(`${origin}/core-fixture?combobox`);
    const picker = page.getByRole('combobox', { name: 'Group', exact: true });
    await picker.waitFor();
    const initialWidth = await picker.evaluate(element => element.getBoundingClientRect().width);
    await picker.focus();
    await page.keyboard.press('Tab');
    assert.equal(await page.getByRole('button', { name: 'Clear selection', exact: true }).evaluate(element => element === document.activeElement), true, 'clear selection must be reachable using Tab');
    await page.keyboard.press('Enter');
    assert.equal(await page.getByTestId('selection-result').textContent(), 'none');
    assert.equal(await page.getByTestId('form-result').textContent(), 'false');
    assert.equal(await picker.getAttribute('aria-expanded'), 'false', 'clearing does not open the dropdown');
    assert.equal(await picker.evaluate(element => element === document.activeElement), true, 'focus returns to the selector after its clear button disappears');
    await picker.press('Enter');
    await page.getByRole('option', { name: 'General', exact: true }).click();
    assert.equal(await page.getByTestId('selection-result').textContent(), 'general');
    assert.equal(await picker.evaluate(element => element.getBoundingClientRect().width), initialWidth);
    await picker.click();
    await page.getByRole('option', { name: 'General', exact: true }).evaluate(element => { element.dataset.identityCheck = 'same-option'; });
    await page.getByRole('button', { name: 'Reorder options', exact: true }).evaluate(element => element.click());
    assert.equal(await page.getByRole('option', { name: 'General', exact: true }).getAttribute('data-identity-check'), 'same-option', 'moving the ungrouped options must not destroy and recreate their DOM identity');
    await page.keyboard.press('Escape');
    const accessibility = await new AxeBuilder({ page }).withRules(['nested-interactive', 'button-name']).analyze();
    assert.deepEqual(accessibility.violations.map(issue => issue.id), []);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await page.screenshot({ path: `test-results/combobox-doctor-${width}.png` });
    await context.close();
  }
  {
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.route('**/*', route => route.request().url().startsWith(origin) ? route.continue() : route.abort());
    await page.clock.install();
    await page.goto(`${origin}/core-fixture?toast`);
    await page.getByText('Saved successfully', { exact: true }).waitFor();
    const accessibility = await new AxeBuilder({ page }).withRules(['button-name']).analyze();
    assert.deepEqual(accessibility.violations.map(issue => issue.id), [], 'notification close control needs a spoken name');
    await page.getByRole('button', { name: 'Dismiss notification', exact: true }).press('Enter');
    assert.equal(await page.getByTestId('toast-result').textContent(), 'closed at revision 0');
    await context.close();
  }
  {
    const page = await browser.newPage();
    await page.route('**/*', route => route.request().url().startsWith(origin) ? route.continue() : route.abort());
    await page.clock.install();
    await page.goto(`${origin}/core-fixture?toast`);
    await page.getByText('Saved successfully', { exact: true }).waitFor();
    await page.clock.runFor(1000);
    await page.getByRole('button', { name: 'Update unrelated content' }).click();
    await page.clock.runFor(2100);
    assert.equal(await page.getByTestId('toast-result').textContent(), 'closed at revision 1', 'unrelated rendering must not restart the notification countdown; completion uses the latest callback');
    await page.close();
  }
  {
    const page = await browser.newPage();
    await page.route('**/*', route => {
      if (!route.request().url().startsWith(origin)) return route.abort();
      if (new URL(route.request().url()).pathname === '/_next/image') return route.fulfill({ path: 'public/logo3og.png' });
      return route.continue();
    });
    await page.goto(`${origin}/core-fixture?footer`);
    const logo = page.getByRole('img', { name: 'SOC Logo', exact: true });
    await logo.waitFor();
    assert.equal(await logo.evaluate(image => image.getBoundingClientRect().width), 96);
    assert.equal(await logo.getAttribute('sizes'), '96px', 'image candidates should describe the actual fixed-width logo, not the viewport');
    await page.close();
  }
  {
    const context = await browser.newContext({ timezoneId: 'Asia/Tokyo', viewport: { width: 390, height: 900 } });
    const page = await context.newPage();
    await page.route('**/*', route => route.request().url().startsWith(origin) ? route.continue() : route.abort());
    await page.goto(`${origin}/core-fixture?datepicker`);
    await page.getByTestId('selected-date').waitFor();
    assert.equal(await page.getByRole('textbox', { name: 'Start date', exact: true }).count(), 1, 'the visible date label must name its input');
    await page.getByRole('button', { name: 'Calendar for Start date', exact: true }).press('Enter');
    await page.getByRole('dialog', { name: 'Select Date' }).waitFor();
    assert.equal(await page.getByRole('button', { name: 'Previous month', exact: true }).count(), 1);
    assert.equal(await page.getByRole('button', { name: 'Next month', exact: true }).count(), 1);
    const accessibility = await new AxeBuilder({ page }).withRules(['label', 'button-name']).analyze();
    assert.deepEqual(accessibility.violations, [], 'date inputs and calendar buttons must have accessible names');
    await page.getByRole('button', { name: '5', exact: true }).click();
    assert.equal(await page.getByTestId('selected-date').textContent(), '2026-09-05', 'a calendar date must not shift to yesterday in a timezone east of UTC');
    await context.close();
  }
  for (const status of [401, 500]) {
    const page = await browser.newPage();
    await page.route('**/*', route => {
      if (!route.request().url().startsWith(origin)) return route.abort();
      if (new URL(route.request().url()).pathname === '/api/auth/session') return route.fulfill({ status, contentType: 'application/json', body: JSON.stringify({ isAuthenticated: true, isAdmin: true, username: 'invalid-error-body' }) });
      return route.continue();
    });
    await page.goto(`${origin}/core-fixture?navbar`);
    await page.waitForFunction(() => window.__UAR_SESSION_STATE__ !== undefined);
    assert.equal(await page.getByTestId('navbar-state').textContent(), 'anonymous', 'HTTP error data must never be published as authenticated session state');
    await page.close();
  }
  {
    const page = await browser.newPage();
    let requests = 0;
    await page.route('**/*', route => {
      if (!route.request().url().startsWith(origin)) return route.abort();
      if (new URL(route.request().url()).pathname === '/api/auth/session') {
        requests++;
        return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ isAuthenticated: false }) });
      }
      return route.continue();
    });
    await page.clock.install();
    await page.goto(`${origin}/core-fixture?navbar`);
    await page.waitForFunction(() => window.__UAR_SESSION_STATE__ !== undefined);
    const initialRequests = requests;
    await page.evaluate(() => {
      window.dispatchEvent(new Event('authStateChanged'));
      window.dispatchEvent(new Event('authStateChanged'));
      const unmount = [...document.querySelectorAll('button')].find(button => button.textContent === 'Unmount fixture');
      unmount.click();
    });
    await page.clock.runFor(1000);
    assert.equal(requests, initialRequests, 'queued authentication events must not fetch after navigation unmounts the bar');
    await page.close();
  }
  for (const width of [390, 1280]) {
    const page = await browser.newPage({ viewport: { width, height: 900 } });
    const errors = [];
    const submissions = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.context().addCookies([{ name: 'csrf-token', value: 'fixture-csrf', url: origin }]);
    await page.route('**/*', route => {
      if (!route.request().url().startsWith(origin)) return route.abort();
      if (new URL(route.request().url()).pathname !== '/api/auth/reset-password') return route.continue();
      submissions.push(route.request().postDataJSON());
      // Password reset deliberately uses its one-time token, not session CSRF.
      assert.equal(route.request().headers()['x-csrf-token'], undefined);
      return route.fulfill({ status: submissions.length === 1 ? 400 : 200, contentType: 'application/json', body: JSON.stringify(submissions.length === 1 ? { error: 'Directory policy rejected this password', issues: ['Password matches a recent password', 'Choose a different password'] } : { success: true }) });
    });
    await page.goto(`${origin}/core-fixture?reset`);
    await page.getByRole('heading', { name: 'Set New Password' }).waitFor();
    assert.equal(await page.getByRole('link', { name: 'Back to Login' }).getAttribute('href'), '/login');
    await page.getByLabel('New Password', { exact: true }).fill('x');
    assert.equal(await page.getByRole('heading', { name: 'Password Requirements:' }).locator('..').getByRole('listitem').count(), 5);
    assert.equal(await page.getByRole('button', { name: 'Reset Password', exact: true }).isDisabled(), true);
    await page.getByLabel('New Password', { exact: true }).fill('SyntheticPassword12!');
    await page.getByLabel('Confirm Password', { exact: true }).fill('SyntheticPassword12!');
    await page.getByRole('button', { name: 'Reset Password', exact: true }).click();
    await page.getByText('Password matches a recent password', { exact: true }).waitFor();
    assert.equal(await page.getByText('Choose a different password', { exact: true }).count(), 1);
    assert.deepEqual(submissions[0], { token: 'fixture-reset-token', newPassword: 'SyntheticPassword12!' });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await page.getByRole('button', { name: 'Reset Password', exact: true }).click();
    await page.getByRole('heading', { name: 'Password Reset Successful' }).waitFor();
    assert.equal(await page.getByRole('link', { name: 'Go to Login' }).count(), 2);
    await page.goto(`${origin}/core-fixture?reset&invalid`);
    await page.getByRole('heading', { name: 'Invalid Reset Link' }).waitFor();
    assert.equal(await page.getByRole('link', { name: 'Request New Link' }).count(), 2);
    assert.deepEqual(errors, []);
    await page.close();
  }
  {
    const page = await browser.newPage();
    const pending = [];
    await page.route('**/*', route => {
      if (!route.request().url().startsWith(origin)) return route.abort();
      if (new URL(route.request().url()).pathname === '/api/auth/reset-password') { pending.push(route); return; }
      return route.continue();
    });
    await page.goto(`${origin}/core-fixture?reset`);
    await page.getByLabel('New Password', { exact: true }).fill('SyntheticPassword12!');
    await page.getByLabel('Confirm Password', { exact: true }).fill('SyntheticPassword12!');
    const submit = async () => {
      const requested = page.waitForRequest(request => new URL(request.url()).pathname === '/api/auth/reset-password');
      await page.locator('form').evaluate(form => form.requestSubmit());
      await requested;
    };
    await submit();
    await submit();
    assert.equal(pending.length, 2);
    await pending[1].fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ error: 'Newest request error', issues: ['Newest policy detail'] }) });
    await page.getByText('Newest policy detail', { exact: true }).waitFor();
    await pending[0].fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ error: 'Obsolete request error', issues: ['Obsolete policy detail'] }) });
    await page.waitForTimeout(150);
    assert.equal(await page.getByText('Newest policy detail', { exact: true }).count(), 1, 'an older request must not replace the current policy error');
    assert.equal(await page.getByText('Obsolete request error', { exact: true }).count(), 0);
    await page.close();
  }
  for (const action of ['Stop polling', 'Slow polling', 'Unmount fixture']) {
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    let requests = 0;
    let pending;
    await page.route('**/*', async route => {
      if (!route.request().url().startsWith(origin)) return route.abort();
      if (new URL(route.request().url()).pathname !== '/fixture-data') return route.continue();
      requests++;
      if (requests === 2) { pending = route; return; }
      await route.fulfill({ body: 'ready' });
    });
    await page.clock.install();
    await page.goto(`${origin}/core-fixture`);
    await page.getByText('Data: ready', { exact: true }).waitFor();
    await page.clock.runFor(1000);
    await page.waitForFunction(() => true);
    assert.equal(requests, 2, 'one scheduled request is pending');
    await page.getByRole('button', { name: action, exact: true }).click();
    await pending.fulfill({ body: 'completed' });
    await page.waitForFunction(() => document.documentElement.dataset.resolvedRequests === '2');
    await page.clock.runFor(50);
    await page.clock.runFor(3000);
    assert.equal(requests, 2, `${action} must not revive the old polling loop after its pending request completes`);
    assert.deepEqual(errors, []);
    await page.close();
  }
  for (const unmount of [false, true]) {
    const page = await browser.newPage();
    await page.route('**/*', route => route.request().url().startsWith(origin) ? route.continue() : route.abort());
    await page.clock.install();
    await page.goto(`${origin}/core-fixture?notfound`);
    await page.getByRole('heading', { name: 'Page Not Found' }).waitFor();
    if (unmount) await page.getByRole('button', { name: 'Unmount fixture' }).click();
    await page.clock.runFor(6000);
    assert.deepEqual(await page.evaluate(() => window.fixtureRedirects ?? []), unmount ? [] : ['/']);
    await page.close();
  }
  console.log('PASS: reset-password original UI/error-list/request contract/retry/success/invalid states at 390/1280; pending polling stop/interval change/unmount; StrictMode countdown redirects once and cancels on unmount.');
} finally {
  await browser.close();
  await server.close();
}
