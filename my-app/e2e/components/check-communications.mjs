// Real React component and compiled application CSS with every API response served
// from this local fixture. Run from my-app: node e2e/components/check-communications.mjs
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createServer } from 'vite';
import AxeBuilder from '@axe-core/playwright';
import { chromium } from '@playwright/test';
import ts from 'typescript';

const root = process.cwd();
const output = resolve(root, 'test-results/communications');
const mocks = {
  'next/navigation': `
    import { useSyncExternalStore } from 'react';
    const subscribe = (listener) => {
      window.addEventListener('fixture-navigation', listener);
      return () => window.removeEventListener('fixture-navigation', listener);
    };
    const notify = () => window.dispatchEvent(new Event('fixture-navigation'));
    export function useSearchParams() {
      const search = useSyncExternalStore(subscribe, () => location.search, () => '');
      return new URLSearchParams(search);
    }
    export function useRouter() {
      return { replace(url) { history.replaceState({}, '', url); notify(); } };
    }
  `,
  '@/components/admin/MassEmailComposer': `
    import React from 'react';
    export default function MassEmailComposer({ activeWorkspace, onWorkspaceChange }) {
      return React.createElement('section', { 'aria-label': 'Mass email workspace', className: 'rounded-lg border p-4' },
        React.createElement('p', null, 'Mass email fixture: ' + activeWorkspace),
        React.createElement('button', { type: 'button', onClick: () => onWorkspaceChange('compose') }, 'Compose workspace'),
        React.createElement('button', { type: 'button', onClick: () => onWorkspaceChange('campaigns') }, 'Campaigns workspace')
      );
    }
  `,
};

const server = await createServer({
  configFile: false,
  root,
  resolve: {
    alias: [
      ...Object.keys(mocks).map((key) => ({ find: key, replacement: `\0communications-fixture:${key}` })),
      { find: '@', replacement: root },
    ],
  },
  server: { host: '127.0.0.1', port: 0 },
  plugins: [{
    name: 'communications-fixture',
    enforce: 'pre',
    resolveId(id) {
      if (id.startsWith('\0communications-fixture:')) return id;
      if (Object.hasOwn(mocks, id)) return `\0communications-fixture:${id}`;
    },
    load(id) {
      if (id.startsWith('\0communications-fixture:')) return mocks[id.slice('\0communications-fixture:'.length)];
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
        if (!req.url?.startsWith('/communications-fixture') && !req.url?.startsWith('/admin/communications')) return next();
        res.setHeader('content-type', 'text/html');
        res.end(await vite.transformIndexHtml(req.url, `<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>Communications fixture</title></head><body><div id="root"></div><script type="module" src="/e2e/components/communications.fixture.tsx"></script></body></html>`));
      });
    },
  }],
});

await server.listen();
const address = server.httpServer.address();
const origin = `http://127.0.0.1:${address.port}`;
const browser = await chromium.launch({ headless: true });
await mkdir(output, { recursive: true });

const records = [
  { id: 'pending-1', type: 'access_request', name: 'Verity Pending', email: 'verity@example.test', status: 'pending_verification', createdAt: '2026-09-04T00:00:00.000Z' },
  { id: 'approved-1', type: 'access_request', name: 'Avery Approved', email: 'avery@example.test', username: 'avery', status: 'approved', createdAt: '2026-09-04T00:00:00.000Z' },
  { id: 'approved-2', type: 'access_request', name: 'No Username', email: 'nouser@example.test', status: 'approved', createdAt: '2026-09-04T00:00:00.000Z' },
];

function localJson(route, status, body) {
  return route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
}

async function searchAndSelect(page, name, { key = 'Enter', checkFocus = false } = {}) {
  const search = page.getByRole('textbox', { name: 'Search recipients' });
  await search.fill(name);
  await page.waitForTimeout(550);
  const result = page.getByRole('button', { name: new RegExp(name) });
  assert.equal(await result.evaluate((button) => button.tagName), 'BUTTON', 'a search result must be a native button');
  await search.press('Tab');
  const active = page.locator(':focus');
  assert.equal(await active.evaluate((element) => element instanceof HTMLButtonElement && element.hasAttribute('aria-pressed')), true, 'a search result must be reachable with Tab');
  assert.ok((await active.textContent())?.includes(name), `Tab must reach the ${name} result`);
  if (checkFocus) {
    const focusStyle = await active.evaluate((button) => {
      const style = getComputedStyle(button);
      return style.outlineStyle !== 'none' || style.boxShadow !== 'none';
    });
    assert.equal(focusStyle, true, 'keyboard focus must have a visible outline or ring');
  }
  await page.keyboard.press(key);
  await page.getByRole('heading', { level: 3, name }).waitFor();
  assert.equal(await result.getAttribute('aria-pressed'), 'true', 'keyboard selection must expose the active result state');
  return result;
}

async function assertNoHorizontalOverflow(page) {
  const dimensions = await page.evaluate(() => ({ clientWidth: document.documentElement.clientWidth, scrollWidth: document.documentElement.scrollWidth }));
  assert.ok(dimensions.scrollWidth <= dimensions.clientWidth, `horizontal overflow: ${dimensions.scrollWidth}px > ${dimensions.clientWidth}px`);
}

try {
  for (const theme of ['light', 'dark']) {
    for (const width of [1280, 390]) {
      const context = await browser.newContext({ viewport: { width, height: 1000 }, colorScheme: theme });
      const page = await context.newPage();
      const browserErrors = [];
      const expectedFailureConsoleErrors = [];
      const postRequests = [];
      const searchRequests = [];
      const externalRequests = [];
      let failNextReset = false;
      page.on('pageerror', (error) => browserErrors.push(error.message));
      page.on('console', (message) => {
        if (message.type() !== 'error') return;
        if (/status of 503 \(Service Unavailable\)/.test(message.text())) {
          expectedFailureConsoleErrors.push(message.text());
        } else {
          browserErrors.push(message.text());
        }
      });
      await page.route('**/*', async (route) => {
        const request = route.request();
        if (!request.url().startsWith(origin)) {
          externalRequests.push(request.url());
          return route.abort();
        }
        const url = new URL(request.url());
        if (!url.pathname.startsWith('/api/')) return route.continue();
        if (url.pathname === '/api/csrf-token') return localJson(route, 200, { csrfToken: 'fixture-csrf-token' });
        if (url.pathname === '/api/admin/search') {
          searchRequests.push(url.searchParams.get('q'));
          const query = url.searchParams.get('q')?.toLowerCase() ?? '';
          const accessRequests = records.filter((record) => [record.name, record.email, record.username]
            .filter(Boolean)
            .some((value) => value.toLowerCase().includes(query)));
          return localJson(route, 200, { accessRequests });
        }
        if (request.method() === 'POST' && url.pathname.startsWith('/api/admin/requests/')) {
          postRequests.push({ pathname: url.pathname, csrf: request.headers()['x-csrf-token'] });
          if (failNextReset && url.pathname.endsWith('/reset-password')) {
            failNextReset = false;
            return localJson(route, 503, { error: 'Fixture delivery failure' });
          }
          return localJson(route, 200, { message: 'Fixture notification queued' });
        }
        return localJson(route, 404, { error: `Unexpected fixture API: ${url.pathname}` });
      });

      await page.goto(`${origin}/communications-fixture?view=mass-email&workspace=campaigns`);
      if (theme === 'dark') await page.locator('html').evaluate((html) => html.classList.add('dark'));
      await page.getByText('Mass email fixture: campaigns').waitFor();
      await page.getByRole('button', { name: 'Compose workspace' }).click();
      await page.getByText('Mass email fixture: compose').waitFor();
      assert.match(new URL(page.url()).search, /view=mass-email/);
      assert.match(new URL(page.url()).search, /workspace=compose/);
      await page.getByRole('tab', { name: 'Manual Notifications' }).click();
      await page.getByRole('textbox', { name: 'Search recipients' }).waitFor();
      assert.match(new URL(page.url()).search, /view=manual-notifications/);
      assert.match(new URL(page.url()).search, /workspace=compose/);

      const labelCount = await page.getByRole('textbox', { name: 'Search recipients' }).evaluate((input) => input.labels?.length ?? 0);
      assert.equal(labelCount, 1, 'the manual-notification search needs one visible associated label');
      await searchAndSelect(page, 'Verity Pending', { key: 'Enter', checkFocus: true });
      await page.getByRole('button', { name: 'Resend Verification' }).waitFor();
      assert.equal(await page.getByRole('button', { name: 'Resend Verification' }).isDisabled(), false);
      assert.equal(await page.getByRole('button', { name: 'Resend Activation' }).isDisabled(), true);
      assert.equal(await page.getByRole('button', { name: 'Send Reset Link' }).isDisabled(), true);
      await page.getByRole('button', { name: 'Resend Verification' }).click();
      await page.getByRole('alertdialog').getByRole('button', { name: 'Cancel' }).click();
      assert.equal(postRequests.length, 0, 'cancel must not send a notification request');
      const verificationResponse = page.waitForResponse((response) => response.url().endsWith('/api/admin/requests/pending-1/resend-verification') && response.request().method() === 'POST');
      await page.getByRole('button', { name: 'Resend Verification' }).click();
      await page.getByRole('alertdialog').getByRole('button', { name: 'Continue' }).click();
      await verificationResponse;
      assert.deepEqual(postRequests.at(-1), { pathname: '/api/admin/requests/pending-1/resend-verification', csrf: 'fixture-csrf-token' });

      await searchAndSelect(page, 'Avery Approved', { key: 'Space' });
      assert.equal(await page.getByRole('button', { name: 'Resend Verification' }).isDisabled(), true);
      assert.equal(await page.getByRole('button', { name: 'Resend Activation' }).isDisabled(), false);
      assert.equal(await page.getByRole('button', { name: 'Send Reset Link' }).isDisabled(), false);
      const activationResponse = page.waitForResponse((response) => response.url().endsWith('/api/admin/requests/approved-1/resend-activation') && response.request().method() === 'POST');
      await page.getByRole('button', { name: 'Resend Activation' }).click();
      await page.getByRole('alertdialog').getByRole('button', { name: 'Continue' }).click();
      await activationResponse;
      assert.deepEqual(postRequests.at(-1), { pathname: '/api/admin/requests/approved-1/resend-activation', csrf: 'fixture-csrf-token' });

      failNextReset = true;
      const failedResetResponse = page.waitForResponse((response) => response.url().endsWith('/api/admin/requests/approved-1/reset-password') && response.status() === 503);
      await page.getByRole('button', { name: 'Send Reset Link' }).click();
      await page.getByRole('alertdialog').getByRole('button', { name: 'Continue' }).click();
      await failedResetResponse;
      assert.deepEqual(postRequests.at(-1), { pathname: '/api/admin/requests/approved-1/reset-password', csrf: 'fixture-csrf-token' });
      await page.waitForFunction(() => [...document.querySelectorAll('button')].some((button) => button.textContent?.trim() === 'Send Reset Link' && !button.disabled));
      assert.equal(await page.getByRole('button', { name: 'Send Reset Link' }).isDisabled(), false, 'a failed mutation must leave the action retryable');
      const retryResetResponse = page.waitForResponse((response) => response.url().endsWith('/api/admin/requests/approved-1/reset-password') && response.status() === 200);
      await page.getByRole('button', { name: 'Send Reset Link' }).click();
      await page.getByRole('alertdialog').getByRole('button', { name: 'Continue' }).click();
      await retryResetResponse;
      assert.equal(postRequests.filter((request) => request.pathname.endsWith('/reset-password')).length, 2, 'retry must issue one new local request');

      await searchAndSelect(page, 'No Username');
      assert.equal(await page.getByRole('button', { name: 'Resend Activation' }).isDisabled(), false);
      assert.equal(await page.getByRole('button', { name: 'Send Reset Link' }).isDisabled(), true);

      await assertNoHorizontalOverflow(page);
      const accessibilityResults = await new AxeBuilder({ page })
        .include('main')
        .withRules(['label', 'button-name', 'aria-allowed-attr'])
        .analyze();
      assert.deepEqual(accessibilityResults.violations, [], `axe violations: ${accessibilityResults.violations.map((violation) => violation.id).join(', ')}`);
      await page.screenshot({ path: resolve(output, `communications-${theme}-${width}.png`), fullPage: true });
      const searchesBeforeUnmount = searchRequests.length;
      await page.getByRole('textbox', { name: 'Search recipients' }).fill('late unmount');
      await page.getByRole('button', { name: 'Unmount fixture' }).evaluate((button) => button.click());
      await page.waitForTimeout(550);
      assert.equal(searchRequests.length, searchesBeforeUnmount, 'unmount must cancel a pending search timer before it reaches the API');
      assert.deepEqual(externalRequests, [], 'fixture must abort rather than contact external services');
      assert.equal(expectedFailureConsoleErrors.length, 1, 'the deliberately failed reset request must be the only expected network error');
      assert.deepEqual(browserErrors, [], `browser errors: ${browserErrors.join('\n')}`);
      await context.close();
    }
  }
  console.log(`Communications fixture passed. Screenshots: ${output}`);
} finally {
  await browser.close();
  await server.close();
}
