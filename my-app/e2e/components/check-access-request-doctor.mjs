import assert from 'node:assert/strict';
import { createServer } from 'vite';
import { chromium } from '@playwright/test';
import ts from 'typescript';

const root = process.cwd();
const server = await createServer({
  configFile: false,
  root,
  logLevel: 'error',
  resolve: { dedupe: ['react', 'react-dom'], alias: { '@': root } },
  plugins: [{
    name: 'access-request-doctor',
    transform(code, id) {
      if (id.endsWith('.tsx') && !id.includes('node_modules')) return ts.transpileModule(code, { compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
    },
    configureServer(vite) {
      vite.middlewares.use(async (req, res, next) => {
        if (!req.url?.startsWith('/access-request-doctor-fixture')) return next();
        res.setHeader('content-type', 'text/html');
        res.end(await vite.transformIndexHtml(req.url, '<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><div id="root"></div><script type="module" src="/e2e/components/access-request-doctor.fixture.tsx"></script>'));
      });
    },
  }],
  server: { host: '127.0.0.1', port: 0 },
});
await server.listen();
const origin = `http://127.0.0.1:${server.httpServer.address().port}`;
const browser = await chromium.launch({ headless: true });
try {
  const external = [];
  for (const width of [390, 1280]) {
    const page = await browser.newPage({ viewport: { width, height: 900 } });
    await page.route('**/*', async (route) => {
      if (!route.request().url().startsWith(origin)) { external.push(route.request().url()); return route.abort(); }
      return route.continue();
    });
    await page.goto(`${origin}/access-request-doctor-fixture`);
    await page.getByText('Request version: 7').waitFor();
    await page.getByText('Current review stage: Faculty Review').waitFor();
    for (const field of ['Taylor Example', 'taylor@example.test', 'Example Institute', 'Conference access', 'texample', 'texample-vpn', 'Director Example', 'Faculty Example']) await page.getByText(field, { exact: true }).waitFor();
    assert.equal(await page.getByRole('button', { name: /approve|provision|create ad/i }).count(), 0, 'capability-negative fixture exposes no high-risk action');
    await page.getByRole('button', { name: 'Retry local request' }).click();
    await page.getByText('Retries: 1').waitFor();
    await page.close();
  }
  assert.deepEqual(external, [], 'fixture aborts all non-local requests');
  console.log('PASS: actual metadata component preserves request fields, review/version context, capability-negative actions, and local retry at 390px and 1280px.');
} finally {
  await browser.close();
  await server.close();
}
