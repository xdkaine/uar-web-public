import assert from 'node:assert/strict';
import { chromium } from '@playwright/test';
import { createServer } from 'vite';
import ts from 'typescript';

const root = process.cwd();
const server = await createServer({
  configFile: false, root, cacheDir: 'node_modules/.vite-batch-export', logLevel: 'error',
  resolve: { dedupe: ['react', 'react-dom'], alias: [{ find: '@', replacement: root }] },
  server: { host: '127.0.0.1', port: 0 },
  plugins: [{
    name: 'batch-export-fixture',
    transform(code, id) {
      return id.endsWith('.tsx') && !id.includes('node_modules')
        ? ts.transpileModule(code, { compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText : undefined;
    },
    configureServer(vite) {
      vite.middlewares.use(async (request, response, next) => {
        if (!request.url?.startsWith('/batch-export-fixture')) return next();
        response.setHeader('content-type', 'text/html');
        response.end(await vite.transformIndexHtml(request.url, '<!doctype html><div id="root"></div><script type="module" src="/e2e/components/batch-export.fixture.tsx"></script>'));
      });
    },
  }],
});
await server.listen();
const origin = `http://127.0.0.1:${server.httpServer.address().port}`;
let browser;
try {
  browser = await chromium.launch({ headless: true });
  for (const width of [390, 1280]) {
    const page = await browser.newPage({ viewport: { width, height: 800 } });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.context().addCookies([{ name: 'csrf-token', value: 'synthetic-csrf', url: origin }]);
    let fail = true;
    let posts = 0;
    await page.route('**/*', async route => {
      if (new URL(route.request().url()).origin !== origin) return route.abort();
      if (route.request().url().endsWith('/api/admin/batch-accounts/batch-1/export')) {
        assert.equal(route.request().method(), 'POST');
        assert.equal(route.request().headers()['x-csrf-token'], 'synthetic-csrf');
        posts++;
        return fail
          ? route.fulfill({ status: 500, json: { error: 'Export failed safely' } })
          : route.fulfill({ contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', body: Buffer.from([80, 75]) });
      }
      return route.continue();
    });
    await page.goto(`${origin}/batch-export-fixture`);
    const button = page.getByRole('button', { name: 'Download Excel with passwords' });
    await button.click();
    await page.getByRole('alert').filter({ hasText: 'Export failed safely' }).waitFor();
    fail = false;
    const download = page.waitForEvent('download');
    await button.click();
    assert.equal((await download).suggestedFilename(), 'batch-accounts-batch-1.xlsx');
    assert.equal(await page.getByRole('alert').count(), 0);
    assert.equal(posts, 2);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
    assert.deepEqual(errors, []);
    await page.close();
  }
  console.log('PASS: batch export desktop/mobile button, visible failure, retry, CSRF POST and attachment download (local API mocks).');
} finally {
  await browser?.close();
  await server.close();
}
