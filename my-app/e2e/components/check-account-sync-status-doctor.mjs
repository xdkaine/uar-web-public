import assert from 'node:assert/strict';
import AxeBuilder from '@axe-core/playwright';
import { chromium } from '@playwright/test';
import { createServer } from 'vite';
import ts from 'typescript';

const root = process.cwd();
const mocks = {
  '@/components/ui/button': `export function Button({children,...props}){return <button {...props}>{children}</button>}`,
  '@/components/ui/input': `export function Input(props){return <input {...props}/>}`,
  '@/components/ui/card': `export function Card({children}){return <section>{children}</section>} export function CardContent({children}){return <div>{children}</div>} export function CardHeader({children}){return <header>{children}</header>} export function CardTitle({children}){return <h2>{children}</h2>}`,
  '@/components/ui/select': `export function Select({children}){return <div>{children}</div>} export function SelectContent({children}){return <div>{children}</div>} export function SelectItem({children}){return <span>{children}</span>} export function SelectTrigger({children}){return <button type="button">{children}</button>} export function SelectValue(){return null}`,
  '@/components/ui/table': `export function Table({children}){return <table>{children}</table>} export function TableBody({children}){return <tbody>{children}</tbody>} export function TableCell({children}){return <td>{children}</td>} export function TableHead({children,...props}){return <th {...props}>{children}</th>} export function TableHeader({children}){return <thead>{children}</thead>} export function TableRow({children,...props}){return <tr {...props}>{children}</tr>}`,
  '@/components/ui/dialog': `export function Dialog({open,children}){return open?<div role="dialog">{children}</div>:null} export function DialogContent({children}){return <div>{children}</div>} export function DialogHeader({children}){return <header>{children}</header>} export function DialogTitle({children}){return <h2>{children}</h2>}`,
  '@/components/ui/badge': `export function Badge({children}){return <span>{children}</span>}`,
  '@/components/ui/status-badge': `export function StatusBadge({children}){return <span>{children}</span>}`,
  '@/components/ui/label': `export function Label({children,...props}){return <label {...props}>{children}</label>}`,
  'lucide-react': `export const Download=()=>null; export const Filter=()=>null; export const RefreshCw=()=>null; export const Search=()=>null; export const CheckIcon=()=>null; export const ChevronDownIcon=()=>null; export const ChevronUpIcon=()=>null; export const XIcon=()=>null;`,
  '@/components/admin/ClientLocalDate': `export function ClientLocalDate({value}){return <time>{String(value)}</time>}`,
};
const server = await createServer({
  configFile: false,
  root,
  logLevel: 'error',
  resolve: { dedupe: ['react', 'react-dom'], alias: [{ find: '@', replacement: root }] },
  server: { host: '127.0.0.1', port: 0 },
  plugins: [{
    name: 'account-sync-status-doctor-fixture',
    enforce: 'pre',
    resolveId(id) { if (id.startsWith('\0sync-status:')) return id; if (Object.hasOwn(mocks, id)) return `\0sync-status:${id}.tsx`; },
    load(id) { if (id.startsWith('\0sync-status:')) return mocks[id.slice('\0sync-status:'.length, -4)]; },
    transform(code, id) {
      if (id.endsWith('.tsx') && !id.includes('node_modules')) return ts.transpileModule(code, { compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
    },
    configureServer(vite) {
      vite.middlewares.use(async (request, response, next) => {
        if (!request.url?.startsWith('/account-sync-status-doctor-fixture')) return next();
        response.setHeader('content-type', 'text/html');
        response.end(await vite.transformIndexHtml(request.url, '<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>Account sync status fixture</title></head><body><div id="root"></div><script type="module" src="/e2e/components/account-sync-status-doctor.fixture.tsx"></script></body></html>'));
      });
    },
  }],
});

const account = {
  identifier: 'fixture.user', name: 'Fixture User', email: 'fixture.user@example.test', hasAdAccount: true, adUsername: 'fixture.user', adDisplayName: 'Fixture User', adEmail: 'fixture.user@example.test', adAccountEnabled: true, adSyncDate: '2026-09-04T14:15:16.000Z', hasVpnAccount: false, vpnUsername: null, vpnPortalType: null, vpnStatus: null, vpnCreatedAt: null, hasAccessRequest: false, requestId: null, requestStatus: null, requestCreatedAt: null, isManuallyAssigned: false, syncStatus: 'orphaned', syncIssues: ['Missing managed request', 'Missing managed request'], lastSyncId: 'sync-fixture-1', wasAutoAssigned: false, resolutionKind: 'create_request_link',
};
const latestSync = { id: 'sync-fixture-1', createdAt: '2026-09-04T14:00:00.000Z', completedAt: '2026-09-04T14:15:16.000Z', status: 'completed', totalADAccounts: 1, totalVPNAccounts: 0, matchedAccounts: 0, unmatchedAD: 1, unmatchedVPN: 0, autoAssigned: 0 };

await server.listen();
const origin = `http://127.0.0.1:${server.httpServer.address().port}`;
const browser = await chromium.launch({ headless: true });
try {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await context.addCookies([{ name: 'csrf-token', value: 'fixture-csrf', url: origin }]);
  const page = await context.newPage();
  const externalRequests = [];
  const requests = [];
  let syncStatusReads = 0;
  page.on('pageerror', (error) => { throw error; });
  await page.route('**/*', async (route) => {
    const request = route.request();
    if (!request.url().startsWith(origin)) { externalRequests.push(request.url()); return route.abort(); }
    const url = new URL(request.url());
    if (!url.pathname.startsWith('/api/')) return route.continue();
    if (url.pathname === '/api/admin/sync-status' && request.method() === 'GET') {
      requests.push({ method: 'GET' });
      syncStatusReads += 1;
      if (syncStatusReads === 4) return route.fulfill({ contentType: 'application/json', body: JSON.stringify({}) });
      return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ accounts: [account], latestSync }) });
    }
    if (url.pathname === '/api/admin/sync-status/resolve' && request.method() === 'POST') {
      requests.push({ method: 'POST', csrf: request.headers()['x-csrf-token'], body: request.postDataJSON() });
      return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ message: 'Fixture linkage resolved' }) });
    }
    return route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ error: `Unexpected fixture API ${request.method()} ${url.pathname}` }) });
  });

  await page.goto(`${origin}/account-sync-status-doctor-fixture`);
  await page.getByRole('cell', { name: 'Fixture User', exact: true }).waitFor();
  await page.getByRole('button', { name: 'View Details', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByText('Resolve portal linkage', { exact: true }).waitFor();
  assert.equal(await dialog.getByText('Missing managed request', { exact: true }).count(), 1, 'duplicate issue copy uses one stable semantic list item');
  await dialog.getByRole('button', { name: 'Resolve request linkage', exact: true }).click();
  await page.getByRole('dialog').waitFor({ state: 'detached' });
  await page.getByRole('button', { name: 'Refresh', exact: true }).click();
  await page.waitForFunction(() => document.body.textContent?.includes('Updated:'));
  await page.getByRole('button', { name: 'Use prop B', exact: true }).click();
  await page.getByRole('cell', { name: 'Prop B User', exact: true }).waitFor();
  await page.getByRole('button', { name: 'Refresh', exact: true }).click();
  await page.getByText('22', { exact: true }).waitFor();
  assert.equal(await page.getByRole('cell', { name: 'Prop B User', exact: true }).count(), 1, 'a partial poll after props change must not restore prior accounts');
  assert.equal(await page.getByRole('cell', { name: 'Fixture User', exact: true }).count(), 0, 'a partial poll after props change must retain the current accounts prop');
  const axe = await new AxeBuilder({ page }).withRules(['button-name']).analyze();
  assert.equal(axe.violations.length, 0, `axe violations: ${axe.violations.map((violation) => violation.id).join(', ')}`);
  assert.ok(requests.filter((request) => request.method === 'GET').length >= 2, 'initial load and refresh use the local fixture API');
  assert.deepEqual(requests.find((request) => request.method === 'POST'), { method: 'POST', csrf: 'fixture-csrf', body: { identifier: 'fixture.user' } }, 'resolution preserves the CSRF request and identifier-only contract');
  assert.deepEqual(externalRequests, [], 'fixture aborts every non-local request');
  await context.close();
  console.log('PASS: Sync-status fixture validates polling data, filters, stable issue keys, detail resolution, CSRF identifier contract, refresh, button names, and local-only networking.');
} finally {
  await browser.close();
  await server.close();
}
