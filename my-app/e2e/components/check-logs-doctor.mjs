import assert from 'node:assert/strict';
import AxeBuilder from '@axe-core/playwright';
import { chromium } from '@playwright/test';
import { createServer } from 'vite';
import ts from 'typescript';

const root = process.cwd();
const server = await createServer({
  configFile: false,
  root,
  cacheDir: 'node_modules/.vite-react-doctor-logs',
  resolve: { dedupe: ['react', 'react-dom'], alias: [{ find: '@', replacement: root }] },
  server: { host: '127.0.0.1', port: 0 },
  plugins: [{
    name: 'logs-doctor-fixture',
    enforce: 'pre',
    transform(code, id) {
      if (id.endsWith('.tsx') && !id.includes('node_modules')) return ts.transpileModule(code, { compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
    },
    configureServer(vite) {
      vite.middlewares.use(async (req, res, next) => {
        if (!req.url?.startsWith('/logs-doctor-fixture')) return next();
        res.setHeader('content-type', 'text/html');
        res.end(await vite.transformIndexHtml(req.url, '<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>Audit logs fixture</title></head><body><div id="root"></div><script type="module" src="/e2e/components/logs-doctor.fixture.tsx"></script></body></html>'));
      });
    },
  }],
});

await server.listen();
const origin = `http://127.0.0.1:${server.httpServer.address().port}`;
const browser = await chromium.launch({ headless: true });

const log = {
  id: 'audit-fixture-1', createdAt: '2026-09-04T14:15:16.000Z', action: 'approve_request', category: 'access_request', username: 'fixture.admin', actorType: 'administrator', targetId: 'request-fixture-1', targetType: 'AccessRequest', subjectUsername: 'fixture.student', subjectEmail: 'fixture.student@example.test', relatedRequestId: 'request-fixture-1', eventKind: 'write', outcome: 'success', correlationId: 'corr-fixture-1', details: { safe: 'fixture detail' }, ipAddress: '127.0.0.1', userAgent: 'Fixture browser', success: true,
};

try {
  for (const width of [390, 1280]) {
    const context = await browser.newContext({ viewport: { width, height: 1000 } });
    const page = await context.newPage();
    const browserErrors = [];
    const externalRequests = [];
    const requests = [];
    let statsRequest = 0;
    page.on('pageerror', (error) => browserErrors.push(error.message));
    await context.addCookies([{ name: 'csrf-token', value: 'fixture-csrf', url: origin }]);
    await page.route('**/*', async (route) => {
      const request = route.request();
      if (!request.url().startsWith(origin)) { externalRequests.push(request.url()); return route.abort(); }
      const url = new URL(request.url());
      if (!url.pathname.startsWith('/api/')) return route.continue();
      if (url.pathname === '/api/admin/logs' && request.method() === 'GET') {
        requests.push({ method: 'GET', query: Object.fromEntries(url.searchParams) });
        return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ logs: [log], pagination: { totalPages: 2, total: 1001 } }) });
      }
      if (url.pathname === '/api/admin/logs' && request.method() === 'POST') {
        statsRequest += 1;
        const responseNumber = statsRequest;
        requests.push({ method: 'POST', csrf: request.headers()['x-csrf-token'], body: request.postDataJSON() });
        if (responseNumber === 1) await new Promise((resolve) => setTimeout(resolve, 450));
        return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ stats: { last24Hours: responseNumber, last7Days: 27, last30Days: 501 } }) });
      }
      return route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ error: `Unexpected fixture API ${request.method()} ${url.pathname}` }) });
    });

    await page.goto(`${origin}/logs-doctor-fixture`);
    await page.getByText('fixture.admin', { exact: true }).waitFor();
    await page.getByText('1,001 total logs', { exact: true }).waitFor();
    await page.getByLabel('Category').click();
    await page.getByRole('option', { name: 'Support', exact: true }).click();
    await page.locator('p.text-3xl').first().getByText('2', { exact: true }).waitFor();
    await page.waitForTimeout(500);
    assert.equal(await page.locator('p.text-3xl').first().textContent(), '2', 'an older stats response cannot replace the newer filter result');
    assert.equal(await page.getByLabel('Search').inputValue(), '', 'the visible search label names its text input');
    assert.equal(await page.getByLabel('Category').getAttribute('role'), 'combobox', 'the category text names the select trigger rather than pretending to be an input label');
    await page.getByLabel('Search').fill('fixture query');
    await page.waitForTimeout(320);
    await page.getByRole('button', { name: 'Refresh', exact: true }).click();
    await page.waitForFunction(() => document.body.textContent?.includes('Updated:'));
    assert.equal(requests.filter((request) => request.method === 'GET').at(-1).query.search, 'fixture query', 'a refreshed search retains its debounced request query');
    await page.getByRole('button', { name: 'Refresh', exact: true }).click();
    await page.waitForTimeout(50);
    assert.equal(requests.filter((request) => request.method === 'GET').at(-1).query.category, 'support', 'a keyboard-reachable category selection is sent unchanged');
    await page.getByRole('button', { name: 'Next', exact: true }).focus();
    await page.keyboard.press('Enter');
    await page.getByText('Showing page 2 of 2', { exact: true }).waitFor();
    await page.getByRole('button', { name: 'View', exact: true }).focus();
    await page.keyboard.press('Enter');
    const dialog = page.getByRole('dialog');
    await dialog.getByText('Log Details', { exact: true }).waitFor();
    await dialog.getByText('fixture.student@example.test', { exact: true }).waitFor();
    assert.equal(await dialog.locator('dt').filter({ hasText: 'Timestamp' }).count(), 1, 'record metadata uses description terms instead of labels without controls');
    await dialog.getByRole('button', { name: 'Close', exact: true }).first().click();
    await page.getByRole('dialog').waitFor({ state: 'detached' });
    const axe = await new AxeBuilder({ page }).withRules(['label', 'button-name']).analyze();
    assert.equal(axe.violations.length, 0, `axe violations: ${axe.violations.map((violation) => violation.id).join(', ')}`);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, 'audit log controls must not overflow the viewport');
    assert.ok(requests.some((request) => request.method === 'POST' && request.csrf === 'fixture-csrf' && request.body.action === 'get_stats'), 'the read-only stats action keeps the existing CSRF request contract');
    assert.deepEqual(externalRequests, [], 'fixture aborts every non-local request');
    assert.deepEqual(browserErrors, [], `browser errors: ${browserErrors.join('\n')}`);
    await context.close();
  }
  console.log('PASS: Logs fixture validates filters, pagination, detail dialog, semantic metadata, CSRF stats contract, keyboard actions, axe labels/buttons, local-only requests, and 390/1280 layouts.');
} finally {
  await browser.close();
  await server.close();
}
