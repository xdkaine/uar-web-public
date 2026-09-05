import assert from 'node:assert/strict';

import { chromium } from '@playwright/test';
import { createServer } from 'vite';
import ts from 'typescript';

const root = process.cwd();
const mocks = {
  '@/lib/client-query': `export async function fetchJson(key) { return key === '/api/admin/config/appearance' ? window.appearanceFixtureData : key.endsWith('/pages') ? { revisions: [] } : { items: [], pageInfo: { total: 0, nextCursor: null, hasNext: false } }; }`,
  '@/components/PortalNav': `import React from 'react'; export default function PortalNav({ sessionState, logoUrl }) { return React.createElement('div', { 'data-session': sessionState, 'data-logo': logoUrl }, 'Portal navigation'); }`,
  '@/components/appearance/ManagedPageRegion': `import React from 'react'; export function ManagedPageRegion() { return React.createElement('div', null, 'Managed region'); }`,
  '@/components/appearance/PortalPageHeading': `import React from 'react'; export function PortalPageHeadingView({ content }) { return React.createElement('div', null, content.title); }`,
  '@/components/admin/config/CodeEditor': `import React from 'react'; export function CodeEditor({ value, onChange, ariaLabel }) { return React.createElement('textarea', { 'aria-label': ariaLabel, value, onChange: (event) => onChange(event.target.value) }); }`,
  '@/lib/csrf': `export async function fetchWithCsrf(url, init) { window.appearanceSave = JSON.parse(init.body); return fetch(url, { ...init, headers: { ...init.headers, 'x-csrf-token': 'fixture-csrf' } }); }`,
  '@/lib/use-appearance': `export async function revalidateAppearance() { return window.appearancePublic; }`,
};
const server = await createServer({
  configFile: false,
  root,
  cacheDir: 'node_modules/.vite-react-doctor-appearance',
  logLevel: 'error',
  resolve: { dedupe: ['react', 'react-dom'], alias: [...Object.keys(mocks).map((key) => ({ find: key, replacement: `\0appearance-doctor:${key}` })), { find: '@', replacement: root }] },
  server: { host: '127.0.0.1', port: 0 },
  plugins: [{
    name: 'appearance-doctor',
    enforce: 'pre',
    resolveId(id) { if (id.startsWith('\0appearance-doctor:')) return id; if (Object.hasOwn(mocks, id)) return `\0appearance-doctor:${id}`; },
    load(id) { if (id.startsWith('\0appearance-doctor:')) return mocks[id.slice('\0appearance-doctor:'.length)]; },
    transform(code, id) { if (id.endsWith('.tsx') && !id.includes('node_modules')) return ts.transpileModule(code, { compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText; },
    configureServer(vite) { vite.middlewares.use(async (request, response, next) => { if (!request.url?.startsWith('/appearance-doctor-fixture')) return next(); response.setHeader('content-type', 'text/html'); response.end(await vite.transformIndexHtml(request.url, '<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script type="module" src="/e2e/components/appearance-doctor.fixture.tsx"></script></body></html>')); }); },
  }],
});
await server.listen();
const origin = `http://127.0.0.1:${server.httpServer.address().port}`;
const browser = await chromium.launch({ headless: true });
const widths = process.env.APPEARANCE_DOCTOR_WIDTHS?.split(',').map(Number) ?? [390, 1280];

try {
  for (const width of widths) {
    const page = await browser.newPage({ viewport: { width, height: 1000 } });
    const external = [];
    const errors = [];
    let saves = 0;
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('requestfailed', (request) => errors.push(`${request.method()} ${new URL(request.url()).pathname}: ${request.failure()?.errorText}`));
    await page.route('**/*', async (route) => {
      const request = route.request();
      if (!request.url().startsWith(origin)) { external.push(request.url()); return route.abort(); }
      const url = new URL(request.url());
      if (url.pathname === '/appearance-doctor-fixture') return route.continue();
      if (url.pathname === '/api/admin/config/appearance' && request.method() === 'PUT') {
        saves += 1;
        assert.equal(request.headers()['x-csrf-token'], 'fixture-csrf');
        if (saves === 1) return route.fulfill({ status: 422, contentType: 'application/json', body: JSON.stringify({ error: 'Fixture appearance policy rejected this save.' }) });
        const values = JSON.parse(request.postData()).values;
        await page.evaluate((data) => {
          const fixture = window.appearanceFixtureData;
          const pages = Object.fromEntries(['home', 'requestInternal', 'requestExternal', 'supportTickets', 'supportCreate', 'supportTicketDetail', 'profile']
            .map((id) => [id, JSON.parse(fixture[`pages.${id}`])]));
          for (const [key, value] of Object.entries(data)) {
            if (key.startsWith('pages.') && value) pages[key.slice(6)] = JSON.parse(value);
          }
          window.appearancePublic = {
            theme: data['appearance.theme'] ? JSON.parse(data['appearance.theme']) : JSON.parse(fixture['appearance.theme']),
            navLinks: data['nav.links'] ? JSON.parse(data['nav.links']) : JSON.parse(fixture['nav.links']),
            pages,
          };
        }, values);
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({}) });
      }
      if (!url.pathname.startsWith('/api/')) return route.continue();
      return route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ error: `Unexpected fixture API ${url.pathname}` }) });
    });
    await page.goto(`${origin}/appearance-doctor-fixture`);
    await page.getByText('Portal theme tokens', { exact: true }).waitFor({ timeout: 10000 }).catch(async () => {
      throw new Error(`Appearance fixture did not render: ${errors.join('\n')} ${await page.locator('body').innerText()}`);
    });
    const accent = page.locator('#theme-accent');
    await accent.fill('#123456');
    assert.equal(await page.locator('[data-logo="/fixture.svg"]').count(), 1);
    await page.getByRole('button', { name: 'Navigation' }).focus();
    await page.keyboard.press('Enter');
    await page.getByRole('button', { name: 'Signed-in user' }).focus();
    await page.keyboard.press('Enter');
    assert.equal(await page.getByRole('button', { name: 'Signed-in user' }).getAttribute('aria-pressed'), 'true');
    await page.getByRole('button', { name: 'Theme' }).click();
    await page.getByRole('button', { name: 'Save appearance' }).click();
    await page.getByText('Fixture appearance policy rejected this save.').waitFor();
    await page.getByRole('button', { name: 'Save appearance' }).click();
    await page.getByRole('alert').waitFor();
    assert.equal(await page.getByRole('alert').innerText(), 'Appearance saved and verified on the public portal.', await page.evaluate(() => JSON.stringify({ save: window.appearanceSave, public: window.appearancePublic })));
    const dimensions = await page.evaluate(() => ({ client: document.documentElement.clientWidth, scroll: document.documentElement.scrollWidth }));
    assert.ok(dimensions.scroll <= dimensions.client, `horizontal overflow: ${dimensions.scroll} > ${dimensions.client}`);
    assert.deepEqual(external, []);
    assert.deepEqual(errors, []);
    await page.close();
  }
  console.log('PASS: appearance fixture validates keyboard sections and preview state, theme editing, local save error/retry/read-back, external-request aborts, and 390/1280 layouts.');
} finally {
  await browser.close();
  await server.close();
}
