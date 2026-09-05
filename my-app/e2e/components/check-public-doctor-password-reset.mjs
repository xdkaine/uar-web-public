// Render both public password-reset forms with real React components and local-only APIs.
// Run from my-app: node e2e/components/check-public-doctor-password-reset.mjs
import assert from 'node:assert/strict';
import { createServer } from 'vite';
import { chromium } from '@playwright/test';
import ts from 'typescript';

const root = process.cwd();
const requests = [];
const mocks = {
  'next/link': `
    import React from 'react';
    export default function Link({ href, children, ...props }) {
      return React.createElement('a', { href, ...props }, children);
    }
  `,
  'react-turnstile': `
    import React from 'react';
    export default function Turnstile({ onVerify }) {
      React.useEffect(() => onVerify('fixture-turnstile-token'), [onVerify]);
      return React.createElement('div', { 'data-fixture-turnstile': 'true' });
    }
  `,
};

const server = await createServer({
  configFile: false,
  root,
  define: {
    'process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY': JSON.stringify('fixture-turnstile-site-key'),
  },
  cacheDir: 'node_modules/.vite-react-doctor-public-password-reset',
  resolve: {
    alias: [
      ...Object.keys(mocks).map((key) => ({ find: key, replacement: `\0public-doctor-password-reset:${key}` })),
      { find: '@', replacement: root },
    ],
  },
  server: { host: '127.0.0.1', port: 0 },
  plugins: [{
    name: 'public-doctor-password-reset-fixture',
    enforce: 'pre',
    resolveId(id) {
      if (id.startsWith('\0public-doctor-password-reset:')) return id;
      if (Object.hasOwn(mocks, id)) return `\0public-doctor-password-reset:${id}`;
    },
    load(id) {
      if (id.startsWith('\0public-doctor-password-reset:')) {
        return mocks[id.slice('\0public-doctor-password-reset:'.length)];
      }
    },
    transform(code, id) {
      if (id.endsWith('.tsx') && !id.includes('node_modules')) {
        return ts.transpileModule(code, {
          compilerOptions: {
            jsx: ts.JsxEmit.ReactJSX,
            module: ts.ModuleKind.ESNext,
            target: ts.ScriptTarget.ES2022,
          },
        }).outputText;
      }
    },
    configureServer(vite) {
      vite.middlewares.use(async (req, res, next) => {
        if (!req.url?.startsWith('/public-doctor-password-reset')) return next();
        res.setHeader('content-type', 'text/html');
        res.end(await vite.transformIndexHtml(req.url, '<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script type="module" src="/e2e/components/public-doctor-password-reset.fixture.tsx"></script></body></html>'));
      });
    },
  }],
});

await server.listen();
const origin = `http://127.0.0.1:${server.httpServer.address().port}`;
const browser = await chromium.launch({ headless: true });

async function installRoutes(page, externalRequests) {
  await page.route('**/*', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.origin !== origin) {
      externalRequests.push(request.url());
      return route.abort();
    }
    if (url.pathname === '/api/csrf-token') {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ csrfToken: 'fixture-csrf-token' }) });
    }
    if (url.pathname === '/api/auth/request-password-reset') {
      requests.push({ body: request.postDataJSON(), headers: request.headers() });
      await new Promise((resolve) => setTimeout(resolve, 50));
      return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
    }
    return route.continue();
  });
}

async function assertNoHorizontalOverflow(page) {
  const dimensions = await page.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth, clientWidth: document.documentElement.clientWidth }));
  assert.ok(dimensions.scrollWidth <= dimensions.clientWidth, `horizontal overflow: ${JSON.stringify(dimensions)}`);
}

try {
  for (const viewport of [{ width: 390, height: 900 }, { width: 1280, height: 900 }]) {
    const context = await browser.newContext({ viewport });
    const page = await context.newPage();
    const externalRequests = [];
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await installRoutes(page, externalRequests);

    await page.goto(`${origin}/public-doctor-password-reset`);
    await page.getByRole('heading', { name: 'Forgot Password?' }).waitFor();
    await page.getByLabel('Email Address').fill('fixture@example.test');
    await page.getByLabel('Email Address').press('Enter');
    await page.getByRole('heading', { name: 'Check your email' }).waitFor();
    await assertNoHorizontalOverflow(page);

    await page.goto(`${origin}/public-doctor-password-reset/account`);
    await page.getByRole('heading', { name: 'Reset Your Password' }).waitFor();
    await page.getByRole('button', { name: 'Send Password Reset Link' }).press('Enter');
    await page.getByRole('heading', { name: 'Password reset link sent!' }).waitFor();
    await assertNoHorizontalOverflow(page);

    assert.deepEqual(externalRequests, [], 'fixture must not contact external services');
    assert.deepEqual(errors, [], `browser errors: ${errors.join('\n')}`);
    await context.close();
  }

  assert.equal(requests.length, 4, 'each form should submit once at both viewport widths');
  assert.deepEqual(requests[0].body, { email: 'fixture@example.test', turnstileToken: 'fixture-turnstile-token' });
  assert.equal(requests[0].headers['x-csrf-token'], undefined, 'the documented unauthenticated reset endpoint is CSRF-exempt');
  assert.deepEqual(requests[1].body, { username: 'fixture-user' });
  assert.deepEqual(requests[2].body, { email: 'fixture@example.test', turnstileToken: 'fixture-turnstile-token' });
  assert.equal(requests[2].headers['x-csrf-token'], undefined, 'the documented unauthenticated reset endpoint is CSRF-exempt');
  assert.deepEqual(requests[3].body, { username: 'fixture-user' });
  console.log('PASS: password-reset submit control preserves labels, keyboard submission, request bodies, CSRF behavior, and responsive layout at 390px and 1280px.');
} finally {
  await browser.close();
  await server.close();
}
