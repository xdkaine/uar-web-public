import assert from 'node:assert/strict';
import { createServer } from 'vite';
import { chromium } from '@playwright/test';
import ts from 'typescript';

const root = process.cwd();
const mocks = {
  'next/navigation': `export function useRouter(){return {push(path){window.fixtureRedirects ??= []; window.fixtureRedirects.push(path)}}}`,
  'next/link': `import React from 'react'; export default function Link({ href, children, ...props }){return React.createElement('a',{href,...props},children)}`,
  '@/components/appearance/PortalPageHeading': `import React from 'react'; export default function Heading({ action }){return React.createElement('div',null,React.createElement('h1',null,'My Tickets'),action)}`,
};
const server = await createServer({
  configFile: false,
  root,
  logLevel: 'error',
  resolve: {
    dedupe: ['react', 'react-dom'],
    alias: [
      ...Object.keys(mocks).map((key) => ({ find: key, replacement: `\0tickets-list-doctor:${key}` })),
      { find: '@', replacement: root },
    ],
  },
  server: { host: '127.0.0.1', port: 0 },
  plugins: [{
    name: 'tickets-list-doctor',
    enforce: 'pre',
    resolveId(id) {
      if (id.startsWith('\0tickets-list-doctor:')) return id;
      if (Object.hasOwn(mocks, id)) return `\0tickets-list-doctor:${id}`;
    },
    load(id) {
      if (id.startsWith('\0tickets-list-doctor:')) return mocks[id.slice('\0tickets-list-doctor:'.length)];
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
        if (!req.url?.startsWith('/tickets-list-doctor-fixture')) return next();
        res.setHeader('content-type', 'text/html');
        res.end(await vite.transformIndexHtml(req.url, `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script type="module" src="/e2e/components/tickets-list-doctor.fixture.tsx"></script></body></html>`));
      });
    },
  }],
});

function ticket(index) {
  const statuses = ['open', 'in_progress', 'closed'];
  const severities = ['critical', 'high', 'medium', 'low'];
  return {
    id: `fixture-ticket-${String(index).padStart(2, '0')}`,
    subject: `Fixture ticket ${String(index).padStart(2, '0')}`,
    category: index % 2 ? 'account_issue' : 'technical_issue',
    severity: severities[index % severities.length],
    status: statuses[index % statuses.length],
    createdAt: `2026-09-${String((index % 9) + 1).padStart(2, '0')}T00:00:00.000Z`,
    updatedAt: `2026-09-${String((index % 9) + 1).padStart(2, '0')}T01:00:00.000Z`,
    body: '<p>Fixture ticket body.</p>',
    username: 'fixture.requester',
    displayName: 'Fixture Requester',
    attachmentCount: 0,
    isOwn: index % 4 !== 0,
    responses: index % 2 ? [] : [{ id: `response-${index}`, message: 'Fixture staff response.', author: 'fixture.staff', isStaff: true, createdAt: '2026-09-04T02:00:00.000Z' }],
  };
}

function noOverflow(page) {
  return page.evaluate(() => ({ client: document.documentElement.clientWidth, scroll: document.documentElement.scrollWidth }))
    .then(({ client, scroll }) => assert.ok(scroll <= client, `horizontal overflow: ${scroll} > ${client}`));
}

await server.listen();
const origin = `http://127.0.0.1:${server.httpServer.address().port}`;
const browser = await chromium.launch({ headless: true });
const widths = process.env.SUPPORT_DOCTOR_WIDTHS?.split(',').map(Number) ?? [390, 1280];

try {
  for (const width of widths) {
    const page = await browser.newPage({ viewport: { width, height: 1000 } });
    const browserErrors = [];
    const externalRequests = [];
    let listAttempts = 0;
    page.on('pageerror', (error) => browserErrors.push(error.message));
    await page.route('**/*', async (route) => {
      const request = route.request();
      if (!request.url().startsWith(origin)) {
        externalRequests.push(request.url());
        return route.abort();
      }
      const url = new URL(request.url());
      if (url.pathname !== '/api/tickets-list-doctor') return route.continue();
      listAttempts += 1;
      if (listAttempts === 1) {
        return route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'Fixture ticket list failed.' }) });
      }
      return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ tickets: Array.from({ length: 30 }, (_, index) => ticket(index)) }) });
    });

    await page.goto(`${origin}/tickets-list-doctor-fixture`, { timeout: 20_000 });
    page.setDefaultTimeout(5_000);
    await page.getByRole('button', { name: 'Load ticket list', exact: true }).click();
    await page.getByText('Fixture ticket list failed.').waitFor();
    await page.getByRole('button', { name: 'Retry ticket list', exact: true }).click();
    await page.getByText('30 tickets').waitFor();
    assert.equal(listAttempts, 2, 'the fixture load error is retryable through its local API boundary');

    const ticketLink = page.getByRole('link', { name: 'Open ticket Fixture ticket 08' });
    assert.equal(await ticketLink.getAttribute('href'), '/support/tickets/fixture-ticket-08', 'ticket peek keeps the user-ticket detail href');
    await page.getByPlaceholder('Search subject, ID, or category…').fill('ticket 01');
    await page.getByText('Fixture ticket 01').waitFor();
    await page.getByRole('button', { name: 'Clear', exact: true }).click();
    await page.getByRole('combobox').nth(0).click();
    await page.getByRole('option', { name: 'High', exact: true }).click();
    await page.getByText('8 tickets', { exact: true }).waitFor();
    await page.getByRole('button', { name: 'Clear', exact: true }).click();
    await page.getByRole('combobox').nth(1).click();
    await page.getByRole('option', { name: 'account_issue', exact: true }).click();
    await page.getByText('15 tickets', { exact: true }).waitFor();
    await page.getByRole('button', { name: 'Clear', exact: true }).click();
    await page.getByRole('button', { name: /^Closed/ }).click();
    const closedRow = page.getByRole('row', { name: /Fixture ticket 08/ });
    await closedRow.focus();
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => window.fixtureRedirects?.[0] === '/support/tickets/fixture-ticket-08');
    await noOverflow(page);

    await page.goto(`${origin}/tickets-list-doctor-fixture?empty=1`, { timeout: 20_000 });
    await page.getByRole('heading', { name: 'No tickets yet', exact: true }).waitFor();
    await noOverflow(page);
    assert.deepEqual(externalRequests, [], 'ticket list fixture aborts external requests');
    assert.deepEqual(browserErrors, [], `ticket list browser errors: ${browserErrors.join('\n')}`);
    await page.close();
  }
  console.log('PASS: ticket-list fixture validates local failed-load retry, filters, keyboard detail navigation, user-ticket hrefs, empty state, external-request aborts, and 390/1280 layouts.');
} finally {
  await browser.close();
  await server.close();
}
