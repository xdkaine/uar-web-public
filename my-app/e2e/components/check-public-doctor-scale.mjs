// Render every repaired scale-only public status icon with real React and CSS.
// Run from my-app: node e2e/components/check-public-doctor-scale.mjs
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createServer } from 'vite';
import { chromium } from '@playwright/test';
import ts from 'typescript';

const root = process.cwd();
const output = resolve(root, 'test-results/public-doctor-scale');
const mocks = {
  'next/navigation': `
    export function useRouter() { return { push() {}, replace() {}, back() {} }; }
    export function useSearchParams() { return new URLSearchParams('?token=fixture-token&reason=expired'); }
  `,
  'next/link': `
    import React from 'react';
    export default function Link({ href, children, ...props }) { return React.createElement('a', { href, ...props }, children); }
  `,
  'react-turnstile': `
    import React from 'react';
    export default function Turnstile() { return React.createElement('div', { 'data-fixture-turnstile': 'true' }); }
  `,
};

const server = await createServer({
  configFile: false,
  root,
  define: {
    'process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY': JSON.stringify('fixture-turnstile-site-key'),
  },
  cacheDir: 'node_modules/.vite-react-doctor-public-scale',
  resolve: {
    alias: [
      ...Object.keys(mocks).map((key) => ({ find: key, replacement: `\0public-doctor-scale:${key}` })),
      { find: '@', replacement: root },
    ],
  },
  server: { host: '127.0.0.1', port: 0 },
  plugins: [{
    name: 'public-doctor-scale-fixture',
    enforce: 'pre',
    resolveId(id) {
      if (id.startsWith('\0public-doctor-scale:')) return id;
      if (Object.hasOwn(mocks, id)) return `\0public-doctor-scale:${id}`;
    },
    load(id) {
      if (id.startsWith('\0public-doctor-scale:')) return mocks[id.slice('\0public-doctor-scale:'.length)];
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
        if (!req.url?.startsWith('/public-doctor-scale')) return next();
        res.setHeader('content-type', 'text/html');
        res.end(await vite.transformIndexHtml(req.url, '<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script type="module" src="/e2e/components/public-doctor-scale.fixture.tsx"></script></body></html>'));
      });
    },
  }],
});

await server.listen();
const origin = `http://127.0.0.1:${server.httpServer.address().port}`;
const browser = await chromium.launch({ headless: true });
const cases = ['forgot-password', 'profile', 'request-success', 'already-verified', 'verify-confirm', 'verify-error', 'verify-success', 'activation-success'];

try {
  await mkdir(output, { recursive: true });
  for (const reducedMotion of ['no-preference', 'reduce']) {
    const context = await browser.newContext({ viewport: { width: 390, height: 900 }, reducedMotion });
    const page = await context.newPage();
    const externalRequests = [];
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.route('**/*', (route) => {
      if (!route.request().url().startsWith(origin)) {
        externalRequests.push(route.request().url());
        return route.abort();
      }
      if (new URL(route.request().url()).pathname.startsWith('/api/')) return route.fulfill({ status: 404, contentType: 'application/json', body: '{}' });
      return route.continue();
    });
    await page.goto(`${origin}/public-doctor-scale`);
    await page.getByRole('heading', { name: 'Forgot Password?' }).waitFor();
    await page.waitForTimeout(1_200);
    for (const name of cases) {
      const result = await page.locator(`[data-scale-case="${name}"] [style*="transform"]`).evaluateAll((elements) => elements.map((element) => ({ opacity: Number.parseFloat(getComputedStyle(element).opacity), transform: getComputedStyle(element).transform })));
      assert.ok(result.length > 0, `${name} must render motion elements`);
      if (!result.every(({ opacity }) => opacity >= 0.99)) console.log(`${name} motion styles`, result);
      assert.ok(result.every(({ opacity }) => opacity >= 0.99), `${name} contains a rendered motion element with opacity below 1`);
    }
    await page.screenshot({ path: resolve(output, `public-scale-${reducedMotion}.png`), fullPage: true });
    assert.deepEqual(externalRequests, [], 'the visual fixture must not contact external services');
    assert.deepEqual(errors, [], `browser errors: ${errors.join('\n')}`);
    await context.close();
  }
  console.log(`PASS: repaired scale-only icons have computed opacity 1 after motion in normal and reduced-motion browsers. Screenshots: ${output}`);
} finally {
  await browser.close();
  await server.close();
}
