import assert from 'node:assert/strict';
import { createServer } from 'vite';
import { chromium } from '@playwright/test';
import ts from 'typescript';

const root = process.cwd();
const mocks = {
  'next/navigation': `export function useRouter(){return {push(path){window.fixtureNavigations ??= []; window.fixtureNavigations.push(path)},replace(path){window.fixtureRedirects ??= []; window.fixtureRedirects.push(path)}}}`,
  'framer-motion/m': `import React from 'react'; export const div = React.forwardRef(function MotionDiv(props, ref){return React.createElement('div',{...props,ref})})`,
  'swr': `import { useCallback, useState } from 'react'; export default function useSWR(key, fetcher, options){const [data,setData]=useState(options.fallbackData);const mutate=useCallback(async()=>{try{const next=await fetcher(key);setData(next);return next}catch(error){options.onError?.(error);throw error}},[key,fetcher,options]);return {data,mutate}}`,
  '@/components/support/RichTextEditor': `import React from 'react'; export function RichTextEditor({value,onChange,disabled,ariaLabel}){return React.createElement('div',{contentEditable:!disabled,'aria-label':ariaLabel,role:'textbox',onInput:(event)=>onChange(event.currentTarget.textContent ?? ''),suppressContentEditableWarning:true},value)}`,
  '@/components/support/RichTextContent': `import React from 'react'; export default function RichTextContent({content}){return React.createElement('div',{dangerouslySetInnerHTML:{__html:content}})}`,
  '@/components/support/LocalizedDateTime': `import React from 'react'; export function LocalizedDateTime({value}){return React.createElement('time',null,value)}`,
  '@/components/support/TicketEvidence': `import React,{useEffect,useState} from 'react'; export default function TicketEvidence({ticketId,canMutate}){const [state,setState]=useState('Loading evidence…');useEffect(()=>{fetch('/api/support/tickets/'+ticketId+'/attachments').then((response)=>response.ok?response.json():Promise.reject(new Error('Evidence read denied'))).then((body)=>setState(body.attachments[0]?.filename ?? 'No evidence')).catch((error)=>setState(error.message))},[ticketId]);return React.createElement('section',{'data-can-mutate':String(canMutate)},React.createElement('p',null,'Evidence permission: '+(canMutate?'mutate':'read only')),React.createElement('a',{href:'/api/support/tickets/'+ticketId+'/attachments/evidence-fixture/content','aria-label':'Download protected-evidence.txt'},state))}`,
  '@/components/admin/TicketDetailModal': `import React,{useEffect,useState} from 'react'; export function TicketAssignmentSection({ticketId,requesterName,requesterUsername}){const [access,setAccess]=useState('Loading owners…');useEffect(()=>{Promise.all([fetch('/api/auth/session').then((response)=>response.json()),fetch('/api/admin/support/tickets/'+ticketId+'/assignments').then((response)=>response.json())]).then(([session,result])=>setAccess(session.permissions.includes('tickets.assign')?'Assignment access: '+(result.assignments[0]?.targetLabel ?? 'none'):'Assignment access denied')).catch(()=>setAccess('Assignment access error'))},[ticketId]);return React.createElement('section',null,React.createElement('h3',null,'Owners'),React.createElement('p',null,requesterName ?? requesterUsername),React.createElement('p',null,access))}`,
};

const server = await createServer({
  configFile: false,
  root,
  logLevel: 'error',
  resolve: { dedupe: ['react', 'react-dom'], alias: [...Object.keys(mocks).map((key) => ({ find: key, replacement: `\0admin-ticket-doctor:${key}` })), { find: '@', replacement: root }] },
  server: { host: '127.0.0.1', port: 0 },
  plugins: [{
    name: 'admin-ticket-doctor',
    enforce: 'pre',
    resolveId(id) { if (id.startsWith('\0admin-ticket-doctor:')) return id; if (Object.hasOwn(mocks, id)) return `\0admin-ticket-doctor:${id}`; },
    load(id) { if (id.startsWith('\0admin-ticket-doctor:')) return mocks[id.slice('\0admin-ticket-doctor:'.length)]; },
    transform(code, id) { if (id.endsWith('.tsx') && !id.includes('node_modules')) return ts.transpileModule(code, { compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText; },
    configureServer(vite) { vite.middlewares.use(async (req, res, next) => { if (!req.url?.startsWith('/admin-ticket-doctor-fixture')) return next(); res.setHeader('content-type', 'text/html'); res.end(await vite.transformIndexHtml(req.url, '<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script type="module" src="/e2e/components/admin-ticket-doctor.fixture.tsx"></script></body></html>')); }); },
  }],
});

await server.listen();
const origin = `http://127.0.0.1:${server.httpServer.address().port}`;
const browser = await chromium.launch({ headless: true });
const widths = process.env.ADMIN_TICKET_DOCTOR_WIDTHS?.split(',').map(Number) ?? [390, 1280];

async function noOverflow(page) {
  const dimensions = await page.evaluate(() => ({ client: document.documentElement.clientWidth, scroll: document.documentElement.scrollWidth }));
  assert.ok(dimensions.scroll <= dimensions.client, `horizontal overflow: ${dimensions.scroll} > ${dimensions.client}`);
}

function ticket({ status = 'open', responsePosted = false } = {}) {
  return {
    id: 'admin-ticket-fixture', subject: 'Admin fixture ticket <subject>', category: 'account_issue', severity: 'high', body: '<p>Fixture ticket body with <strong>safe content</strong>.</p>', status, username: 'fixture.requester', displayName: 'Fixture Requester', createdAt: '2026-09-04T00:00:00.000Z', updatedAt: '2026-09-04T01:00:00.000Z', closedAt: status === 'closed' ? '2026-09-04T02:00:00.000Z' : null, closedBy: status === 'closed' ? 'fixture.staff' : null, assignees: ['Network Team'], requestedForGroupDn: 'CN=Network Team,OU=Groups,DC=example,DC=test',
    responses: [{ id: 'response-existing', message: '<p>Existing staff response.</p>', author: 'fixture.staff', authorDisplayName: 'Fixture Staff', isStaff: true, createdAt: '2026-09-04T01:00:00.000Z' }, ...(responsePosted ? [{ id: 'response-new', message: '<p>Fixture reply with enough detail.</p>', author: 'fixture.staff', isStaff: true, createdAt: '2026-09-04T02:00:00.000Z' }] : [])],
    statusLogs: [{ id: 'history-created', createdAt: '2026-09-04T00:00:00.000Z', oldStatus: null, newStatus: 'open', changedBy: 'fixture.staff', changedByDisplayName: 'Fixture Staff', isStaff: true }],
  };
}

async function verify(width) {
  const page = await browser.newPage({ viewport: { width, height: 1000 } });
  const browserErrors = []; const externalRequests = []; const replies = []; const patches = [];
  let replyAttempts = 0; let responsePosted = false; let status = 'open'; let evidenceReads = 0;
  page.on('pageerror', (error) => browserErrors.push(error.message));
  await page.context().addCookies([{ name: 'csrf-token', value: 'fixture-csrf', url: origin }]);
  await page.route('**/*', async (route) => {
    const request = route.request();
    if (!request.url().startsWith(origin)) { externalRequests.push(request.url()); return route.abort(); }
    const url = new URL(request.url());
    if (!url.pathname.startsWith('/api/')) return route.continue();
    if (url.pathname === '/api/csrf-token') return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ csrfToken: 'fixture-csrf' }) });
    if (url.pathname === '/api/support/tickets/admin-ticket-fixture' && request.method() === 'GET') return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ ticket: ticket({ status, responsePosted }) }) });
    if (url.pathname === '/api/support/tickets/admin-ticket-fixture/responses' && request.method() === 'POST') { replyAttempts += 1; replies.push({ body: request.postDataJSON(), csrf: request.headers()['x-csrf-token'], idempotency: request.headers()['x-idempotency-key'] }); if (replyAttempts === 1) return route.fulfill({ status: 422, contentType: 'application/json', body: JSON.stringify({ error: 'Fixture response policy rejected this reply.' }) }); responsePosted = true; return route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify({ responseId: 'response-new' }) }); }
    if (url.pathname === '/api/support/tickets/admin-ticket-fixture' && request.method() === 'PATCH') { patches.push({ body: request.postDataJSON(), csrf: request.headers()['x-csrf-token'] }); status = request.postDataJSON().status; return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ticket: ticket({ status, responsePosted }) }) }); }
    if (url.pathname === '/api/support/tickets/admin-ticket-fixture/attachments' && request.method() === 'GET') { evidenceReads += 1; return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ attachments: [{ id: 'evidence-fixture', filename: 'protected-evidence.txt' }] }) }); }
    if (url.pathname === '/api/auth/session') return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ permissions: ['tickets.assign'] }) });
    if (url.pathname === '/api/admin/support/tickets/admin-ticket-fixture/assignments') return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ assignments: [{ targetLabel: 'Network Team' }] }) });
    return route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ error: `Unexpected fixture API ${url.pathname}` }) });
  });
  await page.goto(`${origin}/admin-ticket-doctor-fixture`, { timeout: 20_000 });
  page.setDefaultTimeout(5_000);
  await page.getByRole('heading', { name: 'Admin fixture ticket <subject>' }).waitFor();
  await page.getByText('Existing staff response.').waitFor();
  await page.getByText('Assignment access: Network Team').waitFor();
  await page.getByText('Evidence permission: mutate').waitFor();
  await page.getByRole('link', { name: 'Download protected-evidence.txt' }).waitFor();
  assert.ok(evidenceReads >= 1, 'evidence is read only through the protected ticket route');
  const editor = page.getByRole('textbox', { name: 'Type your response here' });
  await editor.fill('Fixture reply with enough detail.');
  await page.getByRole('button', { name: 'Submit Response', exact: true }).click();
  await page.getByText('Fixture response policy rejected this reply.').waitFor();
  await page.getByRole('button', { name: 'Submit Response', exact: true }).click();
  await page.getByText('Fixture reply with enough detail.').last().waitFor();
  assert.equal(replies.length, 2, 'the error path preserves a retry');
  assert.deepEqual(replies.map((reply) => reply.body), [{ bodyHtml: 'Fixture reply with enough detail.' }, { bodyHtml: 'Fixture reply with enough detail.' }]);
  assert.equal(replies[0].csrf, 'fixture-csrf');
  assert.equal(replies[0].idempotency, replies[1].idempotency, 'retry reuses the idempotency key');
  await page.getByRole('button', { name: 'Mark In Progress', exact: true }).click();
  await page.getByRole('button', { name: 'Close Ticket', exact: true }).click();
  assert.deepEqual(patches, [{ body: { status: 'in_progress' }, csrf: 'fixture-csrf' }, { body: { status: 'closed' }, csrf: 'fixture-csrf' }]);
  await page.getByText('This ticket is closed. Reopen it to add more responses.').waitFor();
  await noOverflow(page);
  assert.deepEqual(externalRequests, [], 'fixture must abort all external requests');
  assert.deepEqual(browserErrors, [], `browser errors: ${browserErrors.join('\n')}`);
  await page.close();
}

try {
  for (const width of widths) await verify(width);
  console.log('PASS: admin ticket fixture validates loaded display, reply error/retry and idempotency, status PATCH contracts, assignment permission rendering, protected evidence read, and 390/1280 layouts.');
} finally {
  await browser.close();
  await server.close();
}
