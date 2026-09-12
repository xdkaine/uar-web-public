// Exercises the real picker and CSS without a database or external services.
import assert from 'node:assert/strict';
import { createServer } from 'vite';
import { chromium } from '@playwright/test';
import ts from 'typescript';

const server = await createServer({
  configFile: false,
  root: process.cwd(),
  resolve: { alias: { '@': process.cwd() } },
  server: { host: '127.0.0.1', port: 0 },
  plugins: [{
    name: 'date-time-fixture',
    enforce: 'pre',
    transform(code, id) {
      if (id.endsWith('.tsx') && !id.includes('node_modules')) {
        return ts.transpileModule(code, {
          compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
        }).outputText;
      }
    },
    configureServer(vite) {
      vite.middlewares.use(async (req, res, next) => {
        if (!req.url?.startsWith('/date-time')) return next();
        res.setHeader('content-type', 'text/html');
        res.end(await vite.transformIndexHtml(req.url, '<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script type="module" src="/e2e/components/date-time.fixture.tsx"></script></body></html>'));
      });
    },
  }],
});
await server.listen();
const origin = `http://127.0.0.1:${server.httpServer.address().port}`;
const browser = await chromium.launch({ headless: true });
try {
  for (const timezoneId of ['America/Los_Angeles', 'UTC', 'Asia/Kolkata']) {
    for (const viewport of [{ width: 1280, height: 720 }, { width: 390, height: 640 }]) {
      const context = await browser.newContext({ timezoneId, viewport });
      const page = await context.newPage();
      await page.goto(`${origin}/date-time`);
      await page.getByRole('button', { name: 'Expiration', exact: true }).click();
      const browserZone = await page.evaluate(() => Intl.DateTimeFormat().resolvedOptions().timeZone);
      await page.getByText(`Time zone: ${browserZone}.`, { exact: false }).waitFor();
      await page.getByRole('combobox', { name: 'Minute', exact: true }).click();
      const box = await page.getByRole('listbox').boundingBox();
      if (timezoneId === 'America/Los_Angeles' && viewport.width === 390) await page.screenshot({ path: '../date-time-mobile.png' });
      assert.ok(box && box.y >= 0 && box.y + box.height <= viewport.height, `Minute menu exceeds viewport: ${JSON.stringify({ timezoneId, viewport, box })}`);
      await page.getByRole('option', { name: '59', exact: true }).scrollIntoViewIfNeeded();
      await page.getByRole('option', { name: '59', exact: true }).click();
      await page.getByRole('button', { name: 'Confirm date and time' }).click();
      const value = await page.getByTestId('value').textContent();
      assert.equal(value, timezoneId === 'Asia/Kolkata' ? '2026-09-12T19:29:00.000Z' : '2026-09-12T19:59:00.000Z', `Selection must retain the instant in ${timezoneId}`);
      await context.close();
    }
  }
  const context = await browser.newContext({ timezoneId: 'America/Los_Angeles', viewport: { width: 390, height: 640 } });
  const page = await context.newPage();
  await page.goto(`${origin}/date-time?value=2026-03-08T09:30:00.000Z`);
  await page.getByRole('button', { name: 'Expiration', exact: true }).click();
  await page.getByRole('combobox', { name: 'Hour', exact: true }).click();
  await page.getByRole('option', { name: '2', exact: true }).click();
  assert.ok(await page.getByRole('alert').isVisible());
  assert.ok(await page.getByRole('button', { name: 'Confirm date and time' }).isDisabled());
  await context.close();
  const repeatedContext = await browser.newContext({ timezoneId: 'America/Los_Angeles' });
  const repeatedPage = await repeatedContext.newPage();
  await repeatedPage.goto(`${origin}/date-time?value=2026-11-01T09:30:00.000Z`);
  await repeatedPage.getByRole('button', { name: 'Expiration', exact: true }).click();
  await repeatedPage.getByRole('button', { name: 'Confirm date and time' }).click();
  assert.equal(await repeatedPage.getByTestId('value').textContent(), '2026-11-01T09:30:00.000Z');
  await repeatedContext.close();
  console.log('Picker viewport and timezone contracts passed.');
} finally {
  await browser.close();
  await server.close();
}
