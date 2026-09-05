// Real React components and compiled application CSS; all API responses are local fixtures.
// Run from my-app: node e2e/components/check-ui-controls.mjs
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createServer } from 'vite';
import { chromium } from '@playwright/test';
import ts from 'typescript';

const root = process.cwd();
const output = resolve(root, 'test-results/ui-controls');
const mocks = {
  'next/link': `import React from 'react'; export default function Link({href, ...props}) { return React.createElement('a', {...props, href}); }`,
  'next/image': `import React from 'react'; export default function Image({priority, fill, unoptimized, ...props}) { return React.createElement('img', props); }`,
  'next/navigation': `import {useSyncExternalStore} from 'react'; const subscribe = (cb) => { window.addEventListener('fixture-navigation', cb); return () => window.removeEventListener('fixture-navigation', cb); }; export function useSearchParams() { const search = useSyncExternalStore(subscribe, () => location.search); return new URLSearchParams(search); } export function useRouter() { return { replace(url) { history.replaceState({}, '', url); window.dispatchEvent(new Event('fixture-navigation')); } }; } export function usePathname() { return '/admin/lifecycle'; }`,
  '@/lib/csrf': `export const fetchWithCsrf = (...args) => fetch(...args);`,
  '@/components/admin/AdminShell': `const permissions = new Set(['users.read', 'users.manage', 'lifecycle.manage', 'admin.search', 'requests.read', 'lifecycle.read', 'vpn.read', 'tickets.read', 'audit.read']); export function useAdminNavigation() { return {state:'ready', permissions, isSystemAdmin:true, moduleStates:{}}; }`,
  '@/components/admin/lifecycle/LifecycleAccountsWorkspace': `export default function Accounts() { return 'Accounts fixture'; }`,
  '@/components/admin/lifecycle/LifecycleOperationsPanel': `export default function Operations() { return 'Operations fixture'; }`,
  '@/components/admin/RequestDetailModal': `export default function Detail() { return null; }`,
  '@/hooks/useAdminPageTracking': `export function useAdminPageTracking() {}`,
  '@/components/theme-toggle': `export function ThemeToggle() { return null; }`,
  '@/components/NotificationBell': `export default function NotificationBell() { return null; }`,
};

const server = await createServer({
  configFile: false,
  root,
  resolve: { alias: [
    ...Object.keys(mocks).map((key) => ({ find: key, replacement: `\0fixture:${key}` })),
    { find: '@', replacement: root },
  ] },
  server: { host: '127.0.0.1', port: 0 },
  plugins: [{
    name: 'isolated-ui-fixtures',
    enforce: 'pre',
    resolveId(id) {
      if (id.startsWith('\0fixture:')) return id;
      const original = Object.keys(mocks).find((key) => id === key || (key.startsWith('@/') && id === resolve(root, key.slice(2)).replaceAll('\\', '/')));
      if (original) return `\0fixture:${original}`;
    },
    load(id) { if (id.startsWith('\0fixture:')) return mocks[id.slice(9)]; },
    transform(code, id) {
      if (id.endsWith('.tsx') && !id.includes('node_modules')) {
        return ts.transpileModule(code, { compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
      }
    },
    configureServer(vite) {
      vite.middlewares.use(async (req, res, next) => {
        if (!req.url?.startsWith('/ui-controls') && !req.url?.startsWith('/admin/lifecycle')) return next();
        res.setHeader('content-type', 'text/html');
        res.end(await vite.transformIndexHtml(req.url, '<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>UI controls regression fixture</title></head><body><div id="root"></div><script type="module" src="/e2e/components/ui-controls.fixture.tsx"></script></body></html>'));
      });
    },
  }],
});

await server.listen();
const address = server.httpServer.address();
const origin = `http://127.0.0.1:${address.port}`;
const browser = await chromium.launch({ headless: true });
await mkdir(output, { recursive: true });
const group = { name: 'Research Users', dn: 'CN=Research Users,DC=example,DC=test', description: 'Research collaboration access' };
const people = [
  { username: 'jlee', displayName: 'Jordan Lee', email: 'jlee@example.test', dn: 'CN=jlee,DC=example,DC=test' },
  { username: 'mchen', displayName: 'Morgan Chen', email: 'mchen@example.test', dn: 'CN=mchen,DC=example,DC=test' },
  { username: 'tpark', displayName: 'Taylor Park', email: 'tpark@example.test', dn: 'CN=tpark,DC=example,DC=test' },
];

try {
  for (const theme of ['light', 'dark']) {
    for (const width of [1280, 390]) {
      const page = await browser.newPage({ viewport: { width, height: 1000 }, colorScheme: theme });
      const requests = [];
      let members = [];
      let failUsername;
      let holdRequest;
      let pendingRequest;
      const errors = [];
      page.on('pageerror', (error) => { errors.push(error.message); console.error(error.message); });
      await page.route('**/*', async (route) => {
        if (!route.request().url().startsWith(origin)) return route.abort();
        const url = new URL(route.request().url());
        if (!url.pathname.startsWith('/api/')) return route.continue();
        let data = {};
        if (url.pathname === '/api/admin/groups') data = { groups: [group] };
        else if (url.pathname === '/api/admin/users') data = { users: people };
        else if (url.pathname.endsWith('/members')) {
          if (route.request().method() === 'POST' || route.request().method() === 'DELETE') {
            const body = route.request().postDataJSON();
            requests.push(body);
            if (holdRequest) { pendingRequest = route; return; }
            if (body.username === failUsername) return route.fulfill({ status: 409, json: { success: false, actionId: 'review-action', error: 'Review directory outcome' } });
            if (route.request().method() === 'DELETE') members = members.filter((person) => person.username !== body.username);
            else members.push(people.find((person) => person.username === body.username));
            data = { success: true, actionId: `action-${body.username}` };
          } else data = { group, members, mutation: { allowed: true, readOnly: false, protected: false } };
        } else if (url.pathname === '/api/admin/search') data = { results: [], total: 0 };
        return route.fulfill({ json: data });
      });
      await page.goto(`${origin}/ui-controls?view=groups`);
      if (theme === 'dark') await page.locator('html').evaluate((html) => html.classList.add('dark'));
      await page.getByRole('button', { name: /Research Users/ }).click();
      const picker = page.getByRole('combobox', { name: 'Add accounts' });
      const select = async (name) => {
        await picker.fill(name);
        await page.getByRole('option', { name: new RegExp(name) }).click();
        assert.equal(await page.getByRole('listbox', { name: 'Matching accounts' }).count(), 0);
        assert.equal(await picker.inputValue(), '');
      };
      await select('Jordan Lee');
      await select('Morgan Chen');
      await page.screenshot({ path: resolve(output, `selected-${theme}-${width}.png`) });
      await page.getByRole('button', { name: /Remove Jordan Lee .* from selection/ }).click();
      assert.equal(await page.getByRole('list', { name: 'Selected accounts' }).getByRole('listitem').count(), 1);
      await select('Jordan Lee');
      await picker.fill('Morgan');
      assert.equal(await page.getByRole('option').count(), 0);
      await picker.fill('Taylor');
      await picker.press('Escape');
      assert.equal(await page.getByRole('option').count(), 0);
      await picker.fill('Taylor');
      await picker.press('ArrowDown');
      await picker.press('Enter');
      await page.getByRole('button', { name: /Remove Taylor Park .* from selection/ }).click();
      await page.getByLabel('Reason for adding accounts').fill('Research project access');
      await page.getByRole('button', { name: 'Add 2 members' }).click();
      await page.getByRole('status').filter({ hasText: '2 of 2 members added' }).waitFor();
      assert.deepEqual(requests.map(({username, reason, groupDn}) => ({username, reason, groupDn})), ['mchen', 'jlee'].map((username) => ({username, reason:'Research project access', groupDn:group.dn})));
      assert.equal(new Set(requests.map((request) => request.idempotencyKey)).size, 2);
      assert.equal(await page.getByRole('list', { name: 'Selected accounts' }).count(), 0);

      // A failed first member stops the sequence and retains both names.
      members = [];
      await page.getByRole('button', { name: /Research Users/ }).click();
      await select('Jordan Lee');
      await select('Morgan Chen');
      failUsername = 'jlee';
      await page.getByLabel('Reason for adding accounts').fill('Second reviewed plan');
      await page.getByRole('button', { name: 'Add 2 members' }).click();
      await page.getByRole('alert').filter({ hasText: 'Change for jlee was not confirmed' }).waitFor();
      assert.equal(requests.length, 3);
      assert.equal(await page.getByRole('list', { name: 'Selected accounts' }).getByRole('listitem').count(), 2);
      assert.equal(await page.getByRole('button', { name: 'Add 2 members' }).isDisabled(), true);
      await page.getByRole('button', { name: /Remove Jordan Lee .* from selection/ }).click();
      await page.getByRole('button', { name: 'Add 1 member' }).click();
      await page.getByRole('status').filter({ hasText: '1 of 1 member added' }).waitFor();
      await select('Jordan Lee');
      await page.getByLabel('Reason for adding accounts').fill('Changed reason must not clear review');
      assert.equal(await page.getByRole('button', { name: 'Add 1 member' }).isDisabled(), true);

      // Actual parent tabs retain the selected draft and unresolved guard.
      await page.getByRole('tab', { name: 'Operations' }).click();
      await page.getByRole('tab', { name: 'Groups' }).click();
      assert.equal(await page.getByRole('button', { name: 'Add 1 member' }).isDisabled(), true);
      await page.getByRole('button', { name: /Remove Jordan Lee .* from selection/ }).click();
      members = [];
      await page.getByRole('button', { name: /Research Users/ }).click();
      await select('Taylor Park');
      await select('Morgan Chen');
      await page.getByLabel('Reason for adding accounts').fill('Shared reason across tab changes');
      holdRequest = true;
      const countBeforeHeldRequest = requests.length;
      await page.getByRole('button', { name: 'Add 2 members' }).click();
      await page.waitForFunction(() => document.querySelector('#group-user')?.disabled);
      await page.getByRole('tab', { name: 'Operations' }).click();
      await page.getByRole('tab', { name: 'Groups' }).click();
      assert.equal(await picker.isDisabled(), true);
      assert.equal(await page.getByRole('button', { name: /Applying changes/ }).isDisabled(), true);
      assert.ok(pendingRequest);
      assert.equal(requests.length, countBeforeHeldRequest + 1, 'only one member is submitted at a time');
      holdRequest = false;
      members.push(people[2]);
      await pendingRequest.fulfill({ json: { success: true, actionId: 'action-tpark' } });
      await page.getByRole('status').filter({ hasText: '2 of 2 members added' }).waitFor();
      assert.equal(requests.length, countBeforeHeldRequest + 2);

      // Uncertain removals are visibly blocked, not enabled buttons that silently return.
      failUsername = 'tpark';
      await page.getByRole('button', { name: 'Remove tpark', exact: true }).click();
      await page.getByLabel('Reason for removing this account').fill('End project access');
      await page.getByRole('button', { name: 'Remove member', exact: true }).click();
      await page.getByRole('alert').filter({ hasText: 'Change for tpark was not confirmed' }).waitFor();
      await page.getByText('Review in Operations, then reload this page.', { exact: true }).waitFor();
      assert.equal(await page.getByRole('button', { name: 'Remove tpark', exact: true }).isDisabled(), true);

      // Each actual input/textarea has its own single component ring, not the global halo.
      for (const control of [picker, page.getByLabel('Reason for adding accounts'), page.getByPlaceholder('Name, email, username, ticket or request ID…')]) {
        await control.focus();
        const style = await control.evaluate((element) => ({ outline: getComputedStyle(element).outlineStyle, shadow: getComputedStyle(element).boxShadow }));
        assert.equal(style.outline, 'none');
        assert.ok(!style.shadow.includes('6px'), `global halo leaked: ${style.shadow}`);
        assert.notEqual(style.shadow, 'none');
      }
      await page.getByRole('button', { name: 'Quick navigation', exact: true }).click();
      const command = page.getByPlaceholder('Type a page or capability…');
      await command.focus();
      await page.waitForTimeout(250);
      assert.equal(await command.evaluate((element) => getComputedStyle(element).outlineStyle), 'none');
      const commandShadow = await page.locator('[data-slot="command-input-wrapper"]').evaluate((element) => getComputedStyle(element).boxShadow);
      assert.ok(!commandShadow.includes('6px'));
      assert.notEqual(commandShadow, 'none');
      await page.screenshot({ path: resolve(output, `command-${theme}-${width}.png`) });
      await command.press('Escape');
      if (width > 600) {
        await page.getByRole('button', { name: 'Demo Operator' }).click();
        await page.waitForTimeout(150);
        const offsets = await page.getByRole('menuitem').evaluateAll((items) => items.map((item) => item.querySelector('span').getBoundingClientRect().left));
        assert.equal(offsets[0], offsets[1]);
        await page.screenshot({ path: resolve(output, `account-menu-${theme}.png`) });
        await page.keyboard.press('Escape');
      }
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
      assert.deepEqual(errors, []);
      await page.screenshot({ path: resolve(output, `workspace-${theme}-${width}.png`), fullPage: true });
      console.log(`PASS ${theme} ${width}px: selection, shared reason, partial failure, uncertain guard, tab ownership, focus, menu, overflow`);
      await page.close();
    }
  }
} finally {
  await browser.close();
  await server.close();
}
