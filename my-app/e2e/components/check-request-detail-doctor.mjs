import assert from 'node:assert/strict';
import { createServer } from 'vite';
import { chromium } from '@playwright/test';
import ts from 'typescript';

const root = process.cwd();
const mocks = {
  'next/link': `import React from 'react'; export default function Link({href,children,...props}){return React.createElement('a',{href,...props},children)}`,
  '@/hooks/useToast': `const showToast=(message,variant)=>window.__requestDetailDoctor.toasts.push({message,variant}); export function useToast(){return {showToast}}`,
  '@/components/ui/dialog': `import React from 'react'; export function Dialog({children}){return React.createElement('section',{'data-dialog':'true'},children)} export function DialogContent({children,...props}){return React.createElement('div',props,children)} export function DialogHeader({children,...props}){return React.createElement('header',props,children)} export function DialogTitle({children,...props}){return React.createElement('h2',props,children)}`,
};

const server = await createServer({
  configFile: false,
  root,
  logLevel: 'error',
  resolve: { dedupe: ['react', 'react-dom'], alias: [...Object.keys(mocks).map((key) => ({ find: key, replacement: `\0request-detail-doctor:${key}` })), { find: '@', replacement: root }] },
  server: { host: '127.0.0.1', port: 0 },
  plugins: [{
    name: 'request-detail-doctor',
    enforce: 'pre',
    resolveId(id) { if (id.startsWith('\0request-detail-doctor:')) return id; if (Object.hasOwn(mocks, id)) return `\0request-detail-doctor:${id}`; },
    load(id) { if (id.startsWith('\0request-detail-doctor:')) return mocks[id.slice('\0request-detail-doctor:'.length)]; },
    transform(code, id) { if (id.endsWith('.tsx') && !id.includes('node_modules')) return ts.transpileModule(code, { compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText; },
    configureServer(vite) { vite.middlewares.use(async (req, res, next) => { if (!req.url?.startsWith('/request-detail-doctor-fixture')) return next(); res.setHeader('content-type', 'text/html'); res.end(await vite.transformIndexHtml(req.url, '<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script type="module" src="/e2e/components/request-detail-doctor.fixture.tsx"></script></body></html>')); }); },
  }],
});

await server.listen();
const origin = `http://127.0.0.1:${server.httpServer.address().port}`;
const browser = await chromium.launch({ headless: true });

try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } });
  const browserErrors = []; const consoleErrors = []; const externalRequests = [];
  page.on('pageerror', (error) => browserErrors.push(error.message));
  page.on('console', (message) => { if (message.type() === 'error') consoleErrors.push(message.text()); });
  await page.addInitScript(() => {
    const pending = new Map();
    window.__requestDetailDoctor = {
      pending,
      toasts: [],
      resolve(id, { status = 200, body }) {
        const entry = pending.get(id);
        if (!entry) throw new Error(`No pending request for ${id}`);
        pending.delete(id);
        entry.resolve(new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }));
      },
    };
    window.fetch = (input, init = {}) => new Promise((resolve) => {
      const id = new URL(typeof input === 'string' ? input : input.url, location.href).pathname.split('/').at(-1);
      const entry = { resolve, aborted: false };
      window.__requestDetailDoctor.pending.set(id, entry);
      init.signal?.addEventListener('abort', () => { entry.aborted = true; });
    });
  });
  await page.route('**/*', async (route) => {
    if (!route.request().url().startsWith(origin)) { externalRequests.push(route.request().url()); return route.abort(); }
    return route.continue();
  });
  await page.goto(`${origin}/request-detail-doctor-fixture`, { timeout: 20_000 });
  page.setDefaultTimeout(5_000);
  await page.waitForFunction(() => window.__requestDetailDoctor.pending.has('old-request'));
  await page.evaluate(() => window.__requestDetailDoctor.resolve('old-request', { body: { id: 'old-request', name: 'Old Request', email: 'old@example.test', isInternal: false, needsDomainAccount: false, isVerified: true, status: 'approved', createdAt: '2026-09-04T00:00:00.000Z', updatedAt: '2026-09-04T00:00:00.000Z' } }));
  await page.getByRole('heading', { name: 'Old Request' }).waitFor();
  await page.getByRole('button', { name: 'Load stale request' }).click();
  await page.waitForFunction(() => window.__requestDetailDoctor.pending.has('stale-request'));
  await page.getByRole('heading', { name: 'Loading...' }).waitFor();
  assert.equal(await page.getByRole('heading', { name: 'Old Request' }).count(), 0, 'the prior record is not visible while its replacement loads');
  await page.getByRole('button', { name: 'Load wrapped request' }).click();
  await page.waitForFunction(() => window.__requestDetailDoctor.pending.has('wrapped-request'));
  assert.equal(await page.evaluate(() => window.__requestDetailDoctor.pending.get('stale-request').aborted), true, 'request-ID replacement aborts the prior transport');
  await page.evaluate(() => window.__requestDetailDoctor.resolve('wrapped-request', { body: { request: { id: 'wrapped-request', name: 'Wrapped Request', email: 'wrapped@example.test', isInternal: true, needsDomainAccount: false, isVerified: true, status: 'pending_faculty', createdAt: '2026-09-04T00:00:00.000Z', updatedAt: '2026-09-04T00:00:00.000Z' }, review: { currentStage: { label: 'Faculty Review' } } } }));
  await page.getByRole('heading', { name: 'Wrapped Request' }).waitFor();
  await page.getByText('FACULTY REVIEW').waitFor();
  await page.evaluate(() => window.__requestDetailDoctor.resolve('stale-request', { status: 500, body: { error: 'Stale request must not toast' } }));
  await page.waitForTimeout(20);
  await page.getByRole('heading', { name: 'Wrapped Request' }).waitFor();
  assert.deepEqual(await page.evaluate(() => window.__requestDetailDoctor.toasts), [], 'stale rejected completion cannot toast');
  await page.getByRole('button', { name: 'Load direct request' }).click();
  await page.waitForFunction(() => window.__requestDetailDoctor.pending.has('direct-request'));
  await page.evaluate(() => window.__requestDetailDoctor.resolve('direct-request', { body: { id: 'direct-request', name: 'Direct Request', email: 'direct@example.test', isInternal: false, needsDomainAccount: false, isVerified: true, status: 'approved', createdAt: '2026-09-04T00:00:00.000Z', updatedAt: '2026-09-04T00:00:00.000Z' } }));
  await page.getByRole('heading', { name: 'Direct Request' }).waitFor();
  await page.getByText('APPROVED').waitFor();
  await page.getByRole('button', { name: 'Load unmount request' }).click();
  await page.waitForFunction(() => window.__requestDetailDoctor.pending.has('unmount-request'));
  await page.getByRole('button', { name: 'Unmount modal' }).click();
  assert.equal(await page.evaluate(() => window.__requestDetailDoctor.pending.get('unmount-request').aborted), true, 'unmount aborts the active transport');
  await page.evaluate(() => window.__requestDetailDoctor.resolve('unmount-request', { status: 500, body: { error: 'Unmounted request must not toast' } }));
  await page.waitForTimeout(20);
  assert.deepEqual(await page.evaluate(() => window.__requestDetailDoctor.toasts), [], 'unmounted completion cannot toast');
  assert.deepEqual(externalRequests, [], 'fixture aborts all external requests');
  assert.deepEqual(browserErrors, [], `browser errors: ${browserErrors.join('\n')}`);
  assert.deepEqual(consoleErrors, [], `console errors: ${consoleErrors.join('\n')}`);
  console.log('PASS: reverse completion cannot replace a newer wrapped request or toast; direct responses and unmount cancellation preserve ownership.');
  await page.close();
} finally {
  await browser.close();
  await server.close();
}
