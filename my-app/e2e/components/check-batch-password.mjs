import assert from 'node:assert/strict';
import { chromium } from '@playwright/test';
import { createServer } from 'vite';
import ts from 'typescript';
import ExcelJS from 'exceljs';

const workbook = new ExcelJS.Workbook();
await workbook.xlsx.readFile('public/templates/batch-account-template.xlsx');
assert.deepEqual(workbook.worksheets.map(sheet => sheet.name), ['AD accounts', 'VPN accounts', 'Instructions']);
for (let index = 0; index < 5; index++) workbook.getWorksheet('AD accounts').getRow(index + 2).values = [`AD person ${index}`, `ad${index}@example.test`, `0000${index}`, ' literal password ', '', true];
for (let index = 0; index < 3; index++) workbook.getWorksheet('VPN accounts').getRow(index + 2).values = [`VPN person ${index}`, '', `vpn${index}`, 'vpn-password', '2030-01-01', 'External'];
const sample = Buffer.from(await workbook.xlsx.writeBuffer());

const root = process.cwd();
const server = await createServer({ configFile: false, root, cacheDir: 'node_modules/.vite-batch-password', logLevel: 'error', resolve: { dedupe: ['react', 'react-dom'], alias: [{ find: '@', replacement: root }] }, server: { host: '127.0.0.1', port: 0 }, plugins: [{ name: 'batch-password-fixture', transform(code, id) { return id.endsWith('.tsx') && !id.includes('node_modules') ? ts.transpileModule(code, { compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText : undefined; }, configureServer(vite) { vite.middlewares.use(async (request, response, next) => { if (!request.url?.startsWith('/batch-password-fixture')) return next(); response.setHeader('content-type', 'text/html'); response.end(await vite.transformIndexHtml(request.url, '<!doctype html><div id="root"></div><script type="module" src="/e2e/components/batch-password.fixture.tsx"></script>')); }); } }] });
await server.listen();
const origin = `http://127.0.0.1:${server.httpServer.address().port}`;
let browser;
try {
  browser = await chromium.launch({ headless: true });
  for (const width of [390, 1280]) {
    const page = await browser.newPage({ viewport: { width, height: 800 } });
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    await page.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
    await page.goto(`${origin}/batch-password-fixture`);
    const input = page.getByLabel('Initial password');
    assert.equal(await input.getAttribute('type'), 'password');
    await page.getByRole('button', { name: 'Show password' }).click();
    assert.equal(await input.getAttribute('type'), 'text');
    await page.getByRole('button', { name: 'Generate password' }).click();
    assert.equal(await input.inputValue(), 'new-generated-password');
    await page.getByRole('button', { name: 'Hide password' }).click();
    assert.equal(await input.getAttribute('type'), 'password');
    const download = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Download template' }).click();
    assert.equal((await download).suggestedFilename(), 'batch-account-template.xlsx');
    await page.getByLabel('Import workbook').setInputFiles({ name: 'batch.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer: sample });
    await page.getByTestId('import-result').filter({ hasText: '5 AD / 3 VPN / 00000 /  literal password ' }).waitFor();
    await page.getByLabel('Import workbook').setInputFiles({ name: 'bad.csv', mimeType: 'text/csv', buffer: Buffer.from('invalid') });
    await page.getByTestId('import-result').filter({ hasText: 'Choose an .xlsx workbook.' }).waitFor();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
    assert.deepEqual(errors, []); await page.close();
  }
  console.log('PASS: desktop/mobile password show/hide/generate, template download, actual 5 AD + 3 VPN XLSX import, exact password/username and invalid-file handling without external network.');
} finally { await browser?.close(); await server.close(); }
