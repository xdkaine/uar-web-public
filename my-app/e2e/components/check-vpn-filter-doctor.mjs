import assert from 'node:assert/strict';
import AxeBuilder from '@axe-core/playwright';
import { chromium } from '@playwright/test';
import { createServer } from 'vite';
import ts from 'typescript';

const root = process.cwd();
const server = await createServer({
  configFile: false,
  root,
  cacheDir: 'node_modules/.vite-react-doctor-vpn-filter',
  resolve: { dedupe: ['react', 'react-dom'], alias: [{ find: '@', replacement: root }] },
  server: { host: '127.0.0.1', port: 0 },
  plugins: [{
    name: 'vpn-filter-doctor-fixture',
    enforce: 'pre',
    transform(code, id) {
      if (id.endsWith('.tsx') && !id.includes('node_modules')) return ts.transpileModule(code, { compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
    },
    configureServer(vite) {
      vite.middlewares.use(async (req, res, next) => {
        if (!req.url?.startsWith('/vpn-filter-doctor-fixture')) return next();
        res.setHeader('content-type', 'text/html');
        res.end(await vite.transformIndexHtml(req.url, '<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>VPN filter fixture</title></head><body style="margin:0"><div id="root"></div><script type="module" src="/e2e/components/vpn-filter-doctor.fixture.tsx"></script></body></html>'));
      });
    },
  }],
});

await server.listen();
const origin = `http://127.0.0.1:${server.httpServer.address().port}`;
const browser = await chromium.launch({ headless: true });

async function selectOption(page, label, option) {
  await page.getByLabel(label).click();
  await page.getByRole('option', { name: option, exact: true }).click();
}

try {
  for (const width of [390, 1280]) {
    const context = await browser.newContext({ viewport: { width, height: 900 } });
    const page = await context.newPage();
    const browserErrors = [];
    const externalRequests = [];
    page.on('pageerror', (error) => browserErrors.push(error.message));
    await page.route('**/*', async (route) => {
      if (route.request().url().startsWith(origin)) return route.continue();
      externalRequests.push(route.request().url());
      return route.abort();
    });

    await page.goto(`${origin}/vpn-filter-doctor-fixture`);
    const state = page.getByTestId('filter-state');
    const search = page.getByLabel('Search VPN accounts');
    assert.match(await search.ariaSnapshot(), /textbox "Search VPN accounts"/);
    assert.match(await page.getByLabel('VPN account status').ariaSnapshot(), /combobox "VPN account status"/);
    await search.fill('jordan');
    const clearSearch = page.getByRole('button', { name: 'Clear search', exact: true });
    assert.match(await clearSearch.ariaSnapshot(), /button "Clear search"/);
    await clearSearch.focus();
    await page.keyboard.press('Space');
    await page.waitForFunction(() => document.querySelector('[data-testid="filter-state"]')?.textContent?.includes('search=;'));
    assert.equal(await search.inputValue(), '');
    assert.match(await state.textContent(), /submissions=0/, 'clearing search must not submit an enclosing form');

    await selectOption(page, 'VPN account status', 'Active');
    await selectOption(page, 'VPN portal', 'Management');
    assert.match(await state.textContent(), /status=active;portal=Management/);
    await page.getByRole('button', { name: /^Filters/ }).click();
    await selectOption(page, 'Faculty approval', 'Approved');
    await selectOption(page, 'VPN results view', 'Split by Portal');
    assert.match(await state.textContent(), /faculty=approved;view=split/);

    await page.getByRole('button', { name: 'Refresh VPN accounts', exact: true }).click();
    assert.match(await state.textContent(), /refreshes=1/);
    const axe = await new AxeBuilder({ page }).withRules(['label', 'button-name']).analyze();
    assert.equal(axe.violations.length, 0, `axe violations: ${axe.violations.map((violation) => violation.id).join(', ')}`);
    const overflow = await page.evaluate(() => Array.from(document.querySelectorAll('body *'))
      .filter((element) => element.getBoundingClientRect().right > innerWidth + 1)
      .slice(0, 5)
      .map((element) => ({ tag: element.tagName, className: element.className, right: element.getBoundingClientRect().right })));
    assert.deepEqual(overflow, [], `filter controls must not overflow the viewport: ${JSON.stringify(overflow)}`);
    assert.deepEqual(externalRequests, [], 'fixture aborts every non-local request');
    assert.deepEqual(browserErrors, [], `browser errors: ${browserErrors.join('\n')}`);
    await context.close();
  }
  console.log('PASS: VPN filter fixture validates 390/1280 layouts, accessible names, keyboard clear without form submission, controlled filter callbacks, axe labels/buttons, and local-only requests.');
} finally {
  await browser.close();
  await server.close();
}
