import assert from 'node:assert/strict';
import { createServer } from 'vite';
import { chromium } from '@playwright/test';
import ts from 'typescript';
import AxeBuilder from '@axe-core/playwright';

const root = process.cwd();
const mocks = {
  'next/navigation': `export function useRouter(){return {push(){},replace(){}}}`,
  '@/hooks/usePolling': `export function usePolling(){return {isLoading:false,isPolling:false,togglePolling(){},refresh:async()=>{},lastUpdated:null}}`,
  '@/components/support/TicketPeek': `import React from 'react'; export default function TicketPeek(){return React.createElement('span',null)}`,
};
const nullComponent = `import React from 'react'; export default function FixtureModal(){return null}`;

const server = await createServer({
  configFile: false,
  root,
  cacheDir: 'node_modules/.vite-react-doctor-csv',
  logLevel: 'error',
  resolve: { dedupe: ['react', 'react-dom'], alias: [...Object.keys(mocks).map((key) => ({ find: key, replacement: `\0csv-doctor:${key}` })), { find: '@', replacement: root }] },
  server: { host: '127.0.0.1', port: 0 },
  plugins: [{
    name: 'csv-doctor',
    enforce: 'pre',
    resolveId(id, importer) {
      if (id.startsWith('\0csv-doctor:')) return id;
      if (Object.hasOwn(mocks, id)) return `\0csv-doctor:${id}`;
      if (id === './TicketDetailModal' && importer?.includes('SupportTicketsTab')) return '\0csv-doctor:TicketDetailModal';
      if (id === './UserDetailModal' && importer?.includes('UserManagementTab')) return '\0csv-doctor:UserDetailModal';
      if (['./VPNImportModal', './VPNADMatchModal', './VPNAccountDetailModal'].includes(id) && importer?.includes('VPNManagementTab')) return `\0csv-doctor:${id.slice(2)}`;
    },
    load(id) {
      if (id.startsWith('\0csv-doctor:')) {
        const key = id.slice('\0csv-doctor:'.length);
        return mocks[key] ?? nullComponent;
      }
    },
    transform(code, id) { if (id.endsWith('.tsx') && !id.includes('node_modules')) return ts.transpileModule(code, { compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText; },
    configureServer(vite) { vite.middlewares.use(async (req, res, next) => { if (!req.url?.startsWith('/csv-doctor-fixture')) return next(); res.setHeader('content-type', 'text/html'); res.end(await vite.transformIndexHtml(req.url, '<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script type="module" src="/e2e/components/csv-doctor.fixture.tsx"></script></body></html>')); }); },
  }],
});

await server.listen();
const origin = `http://127.0.0.1:${server.httpServer.address().port}`;
const browser = await chromium.launch({ headless: true });

try {
  for (const width of [390, 1280]) {
  const context = await browser.newContext({ viewport: { width, height: 1000 } });
  const page = await context.newPage();
  const browserErrors = []; const externalRequests = []; const apiRequests = [];
  page.on('pageerror', (error) => browserErrors.push(error.message));
  page.on('requestfailed', request => console.error('Fixture request failed:', request.url(), request.failure()?.errorText));
  await page.addInitScript(() => {
    const nativeCreate = URL.createObjectURL.bind(URL);
    const nativeRevoke = URL.revokeObjectURL.bind(URL);
    const live = new Map();
    const downloads = [];
    URL.createObjectURL = (blob) => {
      const url = nativeCreate(blob);
      live.set(url, blob.size);
      return url;
    };
    URL.revokeObjectURL = (url) => {
      live.delete(url);
      nativeRevoke(url);
    };
    document.addEventListener('click', (event) => {
      const link = event.target instanceof Element ? event.target.closest('a[download]') : null;
      if (link instanceof HTMLAnchorElement && link.href.startsWith('blob:')) {
        downloads.push({ filename: link.download, bytes: fetch(link.href).then((response) => response.text()) });
      }
    }, true);
    window.__csvDoctor = { live, downloads, retainedBytes: () => Array.from(live.values()).reduce((total, bytes) => total + bytes, 0) };
  });
  await page.route('**/*', async (route) => {
    const request = route.request();
    if (!request.url().startsWith(origin)) { externalRequests.push(request.url()); return route.abort(); }
    if (new URL(request.url()).pathname.startsWith('/api/')) { apiRequests.push(request.url()); return route.fulfill({ status: 404, contentType: 'application/json', body: '{}' }); }
    return route.continue();
  });
  await page.goto(`${origin}/csv-doctor-fixture`, { timeout: 60_000 });
  page.setDefaultTimeout(5_000);
  const usernameHeading = page.locator('#vpn-csv').getByRole('columnheader', { name: /Username/ });
  const sortMarker = usernameHeading.locator('span');
  await sortMarker.evaluate(element => { element.dataset.identityMarker = 'retained'; });
  await usernameHeading.click();
  assert.equal(await sortMarker.getAttribute('data-identity-marker'), 'retained', 'sorting must update the existing icon rather than remount it');
  assert.equal(await sortMarker.innerText(), '↑');
  await usernameHeading.click();
  assert.equal(await sortMarker.innerText(), '↓');
  for (const id of ['support-csv', 'users-csv', 'vpn-csv']) {
    const button = page.locator(`#${id} button[title="Export filtered results to CSV"]`);
    await button.waitFor();
    await button.click();
    await button.click();
    await button.click();
  }
  await page.waitForTimeout(25);
  const result = await page.evaluate(async () => {
    const doctor = window.__csvDoctor;
    return {
      downloads: await Promise.all(doctor.downloads.map(async (entry) => ({ filename: entry.filename, text: await entry.bytes }))),
      liveUrls: doctor.live.size,
      retainedBytes: doctor.retainedBytes(),
    };
  });
  assert.equal(result.downloads.length, 9, 'three repeated exports per actual component');
  assert.equal(result.liveUrls, 0, 'all object URLs are revoked after deferred download dispatch');
  assert.equal(result.retainedBytes, 0, 'no Blob bytes remain retained by object URLs');
  const expected = [
    { prefix: 'support_tickets_', content: 'support.fixture' },
    { prefix: 'users_export_', content: 'user.fixture' },
    { prefix: 'vpn_accounts_', content: 'vpn.fixture' },
  ];
  for (let index = 0; index < expected.length; index += 1) {
    const entries = result.downloads.slice(index * 3, index * 3 + 3);
    for (const entry of entries) {
      assert.match(entry.filename, new RegExp(`^${expected[index].prefix}\\d{4}-\\d{2}-\\d{2}.*\\.csv$`));
      assert.match(entry.text, new RegExp(expected[index].content));
    }
  }
  assert.deepEqual(apiRequests, [], 'CSV export uses no network API');
  const vpn = page.locator('#vpn-csv');
  const vpnSearch = vpn.getByPlaceholder('Search by username, name, email, or created by...');
  await vpnSearch.fill('no-such-synthetic-vpn-account');
  assert.equal(await vpn.getByRole('button', { name: 'Manage', exact: true }).count(), 0, 'search filters the actual VPN list');
  await vpn.getByRole('button', { name: 'Clear All', exact: true }).click();
  assert.equal(await vpnSearch.inputValue(), '');
  await vpn.getByRole('button', { name: 'Advanced Filters', exact: true }).click();
  await vpn.getByRole('combobox').first().click();
  await page.getByRole('option', { name: 'Revoked', exact: true }).click();
  assert.equal(await vpn.getByRole('button', { name: 'Manage', exact: true }).count(), 0, 'status filters the actual VPN list');
  await vpn.getByRole('button', { name: 'Clear All', exact: true }).click();
  await vpn.getByRole('button', { name: 'Split by Portal', exact: true }).click();
  await vpn.getByRole('button', { name: 'Manage', exact: true }).waitFor();
  await vpn.getByRole('button', { name: 'Unified List', exact: true }).click();
  await vpn.getByRole('button', { name: 'Manage', exact: true }).click();
  const statusDialog = page.getByRole('dialog');
  const statusReason = statusDialog.getByRole('textbox', { name: 'Reason for Change (Optional)', exact: true });
  await statusReason.fill('Synthetic status evidence');
  assert.equal(await statusReason.inputValue(), 'Synthetic status evidence');
  const statusAccessibility = await new AxeBuilder({ page }).include('[role="dialog"]').withRules(['label']).analyze();
  assert.deepEqual(statusAccessibility.violations, [], 'status fields need associated labels');
  await statusDialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  await vpn.getByRole('checkbox').last().check();
  await vpn.getByRole('button', { name: 'Bulk (1)', exact: true }).click();
  const bulkDialog = page.getByRole('dialog', { name: 'Bulk Edit Status' });
  const bulkReason = bulkDialog.getByRole('textbox', { name: 'Reason (Optional)', exact: true });
  await bulkReason.fill('Synthetic bulk evidence');
  assert.equal(await bulkReason.inputValue(), 'Synthetic bulk evidence');
  await bulkDialog.getByRole('combobox').click();
  await page.getByRole('option', { name: 'Disabled', exact: true }).click();
  await bulkDialog.getByRole('checkbox', { name: /Mark as Faculty Approved/ }).uncheck();
  assert.match(await bulkDialog.innerText(), /Use this if accounts need further review/);
  const bulkAccessibility = await new AxeBuilder({ page }).include('[role="dialog"]').withRules(['label']).analyze();
  assert.deepEqual(bulkAccessibility.violations, [], 'bulk fields need associated labels');
  await bulkDialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  await vpn.getByRole('button', { name: 'Bulk (1)', exact: true }).click();
  assert.equal(await bulkReason.inputValue(), '', 'cancel resets only the bulk draft');
  assert.equal(await bulkDialog.getByRole('combobox').innerText(), 'Active');
  assert.equal(await bulkDialog.getByRole('checkbox', { name: /Mark as Faculty Approved/ }).isChecked(), true);
  assert.match(await bulkDialog.innerText(), /This indicates the VPN accounts have been properly provisioned/);
  await bulkDialog.getByRole('button', { name: 'Remove', exact: true }).click();
  assert.equal(await bulkDialog.getByRole('button', { name: 'Update 0 Account(s)', exact: true }).isDisabled(), true);
  await bulkDialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  assert.deepEqual(apiRequests, [], 'opening, editing and cancelling status drafts performs no API mutation');
  await page.goto(`${origin}/csv-doctor-fixture?vpnMany=1`);
  await vpn.getByRole('button', { name: 'Next', exact: true }).waitFor();
  assert.equal(await vpn.getByRole('button', { name: 'Manage', exact: true }).count(), 25);
  await vpn.getByRole('button', { name: 'Next', exact: true }).click();
  await vpn.getByText('Page 2 of 2', { exact: true }).waitFor();
  assert.equal(await vpn.getByRole('button', { name: 'Manage', exact: true }).count(), 1);
  await vpnSearch.fill('vpn.fixture.25');
  await vpn.getByRole('button', { name: 'Manage', exact: true }).waitFor();
  assert.equal(await vpn.getByRole('button', { name: 'Next', exact: true }).count(), 0, 'filtering resets pagination to a visible first page');
  await vpn.getByRole('button', { name: 'Clear All', exact: true }).click();
  await vpn.getByText('Page 1 of 2', { exact: true }).waitFor();
  await vpn.getByRole('button', { name: 'Split by Portal', exact: true }).click();
  await vpn.getByRole('button', { name: 'Next', exact: true }).click();
  await vpn.getByText('Page 2 of 2', { exact: true }).waitFor();
  assert.equal(await vpn.getByRole('button', { name: 'Manage', exact: true }).count(), 1, 'split view paginates the same account population');
  await vpn.getByRole('button', { name: 'First', exact: true }).click();
  await vpn.getByRole('combobox').click();
  await page.getByRole('option', { name: '10', exact: true }).click();
  await vpn.getByText('Page 1 of 3', { exact: true }).waitFor();
  assert.equal(await vpn.getByRole('button', { name: 'Manage', exact: true }).count(), 10, 'changing page size resets to the first page');
  assert.deepEqual(apiRequests, [], 'filtering and paging remain local-only');
  await vpn.getByRole('button', { name: 'Clear Queue', exact: true }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Cancel', exact: true }).click();
  assert.deepEqual(apiRequests, [], 'canceling the actual import clear dialog issues no DELETE');
  const statusCalls = [];
  let singleAttempts = 0;
  let bulkAttempts = 0;
  await context.addCookies([{ name: 'csrf-token', value: 'synthetic-status-csrf', url: origin }]);
  await page.route(`${origin}/api/admin/vpn-accounts/**`, (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    statusCalls.push({ path, method: request.method(), csrf: request.headers()['x-csrf-token'], body: request.postDataJSON() });
    const attempt = path.endsWith('/bulk-status') ? ++bulkAttempts : ++singleAttempts;
    return route.fulfill({ status: attempt === 1 ? 500 : 200, json: attempt === 1 ? { error: 'Synthetic bulk rejection' } : { updatedCount: 1, skippedCount: 0 } });
  });
  await vpn.getByRole('button', { name: 'Manage', exact: true }).first().click();
  await statusReason.fill('  synthetic single reason  ');
  await statusDialog.getByRole('button', { name: 'Update Status', exact: true }).click();
  await page.getByText('Failed to update status', { exact: true }).waitFor();
  assert.equal(await statusReason.inputValue(), '  synthetic single reason  ', 'a rejected status change retains its draft');
  await statusDialog.getByRole('button', { name: 'Update Status', exact: true }).click();
  await statusDialog.waitFor({ state: 'hidden' });
  await page.getByText('Account status updated successfully', { exact: true }).waitFor();
  await vpn.getByRole('button', { name: 'Manage', exact: true }).first().click();
  assert.equal(await statusReason.inputValue(), '', 'a successful status change clears its reason');
  await statusDialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  await vpn.getByRole('checkbox').nth(1).check();
  await vpn.getByRole('button', { name: 'Bulk (1)', exact: true }).click();
  await bulkReason.fill('  synthetic bulk reason  ');
  await bulkDialog.getByRole('button', { name: 'Update 1 Account(s)', exact: true }).click();
  await page.getByText('Synthetic bulk rejection', { exact: true }).waitFor();
  assert.equal(await bulkReason.inputValue(), '  synthetic bulk reason  ', 'a rejected bulk change retains its draft and selection');
  await bulkDialog.getByRole('button', { name: 'Update 1 Account(s)', exact: true }).click();
  await bulkDialog.waitFor({ state: 'hidden' });
  await page.getByText('Successfully updated 1 account(s)', { exact: true }).waitFor();
  assert.equal(await vpn.getByRole('button', { name: 'Bulk (1)', exact: true }).count(), 0, 'bulk success clears the selection');
  assert.deepEqual(statusCalls, [
    ...Array.from({ length: 2 }, () => ({ path: '/api/admin/vpn-accounts/vpn-fixture-0/status', method: 'PATCH', csrf: 'synthetic-status-csrf', body: { status: 'active', reason: '  synthetic single reason  ' } })),
    ...Array.from({ length: 2 }, () => ({ path: '/api/admin/vpn-accounts/bulk-status', method: 'PATCH', csrf: 'synthetic-status-csrf', body: { accountIds: ['vpn-fixture-0'], newStatus: 'active', reason: '  synthetic bulk reason  ', createdByFaculty: true } })),
  ], 'actual single/bulk controls preserve CSRF and exact retry payloads');
  assert.deepEqual(externalRequests, [], 'fixture aborts all external requests');
  assert.deepEqual(browserErrors, [], `browser errors: ${browserErrors.join('\n')}`);
  console.log(`PASS ${width}: 9 actual CSV exports retain 0 URLs/Blob bytes; sort identity and labelled VPN status/bulk draft cancellation remain intact.`);
  await context.close();
  }
} finally {
  await browser.close();
  await server.close();
}
