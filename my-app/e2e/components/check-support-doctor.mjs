import assert from 'node:assert/strict';
import { createServer } from 'vite';
import { chromium } from '@playwright/test';
import ts from 'typescript';

const root = process.cwd();
const mocks = {
  'next/navigation': `export function useRouter(){return {push(path){window.fixtureRedirects ??= []; window.fixtureRedirects.push(path)}}}`,
  'next/image': `import React from 'react'; export default function Image({ src, alt, ...props }){ return React.createElement('img',{src,alt,...props}) }`,
  'swr': `import { useCallback, useState } from 'react'; export default function useSWR(key, fetcher, options){ const [data,setData]=useState(options.fallbackData); const mutate=useCallback(async()=>{try{const next=await fetcher(key);setData(next);return next}catch(error){options.onError?.(error);throw error}},[key,fetcher,options]); return {data,mutate}; }`,
  '@/components/appearance/PortalPageHeading': `import React from 'react'; export default function Heading({ title }){return React.createElement('h1',null,title ?? 'Create Support Ticket')}`,
};
const server = await createServer({
  configFile: false, root, logLevel: 'error',
  resolve: { dedupe: ['react', 'react-dom'], alias: [...Object.keys(mocks).map((key) => ({ find: key, replacement: `\0support-doctor:${key}` })), { find: '@', replacement: root }] },
  server: { host: '127.0.0.1', port: 0 },
  plugins: [{
    name: 'support-doctor', enforce: 'pre',
    resolveId(id) { if (id.startsWith('\0support-doctor:')) return id; if (Object.hasOwn(mocks, id)) return `\0support-doctor:${id}`; },
    load(id) { if (id.startsWith('\0support-doctor:')) return mocks[id.slice('\0support-doctor:'.length)]; },
    transform(code, id) { if (id.endsWith('.tsx') && !id.includes('node_modules')) return ts.transpileModule(code, { compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText; },
    configureServer(vite) { vite.middlewares.use(async (req, res, next) => { const entry = req.url?.startsWith('/support-doctor-detail-fixture') ? 'support-doctor-detail.fixture.tsx' : req.url?.startsWith('/support-doctor-fixture') ? 'support-doctor.fixture.tsx' : null; if (!entry) return next(); res.setHeader('content-type', 'text/html'); res.end(await vite.transformIndexHtml(req.url, `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script type="module" src="/e2e/components/${entry}"></script></body></html>`)); }); },
  }],
});
await server.listen();
const origin = `http://127.0.0.1:${server.httpServer.address().port}`;
const browser = await chromium.launch({ headless: true });
const widths = process.env.SUPPORT_DOCTOR_WIDTHS?.split(',').map(Number) ?? [390, 1280];

async function noOverflow(page) {
  const dimensions = await page.evaluate(() => ({ client: document.documentElement.clientWidth, scroll: document.documentElement.scrollWidth }));
  assert.ok(dimensions.scroll <= dimensions.client, `horizontal overflow: ${dimensions.scroll} > ${dimensions.client}`);
}

function detailTicket({ closed = false, responsePosted = false } = {}) {
  return {
    id: 'ticket-fixture', subject: 'Fixture ticket <subject>', category: 'account_issue', severity: 'medium',
    body: '<p>Fixture ticket body with <strong>safe content</strong>.</p>', status: closed ? 'closed' : 'open',
    username: 'fixture.requester', displayName: 'Fixture Requester', createdAt: '2026-09-04T00:00:00.000Z', updatedAt: '2026-09-04T01:00:00.000Z', closedAt: closed ? '2026-09-04T02:00:00.000Z' : null, closedBy: closed ? 'fixture.requester' : null, viewerRole: 'owner',
    responses: [
      { id: 'response-existing', message: '<p>Existing staff response.</p>', author: 'fixture.staff', authorDisplayName: 'Fixture Staff', isStaff: true, createdAt: '2026-09-04T01:00:00.000Z' },
      ...(responsePosted ? [{ id: 'response-new', message: '<p>Fixture reply with enough detail.</p>', author: 'fixture.requester', authorDisplayName: 'Fixture Requester', isStaff: false, createdAt: '2026-09-04T02:00:00.000Z' }] : []),
    ],
    statusLogs: [{ id: 'history-created', createdAt: '2026-09-04T00:00:00.000Z', oldStatus: null, newStatus: 'open', changedBy: 'fixture.requester', changedByDisplayName: 'Fixture Requester', isStaff: false }],
  };
}

async function verifyTicketDetail(width) {
  const page = await browser.newPage({ viewport: { width, height: 1000 } });
  const browserErrors = []; const externalRequests = []; const responseRequests = []; const attachmentRequests = [];
  let responseAttempt = 0; let responsePosted = false; let closed = false; let attachmentReads = 0;
  page.on('pageerror', (error) => browserErrors.push(error.message));
  await page.context().addCookies([{ name: 'csrf-token', value: 'fixture-csrf', url: origin }]);
  await page.route('**/*', async (route) => {
    const request = route.request();
    if (!request.url().startsWith(origin)) { externalRequests.push(request.url()); return route.abort(); }
    const url = new URL(request.url());
    if (!url.pathname.startsWith('/api/')) return route.continue();
    if (url.pathname === '/api/csrf-token') return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ csrfToken: 'fixture-csrf' }) });
    if (url.pathname === '/api/support/tickets/ticket-fixture' && request.method() === 'GET') return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ ticket: detailTicket({ closed, responsePosted }) }) });
    if (url.pathname === '/api/support/tickets/ticket-fixture/responses' && request.method() === 'POST') {
      responseAttempt += 1; responseRequests.push({ body: request.postDataJSON(), csrf: request.headers()['x-csrf-token'] });
      if (responseAttempt === 1) return route.fulfill({ status: 422, contentType: 'application/json', body: JSON.stringify({ error: 'Fixture response policy rejected this reply.' }) });
      responsePosted = true;
      return route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify({ responseId: 'response-new' }) });
    }
    if (url.pathname === '/api/support/tickets/ticket-fixture' && request.method() === 'PATCH') {
      assert.deepEqual(request.postDataJSON(), { status: 'closed' });
      assert.equal(request.headers()['x-csrf-token'], 'fixture-csrf');
      closed = true;
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ticket: detailTicket({ closed, responsePosted }) }) });
    }
    if (url.pathname === '/api/support/tickets/ticket-fixture/attachments' && request.method() === 'GET') {
      attachmentReads += 1;
      return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ attachments: [{ id: 'fixture-log', filename: 'fixture-log.txt', contentType: 'text/plain', sizeBytes: 17, createdAt: '2026-09-04T00:00:00.000Z' }, ...(attachmentRequests.length ? [{ id: 'uploaded-evidence', filename: 'uploaded-evidence.txt', contentType: 'text/plain', sizeBytes: 16 }] : [])] }) });
    }
    if (url.pathname === '/api/support/tickets/ticket-fixture/attachments' && request.method() === 'POST') {
      attachmentRequests.push({ body: request.postData() ?? '', csrf: request.headers()['x-csrf-token'] });
      return route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify({}) });
    }
    if (url.pathname === '/api/support/tickets/ticket-fixture/attachments/fixture-log/preview') return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ text: 'fixture protected evidence', language: 'text', truncated: false }) });
    return route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ error: `Unexpected detail fixture API ${url.pathname}` }) });
  });
  await page.goto(`${origin}/support-doctor-detail-fixture`, { timeout: 20_000 });
  page.setDefaultTimeout(5_000);
  await page.getByRole('heading', { name: 'Fixture ticket <subject>' }).waitFor();
  await page.getByText('Your ticket was created, but some evidence files could not be uploaded.').waitFor();
  await page.getByText('Existing staff response.').waitFor();
  await page.getByText('fixture-log.txt').waitFor();
  assert.ok(attachmentReads >= 1, 'the protected evidence list loads through its ticket route');
  const evidenceDownload = page.getByRole('link', { name: 'Download fixture-log.txt' });
  assert.match(await evidenceDownload.getAttribute('href'), /\/api\/support\/tickets\/ticket-fixture\/attachments\/fixture-log\/content$/, 'evidence is read only through the protected ticket content route');
  const editor = page.locator('[contenteditable="true"]').first();
  await editor.fill('Fixture reply with enough detail.');
  const submit = page.getByRole('button', { name: 'Submit Response', exact: true });
  assert.equal(await submit.isDisabled(), false, 'a detailed comment enables submission');
  const rejected = page.waitForResponse((response) => response.url().endsWith('/responses') && response.status() === 422);
  await submit.click(); await rejected;
  await page.getByText('Fixture response policy rejected this reply.').waitFor();
  assert.equal(await submit.isDisabled(), false, 'a rejected comment is visible and retryable');
  const accepted = page.waitForResponse((response) => response.url().endsWith('/responses') && response.status() === 201);
  await submit.click(); await accepted;
  await page.getByText('Fixture reply with enough detail.').last().waitFor();
  assert.equal(responseRequests.length, 2);
  assert.equal(responseRequests[1].csrf, 'fixture-csrf');
  assert.match(responseRequests[1].body.replyHtml, /Fixture reply with enough detail/);
  await page.locator('#evidence-input-ticket-fixture').setInputFiles({ name: 'uploaded-evidence.txt', mimeType: 'text/plain', buffer: Buffer.from('private evidence') });
  await page.getByText('uploaded-evidence.txt').waitFor();
  assert.equal(attachmentRequests.length, 1, 'owner evidence uses the protected ticket attachment route');
  assert.equal(attachmentRequests[0].csrf, 'fixture-csrf');
  const closeTicket = page.getByRole('button', { name: 'Close Ticket', exact: true });
  await closeTicket.focus();
  await page.keyboard.press('Enter');
  await page.getByRole('button', { name: 'Reopen Ticket', exact: true }).waitFor();
  await page.getByText('This ticket is closed. Reopen it to add more responses.').waitFor();
  await noOverflow(page);
  assert.deepEqual(externalRequests, [], 'detail fixture must abort all external requests');
  assert.deepEqual(browserErrors, [], `detail browser errors: ${browserErrors.join('\n')}`);
  await page.close();
}

try {
  for (const width of widths) {
    const page = await browser.newPage({ viewport: { width, height: 1000 } });
    const browserErrors = []; const externalRequests = []; const ticketRequests = []; const attachmentRequests = [];
    let ticketAttempt = 0;
    page.on('pageerror', (error) => browserErrors.push(error.message));
    await page.context().addCookies([{ name: 'csrf-token', value: 'fixture-csrf', url: origin }]);
    await page.route('**/*', async (route) => {
      const request = route.request();
      if (!request.url().startsWith(origin)) { externalRequests.push(request.url()); return route.abort(); }
      const url = new URL(request.url());
      if (!url.pathname.startsWith('/api/')) return route.continue();
      if (url.pathname === '/api/csrf-token') return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ csrfToken: 'fixture-csrf' }) });
      if (url.pathname === '/api/support/tickets' && request.method() === 'POST') {
        ticketAttempt += 1; ticketRequests.push({ body: request.postDataJSON(), csrf: request.headers()['x-csrf-token'] });
        if (ticketAttempt === 1) return route.fulfill({ status: 422, contentType: 'application/json', body: JSON.stringify({ error: 'Fixture policy rejected this ticket: include more detail.' }) });
        return route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify({ ticketId: 'fixture-ticket' }) });
      }
      if (url.pathname === '/api/support/tickets/fixture-ticket/attachments' && request.method() === 'POST') { attachmentRequests.push(request.postData() ?? ''); return route.fulfill({ status: 201, contentType: 'application/json', body: '{}' }); }
      return route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ error: `Unexpected fixture API ${url.pathname}` }) });
    });
    await page.goto(`${origin}/support-doctor-fixture`, { timeout: 20_000 });
    page.setDefaultTimeout(5_000);
    await page.getByRole('heading', { name: 'Create Support Ticket' }).waitFor();
    assert.match(await page.locator('[contenteditable="true"]').first().innerHTML(), /&lt;Requester&gt;/, 'prefilled request content must be escaped before the editor renders it');
    const submit = page.getByRole('button', { name: 'Submit ticket', exact: true }).first();
    assert.equal(await submit.isDisabled(), true, 'required fields must block submission');
    const firstTopic = page.getByRole('button', { name: /Account Issue/ });
    await firstTopic.focus();
    assert.equal(await page.locator(':focus').evaluate((element) => element.tagName), 'BUTTON', 'topic selection is keyboard reachable');
    await page.keyboard.press('Enter');
    await page.getByRole('button', { name: /Request membership in a group/ }).click();
    await page.getByLabel('Group to join').click();
    await page.getByText('Support Group', { exact: true }).last().click();
    await page.getByRole('button', { name: /SDC/ }).click();
    await page.getByLabel('What do you need help with?').click();
    await page.getByRole('option', { name: 'A Student Data Center system' }).click();
    await page.getByLabel('Subject').fill('Fixture support request');
    const editor = page.locator('[contenteditable="true"]').first();
    await editor.fill('The fixture has a detailed reproducible problem.');
    await page.locator('#staged-evidence-input').setInputFiles({ name: 'fixture-evidence.txt', mimeType: 'text/plain', buffer: Buffer.from('fixture evidence') });
    assert.equal(await submit.isDisabled(), false, 'valid routing, subject, and description enable submission');
    const firstResponse = page.waitForResponse((response) => response.url().endsWith('/api/support/tickets') && response.status() === 422);
    await submit.click(); await firstResponse;
    await page.getByText('Fixture policy rejected this ticket: include more detail.').waitFor();
    assert.equal(await submit.isDisabled(), false, 'a detailed 4xx error leaves the form retryable');
    const secondResponse = page.waitForResponse((response) => response.url().endsWith('/api/support/tickets') && response.status() === 201);
    await submit.click(); await secondResponse;
    await page.waitForFunction(() => window.fixtureRedirects?.[0] === '/support/tickets/fixture-ticket');
    assert.equal(ticketRequests.length, 2);
    assert.equal(ticketRequests[0].csrf, 'fixture-csrf');
    assert.equal(ticketRequests[1].body.subject, 'Fixture support request');
    assert.equal(ticketRequests[1].body.category, 'SDC');
    assert.match(ticketRequests[1].body.descriptionHtml, /fixture has a detailed reproducible problem/);
    assert.equal(attachmentRequests.length, 1, 'staged evidence uploads only after ticket creation');
    await noOverflow(page);
    assert.deepEqual(externalRequests, [], 'fixture must abort all external requests');
    assert.deepEqual(browserErrors, [], `browser errors: ${browserErrors.join('\n')}`);
    await page.close();
  }
  for (const width of widths) await verifyTicketDetail(width);
  console.log('PASS: support create and detail fixtures validate required fields, keyboard interactions, local 422 retry/loading, ticket request contracts, escaped prefills, protected evidence, comments, status changes, and 390/1280 layouts.');
} finally { await browser.close(); await server.close(); }
