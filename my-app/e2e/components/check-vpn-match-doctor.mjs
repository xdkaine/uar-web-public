import assert from 'node:assert/strict';
import { chromium } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { createServer } from 'vite';
import ts from 'typescript';
import { checkVPNMatchBehavior } from './vpn-match-behavior-checks.mjs';

const root = process.cwd();
const server = await createServer({
  configFile: false, root, cacheDir: 'node_modules/.vite-vpn-match-doctor', logLevel: 'error',
  resolve: { dedupe: ['react', 'react-dom'], alias: [{ find: '@', replacement: root }] },
  server: { host: '127.0.0.1', port: 0 },
  plugins: [{
    name: 'vpn-match-fixture',
    transform(code, id) {
      if (id.endsWith('.tsx') && !id.includes('node_modules')) return ts.transpileModule(code, {
        compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
      }).outputText;
    },
    configureServer(vite) {
      vite.middlewares.use(async (request, response, next) => {
        if (!request.url?.startsWith('/vpn-match-fixture')) return next();
        response.setHeader('content-type', 'text/html');
        response.end(await vite.transformIndexHtml(request.url, '<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script type="module" src="/e2e/components/vpn-match-doctor.fixture.tsx"></script></body></html>'));
      });
    },
  }],
});
await server.listen();
const origin = `http://127.0.0.1:${server.httpServer.address().port}`;
const browser = await chromium.launch({ headless: true });
try {
  if (process.argv[2]) {
    await checkVPNMatchBehavior(browser, origin, process.argv[2]);
  } else {
  for (const width of [390, 1280]) {
    for (const finishLoading of [false, true]) {
      const context = await browser.newContext({ viewport: { width, height: 1000 } });
      const page = await context.newPage();
      page.setDefaultTimeout(10000);
      const errors = [];
      const requests = [];
      let release;
      const gate = new Promise(resolve => { release = resolve; });
      page.on('pageerror', error => errors.push(error.message));
      await page.route('**/*', async route => {
        const request = route.request();
        const url = new URL(request.url());
        if (url.origin !== origin) { errors.push('Blocked external request'); return route.abort(); }
        if (!url.pathname.startsWith('/api/')) return route.continue();
        requests.push({ method: request.method(), path: url.pathname });
        if (request.method() !== 'GET' || url.pathname !== '/api/admin/vpn-import/synthetic-import') return route.abort();
        await gate;
        return route.fulfill({ json: { data: {
          id: 'synthetic-import', createdAt: '2026-01-01T00:00:00Z', portalType: 'Internal', fileName: 'synthetic.csv',
          importedBy: 'fixture', totalRecords: 1, matchedRecords: 0, status: 'pending',
          importRecords: [{ id: 'synthetic-record', vpnUsername: 'fixture.user', matchStatus: 'unmatched' }],
        } } });
      });
      try {
        await page.goto(`${origin}/vpn-match-fixture`, { waitUntil: 'domcontentloaded', timeout: 60000 });
        await page.getByRole('dialog', { name: 'Match VPN Users to Active Directory', exact: true }).waitFor();
        assert.deepEqual((await new AxeBuilder({ page }).withRules(['aria-dialog-name']).analyze()).violations, []);
        if (finishLoading) {
          release();
          await page.getByText('synthetic.csv', { exact: false }).waitFor();
          await page.getByRole('dialog', { name: 'Match VPN Users to Active Directory', exact: true }).waitFor();
        }
        await page.keyboard.press('Escape');
        await page.getByText('Matching closed', { exact: true }).waitFor();
        assert.deepEqual(requests, [{ method: 'GET', path: '/api/admin/vpn-import/synthetic-import' }]);
        assert.deepEqual(errors, []);
      } finally { release(); await context.close(); }
    }
  }
  console.log('PASS: VPN matching loading and loaded dialogs are named and Escape closes without writes at 390/1280.');
  }
} finally { await browser.close(); await server.close(); }
