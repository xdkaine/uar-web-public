import assert from 'node:assert/strict';
import AxeBuilder from '@axe-core/playwright';
import { chromium } from '@playwright/test';
import { createServer } from 'vite';
import ts from 'typescript';

const root = process.cwd();
async function waitForVisibleText(page, text) {
  await page.waitForFunction((expectedText) => Array.from(document.querySelectorAll('body *')).some((element) => element.textContent?.trim() === expectedText && element.checkVisibility()), text);
}

const server = await createServer({
  configFile: false,
  root,
  cacheDir: 'node_modules/.vite-react-doctor-access-requests',
  resolve: { dedupe: ['react', 'react-dom'], alias: [{ find: '@', replacement: root }] },
  server: { host: '127.0.0.1', port: 0 },
  plugins: [{
    name: 'access-requests-doctor-fixture',
    enforce: 'pre',
    resolveId(id) {
      return id === 'next/link' ? '\0access-requests-fixture-next-link' : null;
    },
    load(id) {
      if (id === '\0access-requests-fixture-next-link') {
        return "import { createElement } from 'react'; export default function Link({ href, children, passHref: _passHref, ...props }) { return createElement('a', { ...props, href }, children); }";
      }
    },
    transform(code, id) {
      if (id.endsWith('.tsx') && !id.includes('node_modules')) return ts.transpileModule(code, { compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
    },
    configureServer(vite) {
      vite.middlewares.use(async (req, res, next) => {
        if (!req.url?.startsWith('/access-requests-doctor-fixture')) return next();
        res.setHeader('content-type', 'text/html');
        res.end(await vite.transformIndexHtml(req.url, '<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>Access requests fixture</title></head><body style="margin:0"><div id="root"></div><script type="module" src="/e2e/components/access-requests-list-doctor.fixture.tsx"></script></body></html>'));
      });
    },
  }],
});

await server.listen();
const origin = `http://127.0.0.1:${server.httpServer.address().port}`;
const browser = await chromium.launch({ headless: true });

const pendingRequest = {
  id: 'request-pending', createdAt: '2026-09-04T14:15:16.000Z', name: 'Pending Request', email: 'pending@example.test', isInternal: false, needsDomainAccount: false, institution: 'Fixture College', eventReason: 'Fixture event', isVerified: false, status: 'pending_verification', accountExpiresAt: '2026-12-01T00:00:00.000Z',
};
const approvedRequest = {
  id: 'request-approved', createdAt: '2026-09-03T14:15:16.000Z', name: 'Approved Request', email: 'approved@example.test', isInternal: true, needsDomainAccount: true, event: { id: 'event-fixture', name: 'Fixture event' }, isVerified: true, status: 'approved',
};
const summary = { total: 12, pending_verification: 1, approved: 1, internal: 1, external: 1, verified: 1 };
const reviewStageBuckets = [{ workflowVersionId: 'workflow-fixture', workflowVersion: 1, workflowSource: 'pinned', stageKey: 'faculty', label: 'Pending Faculty', count: 1 }];

try {
  for (const width of [390, 1280]) {
    const context = await browser.newContext({ viewport: { width, height: 1000 } });
    const page = await context.newPage();
    const browserErrors = [];
    const externalRequests = [];
    const requests = [];
    let cursorStarted;
    const cursorStartedPromise = new Promise((resolve) => { cursorStarted = resolve; });
    await context.addCookies([{ name: 'csrf-token', value: 'fixture-csrf', url: origin }]);
    page.on('pageerror', (error) => browserErrors.push(error.message));
    await page.route('**/*', async (route) => {
      const request = route.request();
      if (!request.url().startsWith(origin)) { externalRequests.push(request.url()); return route.abort(); }
      const url = new URL(request.url());
      if (!url.pathname.startsWith('/api/')) return route.continue();
      if (url.pathname === '/api/admin/requests' && request.method() === 'GET') {
        const query = Object.fromEntries(url.searchParams);
        requests.push({ method: 'GET', query });
        if (query.cursor === 'cursor-page-2') {
          cursorStarted();
          await new Promise((resolve) => setTimeout(resolve, 250));
          return route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'stale cursor request failed' }) });
        }
        const items = query.status === 'approved' ? [approvedRequest] : [pendingRequest, approvedRequest];
        return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ items, pageInfo: { total: 12, nextCursor: 'cursor-page-2' }, summary, reviewStageBuckets }) });
      }
      if (url.pathname === '/api/admin/requests/request-pending/resend-verification' && request.method() === 'POST') {
        requests.push({ method: 'POST', csrf: request.headers()['x-csrf-token'] });
        return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ message: 'Fixture verification email queued' }) });
      }
      return route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ error: `Unexpected fixture API ${request.method()} ${url.pathname}` }) });
    });

    await page.goto(`${origin}/access-requests-doctor-fixture`);
    await waitForVisibleText(page, 'Pending Request');
    assert.equal(await page.getByLabel('Search requests').count(), 1, 'the visible search control has an accessible name');
    await page.getByRole('button', { name: 'Advanced Filters', exact: true }).click();
    await page.getByLabel('Request Status').waitFor();

    if (width === 1280) {
      await page.getByRole('button', { name: 'Actions for Pending Request' }).click();
      await page.getByRole('menuitem', { name: 'Resend Email' }).click();
      await page.getByText('Fixture verification email queued', { exact: true }).waitFor();
    }

    const nextPage = page.getByRole('button', { name: 'Next page', exact: true });
    await nextPage.click();
    await cursorStartedPromise;
    await page.getByLabel('Request Status').click();
    await page.getByRole('option', { name: 'Approved', exact: true }).click();
    await waitForVisibleText(page, 'Approved Request');
    assert.equal(await page.getByText('Stale Cursor Request', { exact: true }).count(), 0, 'a stale cursor result or error cannot replace the newer filter selection');

    await page.getByRole('button', { name: 'Refresh', exact: true }).click();
    await page.waitForTimeout(80);
    const approvedQueries = requests.filter((entry) => entry.method === 'GET' && entry.query.status === 'approved');
    assert.ok(approvedQueries.length > 0, 'changing status fetches the selected server filter');
    assert.equal(approvedQueries.at(-1).query.cursor, undefined, 'a filter change resets the cursor before fetching');
    assert.equal(await page.getByLabel('Request Status').getAttribute('role'), 'combobox', 'visible select text names its trigger');
    const axe = await new AxeBuilder({ page }).withRules(['label', 'button-name']).analyze();
    assert.equal(axe.violations.length, 0, `axe violations: ${axe.violations.map((violation) => violation.id).join(', ')}`);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, 'list controls must not overflow the viewport');
    if (width === 1280) assert.ok(requests.some((entry) => entry.method === 'POST' && entry.csrf === 'fixture-csrf'), 'the resend action retains its CSRF header');
    assert.deepEqual(externalRequests, [], 'fixture aborts every non-local request');
    assert.deepEqual(browserErrors, [], `browser errors: ${browserErrors.join('\n')}`);
    await context.close();
  }
  console.log('PASS: Access-request fixture validates 390/1280 layouts, filter and cursor behavior, stale-request protection, selection persistence, CSRF resend, keyboard-labelled controls, axe labels/buttons, and local-only requests.');
} finally {
  await browser.close();
  await server.close();
}
