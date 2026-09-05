// Real React notification management component and compiled application CSS with
// local intercepted API fixtures only. Run from my-app: node e2e/components/check-settings-doctor.mjs
import assert from 'node:assert/strict';
import { createServer } from 'vite';
import { chromium } from '@playwright/test';
import ts from 'typescript';

const root = process.cwd();
const server = await createServer({
  configFile: false,
  root,
  cacheDir: 'node_modules/.vite-react-doctor-settings',
  resolve: { alias: [{ find: '@', replacement: root }] },
  server: { host: '127.0.0.1', port: 0 },
  plugins: [{
    name: 'settings-doctor-fixture',
    enforce: 'pre',
    transform(code, id) {
      if (id.endsWith('.tsx') && !id.includes('node_modules')) {
        return ts.transpileModule(code, {
          compilerOptions: {
            jsx: ts.JsxEmit.ReactJSX,
            module: ts.ModuleKind.ESNext,
            target: ts.ScriptTarget.ES2022,
          },
        }).outputText;
      }
    },
    configureServer(vite) {
      vite.middlewares.use(async (req, res, next) => {
        if (!req.url?.startsWith('/settings-doctor-fixture')) return next();
        res.setHeader('content-type', 'text/html');
        res.end(await vite.transformIndexHtml(req.url, '<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>Settings doctor fixture</title></head><body><div id="root"></div><script type="module" src="/e2e/components/settings-doctor.fixture.tsx"></script></body></html>'));
      });
    },
  }],
});

await server.listen();
const origin = `http://127.0.0.1:${server.httpServer.address().port}`;
const browser = await chromium.launch({ headless: true });

function localJson(route, status, body) {
  return route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
}

try {
  for (const theme of ['light', 'dark']) {
    for (const width of [1280, 390]) {
      const context = await browser.newContext({ viewport: { width, height: 1000 }, colorScheme: theme });
      const page = await context.newPage();
      const requests = [];
      const externalRequests = [];
      const browserErrors = [];
      const expectedErrors = [];
      const expectedNetworkErrors = [];
      let failFirstCreate = true;
      let notifications = [{
        id: 'fixture-1',
        message: 'Initial scheduled maintenance',
        type: 'warning',
        priority: 5,
        isActive: true,
        startDate: null,
        endDate: null,
        dismissible: true,
        createdBy: 'fixture-admin',
        createdAt: '2026-09-04T00:00:00.000Z',
      }];

      page.on('pageerror', (error) => browserErrors.push(error.message));
      page.on('console', (message) => {
        if (message.type() !== 'error') return;
        if (message.text().includes('Error saving notification:')) expectedErrors.push(message.text());
        else if (/status of 503 \(Service Unavailable\)/.test(message.text())) expectedNetworkErrors.push(message.text());
        else browserErrors.push(message.text());
      });
      await page.route('**/*', async (route) => {
        const request = route.request();
        if (!request.url().startsWith(origin)) {
          externalRequests.push(request.url());
          return route.abort();
        }
        const url = new URL(request.url());
        if (!url.pathname.startsWith('/api/')) return route.continue();
        if (url.pathname === '/api/csrf-token') return localJson(route, 200, { csrfToken: 'fixture-csrf-token' });
        if (url.pathname === '/api/admin/notifications' && request.method() === 'GET') {
          return localJson(route, 200, { notifications });
        }

        const payload = request.postData() ? request.postDataJSON() : null;
        requests.push({ method: request.method(), pathname: url.pathname, csrf: request.headers()['x-csrf-token'], payload });
        if (url.pathname === '/api/admin/notifications' && request.method() === 'POST') {
          if (failFirstCreate) {
            failFirstCreate = false;
            return localJson(route, 503, { error: 'Fixture notification failure' });
          }
          notifications = [...notifications, {
            id: 'fixture-2',
            ...payload,
            createdBy: 'fixture-admin',
            createdAt: '2026-09-04T00:00:00.000Z',
            startDate: payload.startDate || null,
            endDate: payload.endDate || null,
          }];
          return localJson(route, 200, { message: 'Notification created successfully' });
        }
        if (url.pathname === '/api/admin/notifications/fixture-1' && request.method() === 'PATCH') {
          notifications = notifications.map((notification) => notification.id === 'fixture-1'
            ? { ...notification, ...payload, startDate: payload.startDate || null, endDate: payload.endDate || null }
            : notification);
          return localJson(route, 200, { message: 'Notification updated successfully' });
        }
        if (url.pathname === '/api/admin/notifications/fixture-1' && request.method() === 'DELETE') {
          notifications = notifications.filter((notification) => notification.id !== 'fixture-1');
          return localJson(route, 200, { message: 'Notification deleted successfully' });
        }
        return localJson(route, 404, { error: `Unexpected fixture API: ${request.method()} ${url.pathname}` });
      });

      await page.goto(`${origin}/settings-doctor-fixture`);
      if (theme === 'dark') await page.locator('html').evaluate((html) => html.classList.add('dark'));
      await page.getByText('Initial scheduled maintenance', { exact: true }).waitFor();

      await page.getByRole('button', { name: 'Create Notification' }).click();
      const dialog = page.getByRole('dialog');
      await dialog.getByRole('textbox', { name: /Message/ }).fill('Fixture status update');
      await dialog.getByRole('button', { name: 'Create', exact: true }).click();
      await page.getByText('Fixture notification failure', { exact: true }).waitFor();
      assert.equal(await dialog.getByRole('textbox', { name: /Message/ }).inputValue(), 'Fixture status update', 'a failed create keeps the original form for retry');
      await dialog.getByRole('button', { name: 'Create', exact: true }).click();
      await page.getByText('Notification created successfully', { exact: true }).waitFor();
      await page.locator('#notification-banners').getByText('Fixture status update', { exact: true }).waitFor();

      await page.getByRole('button', { name: 'Edit notification: Initial scheduled maintenance' }).click();
      await page.getByRole('dialog').getByRole('textbox', { name: /Message/ }).fill('Updated scheduled maintenance');
      await page.getByRole('dialog').getByRole('button', { name: 'Update', exact: true }).click();
      await page.getByText('Notification updated successfully', { exact: true }).waitFor();
      await page.locator('#notification-banners').getByText('Updated scheduled maintenance', { exact: true }).waitFor();

      await page.getByRole('button', { name: 'Delete notification: Updated scheduled maintenance' }).click();
      await page.getByRole('alertdialog').getByRole('button', { name: 'Delete', exact: true }).click();
      await page.getByText('Notification deleted successfully', { exact: true }).waitFor();
      await page.locator('#notification-banners').getByText('Updated scheduled maintenance', { exact: true }).waitFor({ state: 'detached' });

      assert.deepEqual(requests.map(({ method, pathname, csrf }) => ({ method, pathname, csrf })), [
        { method: 'POST', pathname: '/api/admin/notifications', csrf: 'fixture-csrf-token' },
        { method: 'POST', pathname: '/api/admin/notifications', csrf: 'fixture-csrf-token' },
        { method: 'PATCH', pathname: '/api/admin/notifications/fixture-1', csrf: 'fixture-csrf-token' },
        { method: 'DELETE', pathname: '/api/admin/notifications/fixture-1', csrf: 'fixture-csrf-token' },
      ]);
      assert.equal(requests[1].payload.message, 'Fixture status update');
      assert.equal(requests[2].payload.message, 'Updated scheduled maintenance');
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, 'notification controls must not overflow their viewport');
      assert.deepEqual(externalRequests, [], 'fixture must abort rather than contact external services');
      assert.equal(expectedErrors.length, 1, 'the deliberately failed create is the only expected component error');
      assert.equal(expectedNetworkErrors.length, 1, 'the deliberately failed create is the only expected network error');
      assert.deepEqual(browserErrors, [], `browser errors: ${browserErrors.join('\n')}`);
      await context.close();
    }
  }
  console.log('Settings notification fixture passed: create retry, edit, delete, CSRF, local API interception, and responsive light/dark viewports.');
} finally {
  await browser.close();
  await server.close();
}
