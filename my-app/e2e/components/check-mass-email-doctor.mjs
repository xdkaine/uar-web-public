import assert from 'node:assert/strict';

import { chromium } from '@playwright/test';
import { createServer } from 'vite';
import ts from 'typescript';

const root = process.cwd();
const mocks = {};
const server = await createServer({
  configFile: false,
  root,
  cacheDir: 'node_modules/.vite-react-doctor-mass-email',
  logLevel: 'error',
  resolve: {
    dedupe: ['react', 'react-dom'],
    alias: [
      ...Object.keys(mocks).map((key) => ({
        find: key,
        replacement: `\0mass-email:${key}`,
      })),
      { find: '@', replacement: root },
    ],
  },
  server: { host: '127.0.0.1', port: 0 },
  plugins: [
    {
      name: 'mass-email',
      enforce: 'pre',
      resolveId(id) {
        if (id.startsWith('\0mass-email:')) return id;
        if (Object.hasOwn(mocks, id)) return `\0mass-email:${id}`;
      },
      load(id) {
        if (id.startsWith('\0mass-email:'))
          return mocks[id.slice('\0mass-email:'.length)];
      },
      transform(code, id) {
        if (id.endsWith('.tsx') && !id.includes('node_modules'))
          return ts.transpileModule(code, {
            compilerOptions: {
              jsx: ts.JsxEmit.ReactJSX,
              module: ts.ModuleKind.ESNext,
              target: ts.ScriptTarget.ES2022,
            },
          }).outputText;
      },
      configureServer(vite) {
        vite.middlewares.use(async (request, response, next) => {
          if (!request.url?.startsWith('/mass-email-doctor-fixture'))
            return next();
          response.setHeader('content-type', 'text/html');
          response.end(
            await vite.transformIndexHtml(
              request.url,
              '<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script type="module" src="/e2e/components/mass-email-doctor.fixture.tsx"></script></body></html>',
            ),
          );
        });
      },
    },
  ],
});
await server.listen();
const origin = `http://127.0.0.1:${server.httpServer.address().port}`;
const browser = await chromium.launch({ headless: true });
let campaignPolls = 0;
let selectedCampaignPolls = 0;
try {
  for (const width of [390, 1280]) {
    campaignPolls = 0;
    selectedCampaignPolls = 0;
    const page = await browser.newPage({ viewport: { width, height: 900 } });
    page.on('pageerror', (error) =>
      console.error('Browser error:', error.message),
    );
    page.on('requestfailed', (request) =>
      console.error(
        'Request failed:',
        request.url(),
        request.failure()?.errorText,
      ),
    );
    const external = [];
    const mutations = [];
    let previewAttempts = 0;
    await page
      .context()
      .addCookies([
        { name: 'csrf-token', value: 'synthetic-mass-email-csrf', url: origin },
      ]);
    await page.route('**/*', async (route) => {
      const request = route.request();
      if (!request.url().startsWith(origin)) {
        external.push(request.url());
        return route.abort();
      }
      const requestUrl = new URL(request.url());
      const path = requestUrl.pathname;
      if (!path.startsWith('/api/')) return route.continue();
      if (request.method() === 'POST' || request.method() === 'PUT') {
        mutations.push({
          path,
          method: request.method(),
          body: request.postDataJSON(),
          csrf: request.headers()['x-csrf-token'],
        });
        if (
          path === '/api/admin/mass-email' ||
          path === '/api/admin/mass-email/synthetic-draft'
        )
          return route.fulfill({
            json: {
              campaign: {
                id: 'synthetic-draft',
                subject: request.postDataJSON().subject,
                html: request.postDataJSON().html,
                status: 'draft',
                quickSend: false,
                createdAt: '',
                createdBy: '',
                eligibleRecipients: 1,
                skippedRecipients: 0,
                sentCount: 0,
                failedCount: 0,
                targetSnapshot: { targets: request.postDataJSON().targets },
              },
            },
          });
        if (path.endsWith('/preview')) {
          if (++previewAttempts === 1)
            return route.fulfill({
              status: 500,
              json: { error: 'Synthetic preview failure' },
            });
          return route.fulfill({
            json: { preview: { html: '<p>Preview succeeded</p>' } },
          });
        }
        if (path.endsWith('/resolve'))
          return route.fulfill({
            json: {
              previewDigest: 'synthetic-digest',
              resolution: {
                candidates: [],
                recipients: [{ email: 'beta@example.test', adUsername: 'beta', sources: [{ type: 'manual', label: 'Manual recipients' }] }],
                skipped: [],
                summary: {
                  totalCandidates: 1,
                  eligibleRecipients: 1,
                  skippedRecipients: 0,
                  duplicateSourcesMerged: 0,
                },
              },
            },
          });
        throw new Error(`Unexpected synthetic mutation: ${path}`);
      }
      if (path === '/api/admin/mass-email') {
        campaignPolls += 1;
        const selectedId = requestUrl.searchParams.get('id');
        if (selectedId === 'b') selectedCampaignPolls += 1;
        const pending = campaignPolls === 1 || selectedId !== 'b';
        const campaignA = {
          id: 'a',
          subject: 'Campaign A',
          status: 'draft',
          quickSend: false,
          createdAt: '',
          createdBy: '',
          eligibleRecipients: 1,
          skippedRecipients: 0,
          sentCount: 0,
          failedCount: 0,
        };
        const campaignB = {
          id: 'b',
          subject: 'Campaign B',
          status: pending ? 'pending_send' : 'delivery_unknown',
          quickSend: false,
          createdAt: '',
          createdBy: '',
          eligibleRecipients: 1,
          skippedRecipients: 0,
          sentCount: pending ? 0 : 1,
          failedCount: 0,
          recipients: [
            {
              id: 'recipient-b',
              email: 'b@example.edu',
              displayName: 'Bob B',
              status: pending ? 'pending_send' : 'delivery_unknown',
            },
          ],
        };
        return route.fulfill({
          contentType: 'application/json',
          body: JSON.stringify({
            campaigns: [campaignA, campaignB],
            selectedCampaign: selectedId === 'b' ? campaignB : campaignA,
          }),
        });
      }
      const id = path.split('/').at(-1);
      if (id === 'a') await new Promise((resolve) => setTimeout(resolve, 120));
      const recipient = id === 'a' ? 'Alice A' : 'Bob B';
      return route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({
          campaign: {
            id,
            subject: `Campaign ${id.toUpperCase()}`,
            status: 'draft',
            quickSend: false,
            createdAt: '',
            createdBy: '',
            eligibleRecipients: 1,
            skippedRecipients: 0,
            sentCount: 0,
            failedCount: 0,
            recipients: [
              {
                id: `recipient-${id}`,
                email: `${id}@example.edu`,
                displayName: recipient,
                status: 'sent',
              },
            ],
          },
        }),
      });
    });
    await page.goto(`${origin}/mass-email-doctor-fixture`);
    await page.getByRole('button', { name: 'Campaign B' }).waitFor();
    await page.getByRole('button', { name: 'Campaign B' }).click();
    await page.getByText('Bob B').waitFor();
    await page.waitForTimeout(180);
    assert.equal(
      await page.getByText('Alice A').count(),
      0,
      'late Campaign A detail must not replace Campaign B audience',
    );
    await page.getByRole('button', { name: 'Refresh', exact: true }).click();
    await page.waitForFunction(() =>
      [...document.querySelectorAll('button')].some(
        (button) =>
          button.textContent.includes('Campaign B') &&
          button.textContent.includes('delivery_unknown'),
      ),
    );
    assert.match(
      await page.getByRole('button', { name: 'Campaign B' }).innerText(),
      /delivery_unknown/,
      'poll summary must refresh cached selected campaign status',
    );
    assert.match(
      await page.getByRole('row').filter({ hasText: 'Bob B' }).innerText(),
      /delivery unknown/,
      'selected recipient details must refresh too',
    );
    assert.ok(
      selectedCampaignPolls > 0,
      'selected campaign polling must use the route id query',
    );
    await page.getByRole('tab', { name: 'Compose', exact: true }).click();
    await page.getByLabel('Subject', { exact: true }).fill('Synthetic message');
    await page.getByRole('button', { name: 'HTML', exact: true }).click();
    const html =
      '<p data-fixture="round-trip">Synthetic <strong>message</strong></p>';
    await page.getByLabel('Message', { exact: true }).fill(html);
    await page.getByRole('button', { name: 'Editor', exact: true }).click();
    await page.getByRole('button', { name: 'HTML', exact: true }).click();
    assert.equal(
      await page.getByLabel('Message', { exact: true }).inputValue(),
      html,
      'switching editor mode must preserve HTML',
    );
    const manualRecipients = page.getByRole('textbox', { name: 'Manual recipients', exact: true });
    await manualRecipients.fill('alpha beta');
    await manualRecipients.press('Enter');
    const retainedRecipient = page.getByRole('button', { name: 'Remove beta', exact: true });
    await retainedRecipient.evaluate(element => { element.dataset.recipientIdentity = 'beta'; });
    await page.getByRole('button', { name: 'Remove alpha', exact: true }).click();
    assert.equal(await retainedRecipient.getAttribute('data-recipient-identity'), 'beta', 'removing a different recipient must not remount this recipient');
    await manualRecipients.fill('BETA');
    await manualRecipients.press('Enter');
    assert.equal(await page.getByRole('button', { name: /^Remove beta$/i }).count(), 1, 'manual recipient input remains case-insensitively unique');
    await page.getByRole('button', { name: 'Preview', exact: true }).click();
    await page
      .getByText('Synthetic preview failure', { exact: true })
      .waitFor({ timeout: 5000 });
    await page.getByRole('button', { name: 'Preview', exact: true }).click();
    await page.getByText('Preview refreshed', { exact: true }).waitFor();
    assert.deepEqual(
      mutations.filter((item) => item.path.endsWith('/preview')),
      Array.from({ length: 2 }, () => ({
        path: '/api/admin/mass-email/preview',
        method: 'POST',
        body: { subject: 'Synthetic message', html },
        csrf: 'synthetic-mass-email-csrf',
      })),
    );
    await page.getByRole('button', { name: 'Dry Run', exact: true }).click();
    await page.getByText('Resolved 1 recipients', { exact: true }).waitFor();
    await page.getByRole('button', { name: 'Quick Send', exact: true }).click();
    const confirmation = page.getByRole('alertdialog', {
      name: 'Start quick-send',
    });
    await confirmation.waitFor();
    assert.equal(
      mutations.some((item) => item.path.endsWith('/quick-send')),
      false,
      'no send before confirmation',
    );
    await confirmation
      .getByRole('button', { name: 'Cancel', exact: true })
      .click();
    assert.equal(
      mutations.some((item) => item.path.endsWith('/quick-send')),
      false,
      'cancel must never send',
    );
    await page.getByRole('button', { name: 'Save Draft', exact: true }).click();
    await page.getByText('Mass email draft created', { exact: true }).waitFor();
    await page.getByRole('button', { name: 'Edit Draft', exact: true }).click();
    assert.equal(
      await page.getByLabel('Subject', { exact: true }).inputValue(),
      'Synthetic message',
    );
    assert.equal(
      await page
        .getByRole('button', { name: 'Quick Send', exact: true })
        .isDisabled(),
      true,
      'loading a saved draft must invalidate the previous send preview',
    );
    await page
      .getByLabel('Subject', { exact: true })
      .fill('Edited synthetic message');
    await page
      .getByRole('button', { name: 'Save Changes', exact: true })
      .click();
    await page.getByText('Mass email draft updated', { exact: true }).waitFor();
    const targets = {
      selectedUsernames: ['beta'],
      selectedGroups: [],
      includeAllDomainUsers: false,
    };
    assert.deepEqual(
      mutations.filter(
        (item) =>
          item.path === '/api/admin/mass-email' ||
          item.path === '/api/admin/mass-email/synthetic-draft',
      ),
      [
        {
          path: '/api/admin/mass-email',
          method: 'POST',
          body: { subject: 'Synthetic message', html, targets },
          csrf: 'synthetic-mass-email-csrf',
        },
        {
          path: '/api/admin/mass-email/synthetic-draft',
          method: 'PUT',
          body: { subject: 'Edited synthetic message', html, targets },
          csrf: 'synthetic-mass-email-csrf',
        },
      ],
    );
    assert.deepEqual(external, []);
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
      true,
      'campaign workspace must not overflow the page',
    );
    await page.close();
  }
  console.log(
    'PASS: real mass-email polling, recipient ownership, HTML round-trip, visible preview retry, CSRF, confirmation cancellation and draft POST/PUT at 390/1280; no external requests.',
  );
} finally {
  await browser.close();
  await server.close();
}
