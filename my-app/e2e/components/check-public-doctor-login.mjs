// Browser contract for the real LoginClient. All requests are local fixture responses.
// Run from my-app: node e2e/components/check-public-doctor-login.mjs
import assert from 'node:assert/strict';
import { createServer } from 'vite';
import { chromium } from '@playwright/test';
import ts from 'typescript';

const root = process.cwd();
const redirects = [];
const mocks = {
  'next/navigation': `
    const router = { push(path) { window.fixtureRedirects ??= []; window.fixtureRedirects.push(path); } };
    export const useRouter = () => router;
  `,
  'next/link': `
    import React from 'react';
    export default function Link({ href, children, ...props }) {
      return React.createElement('a', { href, ...props }, children);
    }
  `,
  'react-turnstile': `
    import React from 'react';
    export default function Turnstile({ onVerify, onExpire, onError }) {
      return React.createElement('button', {
        type: 'button',
        'aria-label': 'Complete security check',
        onClick: () => onVerify('fixture-turnstile-token'),
        onDoubleClick: () => onExpire(),
        onContextMenu: (event) => { event.preventDefault(); onError(); },
      }, 'Complete security check');
    }
  `,
};

const server = await createServer({
  configFile: false,
  root,
  define: {
    'process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY': JSON.stringify('fixture-turnstile-site-key'),
  },
  resolve: {
    alias: [
      ...Object.keys(mocks).map((key) => ({ find: key, replacement: `\0public-doctor-login:${key}` })),
      { find: '@', replacement: root },
    ],
  },
  cacheDir: 'node_modules/.vite-react-doctor-public',
  server: { host: '127.0.0.1', port: 0 },
  plugins: [{
    name: 'public-doctor-login-fixture',
    enforce: 'pre',
    resolveId(id) {
      if (id.startsWith('\0public-doctor-login:')) return id;
      if (Object.hasOwn(mocks, id)) return `\0public-doctor-login:${id}`;
    },
    load(id) {
      if (id.startsWith('\0public-doctor-login:')) return mocks[id.slice('\0public-doctor-login:'.length)];
    },
    transform(code, id) {
      if (id.endsWith('.tsx') && !id.includes('node_modules')) {
        return ts.transpileModule(code, {
          compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
        }).outputText;
      }
    },
    configureServer(vite) {
      vite.middlewares.use(async (req, res, next) => {
        if (!req.url?.startsWith('/public-doctor-login')) return next();
        res.setHeader('content-type', 'text/html');
        res.end(await vite.transformIndexHtml(req.url, '<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script type="module" src="/e2e/components/public-doctor-login.fixture.tsx"></script></body></html>'));
      });
    },
  }],
});

await server.listen();
const origin = `http://127.0.0.1:${server.httpServer.address().port}`;
const browser = await chromium.launch({ headless: true });

function json(route, status, body) {
  return route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
}

function requestContract(request) {
  return {
    pathname: new URL(request.url()).pathname,
    body: request.postDataJSON(),
    csrf: request.headers()['x-csrf-token'],
  };
}

async function completeTurnstile(page) {
  await page.getByRole('button', { name: 'Complete security check' }).click();
}

async function chooseDirectoryMethod(page) {
  const directoryButton = page.getByRole('button', { name: /Active Directory/ });
  await directoryButton.focus();
  await page.keyboard.press('Enter');
  await page.getByLabel('Username').waitFor();
}

async function assertNoOverflow(page) {
  const dimensions = await page.evaluate(() => ({ clientWidth: document.documentElement.clientWidth, scrollWidth: document.documentElement.scrollWidth }));
  assert.ok(dimensions.scrollWidth <= dimensions.clientWidth, `horizontal overflow: ${dimensions.scrollWidth}px > ${dimensions.clientWidth}px`);
}

try {
  for (const width of [390, 1280]) {
    const context = await browser.newContext({ viewport: { width, height: 1000 } });
    const page = await context.newPage();
    const browserErrors = [];
    const externalRequests = [];
    const requestLog = [];
    let loginResponse = { status: 200, body: { isAdmin: true } };
    let passwordChangeResponse = { status: 200, body: { isAdmin: true } };
    page.on('pageerror', (error) => browserErrors.push(error.message));
    await page.route('**/*', async (route) => {
      const request = route.request();
      if (!request.url().startsWith(origin)) {
        externalRequests.push(request.url());
        return route.abort();
      }
      const url = new URL(request.url());
      if (!url.pathname.startsWith('/api/')) return route.continue();
      if (url.pathname === '/api/csrf-token') return json(route, 200, { csrfToken: 'fixture-csrf-token' });
      if (url.pathname === '/api/auth/login') {
        requestLog.push(requestContract(request));
        return json(route, loginResponse.status, loginResponse.body);
      }
      if (url.pathname === '/api/auth/complete-required-password-change') {
        requestLog.push(requestContract(request));
        return json(route, passwordChangeResponse.status, passwordChangeResponse.body);
      }
      if (url.pathname === '/api/auth/oidc/login') {
        requestLog.push({ pathname: url.pathname, query: url.search, csrf: request.headers()['x-csrf-token'] });
        return route.fulfill({ contentType: 'text/html', body: '<title>OIDC fixture redirect</title>' });
      }
      return json(route, 404, { error: `Unexpected fixture API: ${url.pathname}` });
    });

    await page.goto(`${origin}/public-doctor-login`);
    await page.getByRole('heading', { name: 'Sign in' }).waitFor();
    assert.equal(await page.getByRole('list', { name: 'Identity sources' }).count(), 1, 'identity sources must be a semantic list');
    await chooseDirectoryMethod(page);
    await page.getByLabel('Username').fill('fixture-user');
    await page.getByLabel('Password').fill('FixturePassword1!');
    await completeTurnstile(page);
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await page.waitForFunction(() => (window.fixtureRedirects ?? []).length === 1);
    assert.deepEqual(requestLog.at(-1), {
      pathname: '/api/auth/login',
      body: { username: 'fixture-user', password: 'FixturePassword1!', turnstileToken: 'fixture-turnstile-token', signInMethod: 'native_ad' },
      csrf: 'fixture-csrf-token',
    });
    assert.deepEqual(await page.evaluate(() => window.fixtureRedirects), ['/admin'], 'a successful direct sign-in must preserve the safe requested target');
    await assertNoOverflow(page);

    await page.goto(`${origin}/public-doctor-login`);
    loginResponse = { status: 409, body: { action: 'PASSWORD_CHANGE_REQUIRED', message: 'Password update required' } };
    await chooseDirectoryMethod(page);
    await page.getByLabel('Username').fill('fixture-user');
    await page.getByLabel('Password').fill('OldFixturePassword1!');
    await completeTurnstile(page);
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await page.getByRole('heading', { name: 'Set new password' }).waitFor();
    assert.equal(await page.getByText('Password update required').count(), 1);
    await page.getByLabel('Current password', { exact: true }).fill('OldFixturePassword1!');
    await page.getByLabel('New password', { exact: true }).fill('SecureLemon42!');
    await page.getByLabel('Confirm new password', { exact: true }).fill('SecureLemon42!');
    await completeTurnstile(page);
    passwordChangeResponse = { status: 409, body: { action: 'METHOD_DISABLED', error: 'Direct Active Directory sign-in is no longer enabled.' } };
    await page.getByRole('button', { name: 'Update password and sign in' }).click();
    await page.getByRole('list', { name: 'Identity sources' }).waitFor();
    assert.equal(await page.getByText('Direct Active Directory sign-in is no longer enabled.').count(), 1);
    assert.deepEqual(requestLog.at(-1), {
      pathname: '/api/auth/complete-required-password-change',
      body: { currentPassword: 'OldFixturePassword1!', newPassword: 'SecureLemon42!', confirmPassword: 'SecureLemon42!', turnstileToken: 'fixture-turnstile-token' },
      csrf: 'fixture-csrf-token',
    });
    await assertNoOverflow(page);

    await page.goto(`${origin}/public-doctor-login`);
    const oidcRequest = page.waitForRequest((request) => new URL(request.url()).pathname === '/api/auth/oidc/login');
    await page.getByRole('button', { name: /Company sign-in/ }).click();
    await oidcRequest;
    assert.deepEqual(requestLog.at(-1), { pathname: '/api/auth/oidc/login', query: '?redirect=%2Fadmin', csrf: undefined });

    await page.goto(`${origin}/public-doctor-login?mode=oidc-retry`);
    await page.getByText('The auth-service sign-in could not be completed.').waitFor();
    const retryRequest = page.waitForRequest((request) => new URL(request.url()).pathname === '/api/auth/oidc/login');
    await page.getByRole('button', { name: /Try Company sign-in again/ }).click();
    await retryRequest;
    assert.deepEqual(requestLog.at(-1), { pathname: '/api/auth/oidc/login', query: '?redirect=%2Fadmin', csrf: undefined });

    assert.deepEqual(externalRequests, [], 'the fixture must abort all external requests');
    assert.deepEqual(browserErrors, [], `browser errors: ${browserErrors.join('\n')}`);
    await context.close();
  }
  console.log('PASS: LoginClient chooser, direct sign-in, forced password change, METHOD_DISABLED, OIDC retry, CSRF request contracts, keyboard selection, redirects, and 390/1280 layouts use local fixture APIs only.');
} finally {
  await browser.close();
  await server.close();
}
