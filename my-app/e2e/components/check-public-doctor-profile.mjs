// Local-only browser contract for ProfileClient state and email verification.
import assert from 'node:assert/strict';
import { createServer } from 'vite';
import { chromium } from '@playwright/test';
import ts from 'typescript';

const root = process.cwd();
const mocks = {
  'next/link': `import React from 'react'; export default function Link({ href, children, ...props }) { return React.createElement('a', { href, ...props }, children); }`,
  'next/navigation': `export function useRouter() { return { push() {}, replace() {}, back() {} }; }`,
};
const server = await createServer({
  configFile: false,
  root,
  cacheDir: 'node_modules/.vite-react-doctor-profile',
  resolve: { alias: [...Object.keys(mocks).map((key) => ({ find: key, replacement: `\0public-doctor-profile:${key}` })), { find: '@', replacement: root }] },
  server: { host: '127.0.0.1', port: 0 },
  plugins: [{
    name: 'public-doctor-profile-fixture', enforce: 'pre',
    resolveId(id) { if (id.startsWith('\0public-doctor-profile:')) return id; if (Object.hasOwn(mocks, id)) return `\0public-doctor-profile:${id}`; },
    load(id) { if (id.startsWith('\0public-doctor-profile:')) return mocks[id.slice('\0public-doctor-profile:'.length)]; },
    transform(code, id) { if (id.endsWith('.tsx') && !id.includes('node_modules')) return ts.transpileModule(code, { compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText; },
    configureServer(vite) { vite.middlewares.use(async (req, res, next) => { if (!req.url?.startsWith('/public-doctor-profile')) return next(); res.setHeader('content-type', 'text/html'); res.end(await vite.transformIndexHtml(req.url, '<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script type="module" src="/e2e/components/public-doctor-profile.fixture.tsx"></script></body></html>')); }); },
  }],
});
await server.listen();
const origin = `http://127.0.0.1:${server.httpServer.address().port}`;
const browser = await chromium.launch({ headless: true });
try {
  for (const width of [390, 1280]) {
    const context = await browser.newContext({ viewport: { width, height: 1000 } });
    const page = await context.newPage();
    const requests = [];
    const external = [];
    const errors = [];
    let attempts = 0;
    page.on('pageerror', (error) => errors.push(error.message));
    await page.route('**/*', (route) => {
      const request = route.request();
      if (!request.url().startsWith(origin)) { external.push(request.url()); return route.abort(); }
      const path = new URL(request.url()).pathname;
      if (path === '/api/csrf-token') return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ csrfToken: 'fixture-csrf-token' }) });
      if (path === '/api/profile/verify-email') {
        requests.push({ body: request.postDataJSON(), csrf: request.headers()['x-csrf-token'] });
        attempts += 1;
        return route.fulfill({ status: attempts === 1 ? 500 : 200, contentType: 'application/json', body: JSON.stringify(attempts === 1 ? { error: 'Fixture delivery failed' } : { message: 'Fixture verification email sent' }) });
      }
      return route.continue();
    });
    await page.goto(`${origin}/public-doctor-profile?verification=success`);
    await page.getByRole('heading', { name: 'Email Verification Required' }).waitFor();
    await page.getByText('Your email has been successfully verified and synced to your Active Directory account!').waitFor();
    const email = page.getByLabel('Email Address');
    await email.fill('fixture@example.com');
    assert.equal(await page.getByRole('button', { name: 'Send Verification Email' }).isDisabled(), true);
    await page.getByText('Please enter a valid @cpp.edu email address.').waitFor();
    await email.fill('Fixture.User@cpp.edu');
    await page.getByRole('button', { name: 'Send Verification Email' }).click();
    await page.getByText('Fixture delivery failed').waitFor();
    assert.equal(await page.getByText('Your email has been successfully verified and synced to your Active Directory account!').count(), 0, 'a failed new submission must not retain an old URL success notice');
    await page.getByRole('button', { name: 'Send Verification Email' }).click();
    await page.getByText('Fixture verification email sent').waitFor();
    assert.deepEqual(requests, [
      { body: { email: 'fixture.user@cpp.edu' }, csrf: 'fixture-csrf-token' },
      { body: { email: 'fixture.user@cpp.edu' }, csrf: 'fixture-csrf-token' },
    ]);
    assert.equal(await email.inputValue(), '', 'successful verification submission clears the input');
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), true);

    await page.goto(`${origin}/public-doctor-profile?verification=error`);
    await page.getByText('There was an error verifying your email. Please try again or contact support.').waitFor();
    const retryEmail = page.getByLabel('Email Address');
    await retryEmail.fill('fixture.user@cpp.edu');
    await page.getByRole('button', { name: 'Send Verification Email' }).click();
    await page.getByText('Fixture verification email sent').waitFor();
    assert.equal(await page.getByText('There was an error verifying your email. Please try again or contact support.').count(), 0, 'a successful new submission must not retain an old URL error notice');
    assert.deepEqual(requests, [
      { body: { email: 'fixture.user@cpp.edu' }, csrf: 'fixture-csrf-token' },
      { body: { email: 'fixture.user@cpp.edu' }, csrf: 'fixture-csrf-token' },
      { body: { email: 'fixture.user@cpp.edu' }, csrf: 'fixture-csrf-token' },
    ]);
    await page.goto(`${origin}/public-doctor-profile?mode=loaderror`);
    await page.getByRole('heading', { name: 'Error' }).waitFor();
    assert.equal(await page.getByText('Fixture profile failed to load').count(), 1);
    assert.equal(await page.getByLabel('Email Address').count(), 0);
    assert.deepEqual(external, []);
    assert.deepEqual(errors, []);
    await context.close();
  }
  console.log('PASS: ProfileClient verification URL notice, invalid/valid email states, CSRF request contract, failure retry, success clearing, load error, and 390/1280 layouts use local fixture APIs only.');
} finally { await browser.close(); await server.close(); }
