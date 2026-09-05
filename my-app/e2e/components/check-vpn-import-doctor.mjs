import assert from 'node:assert/strict';
import { chromium } from '@playwright/test';
import { createServer } from 'vite';
import ts from 'typescript';

const root = process.cwd();
const server = await createServer({ configFile: false, root, cacheDir: 'node_modules/.vite-vpn-import-doctor', logLevel: 'error', resolve: { dedupe: ['react', 'react-dom'], alias: [{ find: '@', replacement: root }] }, server: { host: '127.0.0.1', port: 0 }, plugins: [{ name: 'vpn-import-fixture', transform(code, id) { return id.endsWith('.tsx') && !id.includes('node_modules') ? ts.transpileModule(code, { compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText : undefined; }, configureServer(vite) { vite.middlewares.use(async (request, response, next) => { if (!request.url?.startsWith('/vpn-import-doctor-fixture')) return next(); response.setHeader('content-type', 'text/html'); response.end(await vite.transformIndexHtml(request.url, '<!doctype html><div id="root"></div><script type="module" src="/e2e/components/vpn-import-doctor.fixture.tsx"></script>')); }); } }] });
await server.listen();
const origin = `http://127.0.0.1:${server.httpServer.address().port}`;
console.log(`VPN import fixture: ${origin}`);
const browser = await chromium.launch({ headless: true });
const externalRequests = [];
const browserErrors = [];
async function guardPage(page) {
  page.setDefaultTimeout(10000);
  page.on('pageerror', (error) => browserErrors.push(error.message));
  await page.route('**/*', (route) => {
    if (!route.request().url().startsWith(origin)) {
      externalRequests.push(route.request().url());
      return route.abort();
    }
    return route.fallback();
  });
}
const importRow = [{ id: 'import-1', fileName: 'users.csv', userType: 'Internal', importedBy: 'admin', createdAt: '', matchedRecords: 1, createdAccounts: 0 }];
try {
  for (const scenario of ['non-ok', 'network', 'json']) {
    let gets = 0;
    const requests = [];
    const page = await browser.newPage();
    await guardPage(page);
    await page.context().addCookies([{ name: 'csrf-token', value: 'synthetic-vpn-csrf', url: origin }]);
    await page.route('**/api/**', async (route) => {
      const request = route.request();
      requests.push({ path: new URL(request.url()).pathname, method: request.method(), body: request.postData(), csrf: request.headers()['x-csrf-token'] });
      if (request.url().endsWith('/api/admin/vpn-import') && request.method() === 'GET') {
        gets += 1;
        if (gets === 1) return route.fulfill({ json: { data: importRow } });
        if (scenario === 'non-ok') return route.fulfill({ status: 500, json: {} });
        if (scenario === 'json') return route.fulfill({ status: 200, contentType: 'application/json', body: 'invalid-json' });
        return route.abort();
      }
      if (request.url().endsWith('/api/admin/vpn-import/process')) return route.fulfill({ json: { data: { createdCount: 1 } } });
      return route.abort();
    });
    await page.goto(`${origin}/vpn-import-doctor-fixture`, { waitUntil: 'domcontentloaded' });
    await page.getByRole('button', { name: 'Open queue' }).click();
    await page.getByTestId('imports').filter({ hasText: '1' }).waitFor();
    await page.getByRole('button', { name: 'Process import' }).click();
    await page.waitForFunction((scenario) => scenario === 'non-ok'
      ? document.querySelector('[data-testid="refreshes"]')?.textContent === '1'
      : document.querySelector('[data-testid="messages"]')?.textContent.includes('Failed to process import'), scenario);
    assert.equal(await page.getByTestId('refreshes').textContent(), scenario === 'non-ok' ? '1' : '0');
    assert.match(await page.getByTestId('messages').textContent(), scenario === 'non-ok' ? /Created 1 VPN accounts/ : /Failed to process import/);
    assert.deepEqual(requests.slice(0, 3), [{ path: '/api/admin/vpn-import', method: 'GET', body: null, csrf: undefined }, { path: '/api/admin/vpn-import/process', method: 'POST', body: '{"importId":"import-1"}', csrf: 'synthetic-vpn-csrf' }, { path: '/api/admin/vpn-import', method: 'GET', body: null, csrf: undefined }]);
    await page.close();
  }
  const page = await browser.newPage();
  await guardPage(page);
  const deletes = [];
  await page.route('**/api/**', async (route) => { deletes.push(route.request().method()); return route.abort(); });
  await page.goto(`${origin}/vpn-import-doctor-fixture`, { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: 'Open clear' }).click();
  await page.getByRole('button', { name: 'Cancel clear' }).click();
  assert.deepEqual(deletes, [], 'clear cancellation must not issue DELETE');
  await page.close();
  assert.deepEqual(externalRequests, [], 'all non-local requests must be blocked');
  assert.deepEqual(browserErrors, [], 'the fixture must not throw browser errors');
  console.log('PASS: real VPN import hook preserves POST body, refresh ordering, non-OK skip, thrown refresh failure, and clear cancellation with local-only mocks.');
} finally { await browser.close(); await server.close(); }
