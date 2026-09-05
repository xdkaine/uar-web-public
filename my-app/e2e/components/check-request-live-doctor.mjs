import assert from 'node:assert/strict';
import { createServer } from 'vite';
import { chromium } from '@playwright/test';
import ts from 'typescript';

const root = process.cwd();
function toLocalExpirationSeconds(value) {
  const date = new Date(value);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  return `${year}-${month}-${day}T${hours}:${minutes}:00`;
}
const mocks = {
  'next/navigation': `export function useRouter(){return window.__requestLiveDoctor.router}`,
  'next/link': `import React from 'react'; export default function Link({href,children,...props}){return React.createElement('a',{href,...props},children)}`,
  'next/image': `import React from 'react'; export default function Image({src,alt,...props}){return React.createElement('img',{src:typeof src==='string'?src:src?.src,alt,...props})}`,
  '@/hooks/useAdminPageTracking': `export function useAdminPageTracking(){}`,
};

const server = await createServer({
  configFile: false,
  root,
  logLevel: 'error',
  resolve: {
    dedupe: ['react', 'react-dom'],
    alias: [
      ...Object.keys(mocks).map((key) => ({ find: key, replacement: `\0request-live-doctor:${key}` })),
      { find: '@', replacement: root },
    ],
  },
  server: { host: '127.0.0.1', port: 0 },
  plugins: [{
    name: 'request-live-doctor',
    enforce: 'pre',
    resolveId(id) {
      if (id.startsWith('\0request-live-doctor:')) return id;
      if (Object.hasOwn(mocks, id)) return `\0request-live-doctor:${id}`;
    },
    load(id) {
      if (id.startsWith('\0request-live-doctor:')) return mocks[id.slice('\0request-live-doctor:'.length)];
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
        if (!req.url?.startsWith('/request-live-doctor-fixture')) return next();
        res.setHeader('content-type', 'text/html');
        res.end(await vite.transformIndexHtml(req.url, '<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script type="module" src="/e2e/components/request-live-doctor.fixture.tsx"></script></body></html>'));
      });
    },
  }],
});

await server.listen();
const origin = `http://127.0.0.1:${server.httpServer.address().port}`;
const browser = await chromium.launch({ headless: true });

async function newFixturePage(width, testCase) {
  const page = await browser.newPage({ viewport: { width, height: 1000 } });
  const externalRequests = [];
  const browserErrors = [];
  const consoleErrors = [];
  page.on('pageerror', (error) => browserErrors.push(error.message));
  page.on('console', (message) => { if (message.type() === 'error') consoleErrors.push(message.text()); });
  await page.addInitScript(() => {
    const makeRequest = (id) => ({
      id,
      version: 7,
      createdAt: '2026-09-04T08:30:00.000Z',
      updatedAt: '2026-09-04T08:35:00.000Z',
      name: 'Taylor Example',
      email: 'taylor@example.test',
      isInternal: false,
      needsDomainAccount: false,
      institution: 'Example Institute',
      eventReason: 'Conference access',
      accessEndTime: '2026-09-10T17:00:00.000Z',
      isVerified: true,
      status: 'pending_faculty',
      acknowledgedByDirector: true,
    });
    const makeReview = (actions) => ({
      workflow: { id: 'workflow-7', version: 7, source: 'pinned', integrity: 'valid', warning: null },
      currentStage: { key: 'faculty', label: 'Faculty Review', order: 2, total: 2, isFinal: true },
      actions,
    });
    document.cookie = 'csrf-token=doctor-csrf; Path=/; SameSite=Lax';
    const json = (body, status = 200) => new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    });
    const calls = [];
    let commentPosts = 0;
    const pushes = [];
    const copies = [];
    const testCase = new URLSearchParams(window.location.search).get('case') || 'ordinary';
    document.execCommand = (command) => {
      if (testCase === 'faculty-clipboard-blocked') throw new Error('Synthetic clipboard block');
      copies.push(command);
      return true;
    };
    window.__requestLiveDoctor = {
      calls,
      pushes,
      copies,
      router: { push: (path) => pushes.push(path), replace: (path) => pushes.push(path), back: () => {} },
    };
    window.fetch = async (input, init = {}) => {
      const rawUrl = typeof input === 'string' ? input : input.url;
      const url = new URL(rawUrl, window.location.href);
      const method = (init.method || 'GET').toUpperCase();
      const headers = Object.fromEntries(new Headers(init.headers || {}).entries());
      calls.push({ path: url.pathname, method, headers, body: typeof init.body === 'string' ? init.body : null });
      const id = new URLSearchParams(window.location.search).get('case') || 'ordinary';
      if (url.pathname === `/api/admin/requests/${id}`) {
        const facultyCase = id.startsWith('faculty');
        const accountCase = id.startsWith('account-');
        const decisionCase = id.startsWith('decision-');
        const manualCase = id.startsWith('manual-');
        const capabilities = id === 'negative'
          ? { canRespond: false, canProvision: false, canReviewDirector: false, canReviewFaculty: false, canRejectPreVerification: false }
          : id === 'confirmation'
            ? { canRespond: false, canProvision: false, canReviewDirector: false, canReviewFaculty: true, canRejectPreVerification: false }
            : facultyCase
              ? { canRespond: false, canProvision: true, canReviewDirector: false, canReviewFaculty: true, canRejectPreVerification: false }
              : accountCase
                ? { canRespond: false, canProvision: true, canReviewDirector: false, canReviewFaculty: false, canRejectPreVerification: false }
              : decisionCase
                ? { canRespond: false, canProvision: false, canReviewDirector: false, canReviewFaculty: id === 'decision-approve', canRejectPreVerification: id === 'decision-reject' }
                : manualCase
                  ? { canRespond: false, canProvision: true, canReviewDirector: false, canReviewFaculty: false, canRejectPreVerification: false }
                : { canRespond: true, canProvision: false, canReviewDirector: false, canReviewFaculty: false, canRejectPreVerification: false };
        const actions = id === 'confirmation'
          ? { canAcknowledge: false, canApprove: true, canReject: true, supportsFacultyHandoff: false }
          : facultyCase
            ? { canAcknowledge: false, canApprove: true, canReject: true, supportsFacultyHandoff: true }
            : accountCase
              ? { canAcknowledge: true, canApprove: false, canReject: true, supportsFacultyHandoff: false }
              : decisionCase
                ? { canAcknowledge: false, canApprove: id === 'decision-approve', canReject: id === 'decision-approve', supportsFacultyHandoff: false }
                : manualCase
                  ? { canAcknowledge: true, canApprove: false, canReject: true, supportsFacultyHandoff: false }
                : { canAcknowledge: false, canApprove: false, canReject: false, supportsFacultyHandoff: false };
        const request = { ...makeRequest(id), hasPassword: facultyCase, ...(id === 'faculty-undo' ? { sentToFacultyAt: '2026-09-04T09:00:00.000Z', sentToFacultyBy: 'faculty@example.test' } : {}), ...(id === 'account-update-unknown' ? { accountCreatedAt: '2026-09-04T09:00:00.000Z', accountUpdateState: 'reconciliation_required', accountUpdateError: 'Synthetic update reconciliation required' } : {}), ...(id === 'decision-reject' ? { status: 'pending_verification' } : {}) };
        return json({ request, actorDisplayNames: {}, capabilities, review: makeReview(actions), workflowRecoveryOptions: [], facultyHandoffTemplate: null, vpnModuleEnabled: false });
      }
      if (url.pathname === '/api/admin/check-username' && method === 'POST') {
        return json({ message: id.startsWith('manual-') ? 'Username exists' : 'Username is available' });
      }
      if (url.pathname === `/api/admin/requests/${id}/manual-assign` && method === 'POST') {
        const body = JSON.parse(init.body);
        if (!body.forceAssignment) {
          return json({
            error: 'Synthetic mismatch',
            message: 'Directory record differs',
            warning: true,
            requiresConfirmation: true,
            suggestion: 'suggested-ad',
            providedUsername: body.linkedAdUsername,
          }, 409);
        }
        return json({ message: 'Synthetic manual assignment complete' });
      }
      if (url.pathname === `/api/admin/requests/${id}/save-credentials` && method === 'POST') {
        if (id === 'account-save-failure') return json({ error: 'Synthetic credential save failure' }, 500);
        return json({ success: true });
      }
      if (url.pathname === `/api/admin/requests/${id}/create-account` && method === 'POST') {
        return json({ success: true, message: 'Synthetic account created' });
      }
      if (url.pathname === `/api/admin/requests/${id}/update-account` && method === 'POST') {
        return json({ success: false, error: 'Synthetic update reconciliation required' }, 202);
      }
      if (url.pathname === `/api/admin/requests/${id}/reconcile-account-update` && method === 'POST') {
        return json({ success: true });
      }
      if (url.pathname === `/api/admin/requests/${id}/approve` && method === 'POST') {
        return json({ success: true });
      }
      if (url.pathname === `/api/admin/requests/${id}/reject` && method === 'POST') {
        return json({ success: true });
      }
      if (url.pathname === `/api/admin/requests/${id}/reveal-password` && method === 'POST') {
        return json({ password: 'audited-fixture-password' });
      }
      if (url.pathname === `/api/admin/requests/${id}/notify-faculty` && method === 'POST') {
        if (id === 'faculty-unknown') return json({ success: false, error: 'Synthetic faculty delivery unknown' }, 202);
        return json({ success: true, message: 'Synthetic faculty delivery complete' });
      }
      if (url.pathname === `/api/admin/requests/${id}/undo-notify-faculty` && method === 'POST') {
        return json({ success: true });
      }
      if (url.pathname === `/api/admin/requests/${id}/comments` && method === 'GET') {
        return json({ comments: [{ id: 'comment-1', createdAt: '2026-09-04T08:40:00.000Z', updatedAt: '2026-09-04T08:40:00.000Z', author: 'reviewer@example.test', authorDisplayName: 'Reviewer Example', comment: '<p>Existing review note</p>' }] });
      }
      if (url.pathname === `/api/admin/requests/${id}/comments` && method === 'POST') {
        commentPosts += 1;
        if (commentPosts === 1) return json({ error: 'Synthetic comment failure' }, 500);
        return json({ success: true, comment: { id: 'comment-2', createdAt: '2026-09-04T09:00:00.000Z', updatedAt: '2026-09-04T09:00:00.000Z', author: 'reviewer@example.test', authorDisplayName: 'Reviewer Example', comment: JSON.parse(init.body).comment } });
      }
      return json({ error: `Unexpected synthetic request: ${method} ${url.pathname}` }, 404);
    };
  });
  await page.route('**/*', async (route) => {
    if (!route.request().url().startsWith(origin)) {
      externalRequests.push(route.request().url());
      return route.abort();
    }
    return route.continue();
  });
  await page.goto(`${origin}/request-live-doctor-fixture?case=${testCase}`);
  page.setDefaultTimeout(10_000);
  return { page, externalRequests, browserErrors, consoleErrors };
}

async function waitForPage(page, browserErrors, consoleErrors = []) {
  try {
    await page.getByRole('heading', { name: 'Access Request Details' }).waitFor();
  } catch (error) {
    throw new Error(`${error.message}\nRendered body:\n${await page.locator('body').innerText()}\nBrowser errors:\n${browserErrors.join('\n')}\nConsole errors:\n${consoleErrors.join('\n')}`);
  }
}

try {
  for (const width of [390, 1280]) {
    const { page, externalRequests, browserErrors, consoleErrors } = await newFixturePage(width, 'ordinary');
    await waitForPage(page, browserErrors, consoleErrors);
    for (const value of ['Taylor Example', 'taylor@example.test', 'Example Institute', 'Conference access', 'Faculty Review', 'Existing review note']) {
      await page.getByText(value, { exact: true }).waitFor();
    }
    assert.equal(await page.locator('body').evaluate((body) => body.scrollWidth > window.innerWidth), false, `${width}px fixture has horizontal overflow`);
    assert.deepEqual(await page.evaluate(() => window.__requestLiveDoctor.calls.map(({ path, method }) => ({ path, method }))), [
      { path: '/api/admin/requests/ordinary', method: 'GET' },
      { path: '/api/admin/requests/ordinary/comments', method: 'GET' },
    ], `${width}px ordinary fixture has only its request and comments reads`);
    assert.deepEqual(externalRequests, [], `${width}px fixture aborts all non-local requests`);
    assert.deepEqual(browserErrors, [], `${width}px fixture has no browser errors`);
    await page.close();
  }

  {
    const { page, externalRequests, browserErrors } = await newFixturePage(1280, 'negative');
    await waitForPage(page, browserErrors);
    assert.equal(await page.getByText('Comments & Notes').count(), 0, 'negative capabilities hide comments');
    assert.equal(await page.getByRole('button', { name: /approve|reject|create|manual assignment|update directory|mark as sent/i }).count(), 0, 'negative capabilities expose no dangerous actions');
    assert.deepEqual(await page.evaluate(() => window.__requestLiveDoctor.calls.map(({ path, method }) => ({ path, method }))), [
      { path: '/api/admin/requests/negative', method: 'GET' },
    ], 'negative capabilities do not fetch comments or mutation endpoints');
    assert.deepEqual(externalRequests, [], 'negative fixture aborts all non-local requests');
    assert.deepEqual(browserErrors, [], 'negative fixture has no browser errors');
    await page.close();
  }

  {
    const { page, externalRequests, browserErrors } = await newFixturePage(1280, 'ordinary');
    await page.getByRole('button', { name: 'Add Comment' }).waitFor();
    const editor = page.getByRole('textbox', { name: 'Add notes, observations, or important information about this request' });
    await editor.fill('Ordinary operator note');
    await page.getByRole('button', { name: 'Add Comment' }).click();
    await page.getByText('Synthetic comment failure', { exact: true }).waitFor();
    await page.getByRole('button', { name: 'Add Comment' }).click();
    await page.getByText('Ordinary operator note', { exact: true }).waitFor();
    const commentCalls = await page.evaluate(() => window.__requestLiveDoctor.calls.filter((call) => call.path === '/api/admin/requests/ordinary/comments' && call.method === 'POST'));
    assert.equal(commentCalls.length, 2, 'failure leaves an ordinary comment retryable');
    for (const call of commentCalls) {
      assert.equal(call.headers['x-csrf-token'], 'doctor-csrf', 'comment mutation preserves the production CSRF header');
      assert.equal(call.body, JSON.stringify({ comment: '<p>Ordinary operator note</p>' }), 'comment mutation preserves the target-bound API payload');
    }
    assert.deepEqual(externalRequests, [], 'comment fixture aborts all non-local requests');
    assert.deepEqual(browserErrors, [], 'comment fixture has no browser errors');
    await page.close();
  }

  {
    const { page, externalRequests, browserErrors } = await newFixturePage(1280, 'confirmation');
    await page.getByRole('button', { name: 'Approve Request' }).click();
    await page.getByRole('dialog').getByRole('heading', { name: 'Approve Request' }).waitFor();
    assert.equal(await page.evaluate(() => window.__requestLiveDoctor.calls.some((call) => call.path.endsWith('/approve') && call.method === 'POST')), false, 'privileged approval never executes before explicit dialog confirmation');
    assert.deepEqual(externalRequests, [], 'confirmation fixture aborts all non-local requests');
    assert.deepEqual(browserErrors, [], 'confirmation fixture has no browser errors');
    await page.close();
  }

  {
    const { page, externalRequests, browserErrors } = await newFixturePage(1280, 'faculty');
    await page.clock.install({ time: new Date('2026-09-04T08:30:00.000Z') });
    await waitForPage(page, browserErrors);
    const copy = page.getByRole('button', { name: 'Copy message' });
    assert.equal(await copy.isDisabled(), true, 'external faculty message stays blocked before the audited reveal');
    await page.getByRole('button', { name: 'Reveal (audited)' }).click();
    await page.getByText('Password revealed for 60 seconds. This action was audited.', { exact: true }).waitFor();
    await page.getByRole('button', { name: 'Show', exact: true }).click();
    await page.getByText('audited-fixture-password', { exact: true }).waitFor();
    assert.equal(await page.evaluate(() => window.__requestLiveDoctor.calls.filter((call) => call.path.endsWith('/reveal-password')).at(-1).headers['x-csrf-token']), 'doctor-csrf', 'audited reveal retains the CSRF header');
    await page.clock.fastForward(60_000);
    await page.getByText('[Reveal the password before copying this message]', { exact: false }).waitFor();
    assert.deepEqual(await page.evaluate(() => window.__requestLiveDoctor.copies), [], 'reveal does not copy credentials implicitly');
    assert.deepEqual(externalRequests, [], 'faculty reveal fixture aborts all non-local requests');
    assert.deepEqual(browserErrors, [], 'faculty reveal fixture has no browser errors');
    await page.close();
  }

  {
    const { page, externalRequests, browserErrors } = await newFixturePage(1280, 'faculty-clipboard-blocked');
    await waitForPage(page, browserErrors);
    await page.getByRole('button', { name: 'Reveal (audited)' }).click();
    await page.getByRole('button', { name: 'Copy message' }).click();
    await page.getByText('Failed to copy message. Please copy manually.', { exact: true }).waitFor();
    assert.equal(await page.locator('textarea').count(), 0, 'blocked clipboard cleanup removes its temporary textarea');
    assert.deepEqual(externalRequests, [], 'clipboard fixture aborts all non-local requests');
    assert.deepEqual(browserErrors, [], 'clipboard fixture has no browser errors');
    await page.close();
  }

  {
    const { page, externalRequests, browserErrors } = await newFixturePage(1280, 'faculty-unknown');
    await waitForPage(page, browserErrors);
    await page.getByRole('button', { name: 'Mark as Sent to Faculty' }).click();
    await page.getByText('Synthetic faculty delivery unknown', { exact: true }).first().waitFor();
    const notify = await page.evaluate(() => window.__requestLiveDoctor.calls.filter((call) => call.path.endsWith('/notify-faculty')).at(-1));
    assert.equal(notify.headers['x-csrf-token'], 'doctor-csrf', 'delivery-unknown notify retains the CSRF header');
    assert.deepEqual(externalRequests, [], 'delivery-unknown fixture aborts all non-local requests');
    assert.deepEqual(browserErrors, [], 'delivery-unknown fixture has no browser errors');
    await page.close();
  }

  {
    const { page, externalRequests, browserErrors } = await newFixturePage(1280, 'faculty-undo');
    await waitForPage(page, browserErrors);
    await page.getByRole('button', { name: 'Undo "Sent to Faculty" Status' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Confirm' }).click();
    await page.getByText('Successfully undid "Sent to Faculty" status.', { exact: true }).waitFor();
    const undo = await page.evaluate(() => window.__requestLiveDoctor.calls.filter((call) => call.path.endsWith('/undo-notify-faculty')).at(-1));
    assert.equal(undo.headers['x-csrf-token'], 'doctor-csrf', 'undo notify retains the CSRF header');
    assert.deepEqual(externalRequests, [], 'undo fixture aborts all non-local requests');
    assert.deepEqual(browserErrors, [], 'undo fixture has no browser errors');
    await page.close();
  }

  {
    const { page, externalRequests, browserErrors } = await newFixturePage(1280, 'account-save-failure');
    await waitForPage(page, browserErrors);
    await page.getByRole('button', { name: 'Check' }).click();
    await page.getByLabel('Password *').fill('operator-password');
    await page.getByRole('button', { name: 'Create AD Account' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Confirm' }).click();
    await page.getByText('Synthetic credential save failure', { exact: true }).first().waitFor();
    const calls = await page.evaluate(() => window.__requestLiveDoctor.calls.filter((call) => call.path.includes('account-save-failure')));
    assert.deepEqual(calls.map(({ path, method }) => ({ path, method })), [
      { path: '/api/admin/requests/account-save-failure', method: 'GET' },
      { path: '/api/admin/requests/account-save-failure/save-credentials', method: 'POST' },
    ], 'save failure stops before account creation');
    assert.equal(calls[1].headers['x-csrf-token'], 'doctor-csrf', 'credential save retains the CSRF header');
    assert.deepEqual(JSON.parse(calls[1].body), {
      ldapUsername: 'taylorexample', password: 'operator-password', expirationDate: toLocalExpirationSeconds('2026-09-10T17:00:00.000Z'),
    }, 'disabled VPN module omits its create credential field');
    assert.deepEqual(externalRequests, [], 'create save-failure fixture aborts all non-local requests');
    assert.deepEqual(browserErrors, [], 'create save-failure fixture has no browser errors');
    await page.close();
  }

  {
    const { page, externalRequests, browserErrors } = await newFixturePage(1280, 'account-update-unknown');
    await waitForPage(page, browserErrors);
    await page.getByLabel('Password *').fill('operator-password');
    await page.getByRole('button', { name: 'Update directory account' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Confirm' }).click();
    await page.getByText('Synthetic update reconciliation required', { exact: true }).first().waitFor();
    const update = await page.evaluate(() => window.__requestLiveDoctor.calls.filter((call) => call.path.endsWith('/update-account')).at(-1));
    assert.equal(update.headers['x-csrf-token'], 'doctor-csrf', 'update retains the CSRF header');
    assert.deepEqual(JSON.parse(update.body), {
      newLdapUsername: 'taylorexample', newVpnUsername: null, newPassword: 'operator-password', newExpirationDate: toLocalExpirationSeconds('2026-09-10T17:00:00.000Z'),
    }, 'disabled VPN update sends a null VPN field and preserves local expiration seconds');
    page.once('dialog', (dialog) => dialog.accept('directory evidence confirms the update was not applied'));
    await page.getByRole('button', { name: 'Verify no changes and re-arm' }).click();
    await page.getByText('Recovery evidence recorded.', { exact: true }).waitFor();
    assert.equal(await page.getByText('Synthetic update reconciliation required', { exact: true }).count(), 1, 'recovery busy state retains the preceding update error alongside recovery evidence');
    const reconciliation = await page.evaluate(() => window.__requestLiveDoctor.calls.filter((call) => call.path.endsWith('/reconcile-account-update')).at(-1));
    assert.equal(reconciliation.headers['x-csrf-token'], 'doctor-csrf', 'reconciliation retains the CSRF header');
    assert.deepEqual(JSON.parse(reconciliation.body), { resolution: 'not_applied', evidence: 'directory evidence confirms the update was not applied' }, 'reconciliation preserves the prompted evidence body');
    assert.deepEqual(externalRequests, [], 'update reconciliation fixture aborts all non-local requests');
    assert.deepEqual(browserErrors, [], 'update reconciliation fixture has no browser errors');
    await page.close();
  }

  {
    const { page, externalRequests, browserErrors } = await newFixturePage(1280, 'decision-approve');
    await waitForPage(page, browserErrors);
    await page.getByRole('button', { name: 'Approve Request' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Approve Request' }).click();
    await page.getByText('Request approved successfully! User will receive an email notification.', { exact: true }).waitFor();
    const approve = await page.evaluate(() => window.__requestLiveDoctor.calls.filter((call) => call.path.endsWith('/approve')).at(-1));
    assert.equal(approve.headers['x-csrf-token'], 'doctor-csrf', 'approval retains the CSRF header');
    assert.deepEqual(JSON.parse(approve.body), { message: 'Request approved.' }, 'blank approval uses the default approval comment');
    assert.deepEqual(externalRequests, [], 'approval fixture aborts all non-local requests');
    assert.deepEqual(browserErrors, [], 'approval fixture has no browser errors');
    await page.close();
  }

  {
    const { page, externalRequests, browserErrors } = await newFixturePage(1280, 'decision-reject');
    await waitForPage(page, browserErrors);
    await page.getByRole('button', { name: 'Reject Request' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('Rejection Reason').fill('  synthetic raw rejection  ');
    await dialog.getByRole('button', { name: 'Reject Request' }).click();
    await page.getByText('Request rejected successfully. Notification email sent.', { exact: true }).waitFor();
    const reject = await page.evaluate(() => window.__requestLiveDoctor.calls.filter((call) => call.path.endsWith('/reject')).at(-1));
    assert.equal(reject.headers['x-csrf-token'], 'doctor-csrf', 'rejection retains the CSRF header');
    assert.deepEqual(JSON.parse(reject.body), { reason: '  synthetic raw rejection  ' }, 'rejection validates trim but preserves the raw reason body');
    assert.deepEqual(externalRequests, [], 'rejection fixture aborts all non-local requests');
    assert.deepEqual(browserErrors, [], 'rejection fixture has no browser errors');
    await page.close();
  }

  {
    const { page, externalRequests, browserErrors } = await newFixturePage(1280, 'manual-cancel');
    await waitForPage(page, browserErrors);
    await page.getByRole('button', { name: 'Manual Assignment', exact: true }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('Existing Active Directory Username *').fill('  original-ad  ');
    await dialog.getByLabel('Existing Active Directory Username *').locator('..').getByRole('button', { name: 'Verify' }).click();
    await dialog.getByLabel('Existing VPN Username (Optional)').fill('  original-vpn  ');
    await dialog.getByLabel('Existing VPN Username (Optional)').locator('..').getByRole('button', { name: 'Verify' }).click();
    await dialog.getByLabel('Assignment Notes (Optional)').fill('  original notes  ');
    await dialog.getByRole('button', { name: 'Link to Existing Account' }).click();
    await page.getByRole('dialog').getByText('Username Mismatch Detected', { exact: false }).waitFor();
    await page.getByRole('dialog').getByRole('button', { name: 'Cancel' }).click();
    const reopened = page.getByRole('dialog');
    assert.equal(await reopened.getByLabel('Existing Active Directory Username *').inputValue(), '  original-ad  ', 'mismatch cancel retains the original AD draft');
    assert.equal(await reopened.getByLabel('Existing VPN Username (Optional)').inputValue(), '  original-vpn  ', 'mismatch cancel retains the original VPN draft');
    assert.equal(await reopened.getByLabel('Assignment Notes (Optional)').inputValue(), '  original notes  ', 'mismatch cancel retains the original notes');
    const calls = await page.evaluate(() => window.__requestLiveDoctor.calls.filter((call) => call.path.endsWith('/manual-assign')));
    assert.equal(calls.length, 1, 'mismatch cancellation does not force an assignment');
    assert.equal(calls[0].headers['x-csrf-token'], 'doctor-csrf', 'manual assignment preserves CSRF protection');
    assert.deepEqual(externalRequests, [], 'manual mismatch cancellation fixture aborts all non-local requests');
    assert.deepEqual(browserErrors, [], 'manual mismatch cancellation fixture has no browser errors');
    await page.close();
  }

  {
    const { page, externalRequests, browserErrors } = await newFixturePage(1280, 'manual-force');
    await waitForPage(page, browserErrors);
    await page.getByRole('button', { name: 'Manual Assignment', exact: true }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('Existing Active Directory Username *').fill('  original-ad  ');
    await dialog.getByLabel('Existing Active Directory Username *').locator('..').getByRole('button', { name: 'Verify' }).click();
    await dialog.getByLabel('Existing VPN Username (Optional)').fill('  original-vpn  ');
    await dialog.getByLabel('Existing VPN Username (Optional)').locator('..').getByRole('button', { name: 'Verify' }).click();
    await dialog.getByLabel('Assignment Notes (Optional)').fill('  original notes  ');
    await dialog.getByRole('button', { name: 'Link to Existing Account' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Force Assignment' }).click();
    await page.getByText('Synthetic manual assignment complete', { exact: true }).waitFor();
    const calls = await page.evaluate(() => window.__requestLiveDoctor.calls.filter((call) => call.path.endsWith('/manual-assign')));
    assert.equal(calls.length, 2, 'forced assignment retries exactly once after an explicit confirmation');
    assert.deepEqual(JSON.parse(calls[0].body), { linkedAdUsername: 'original-ad', notes: 'original notes', linkedVpnUsername: 'original-vpn' }, 'manual attempt trims and preserves its original body');
    assert.deepEqual(JSON.parse(calls[1].body), { linkedAdUsername: 'original-ad', notes: 'original notes', linkedVpnUsername: 'original-vpn', forceAssignment: true }, 'forced assignment uses the captured original body');
    assert.equal(calls[1].headers['x-csrf-token'], 'doctor-csrf', 'forced assignment preserves CSRF protection');
    assert.deepEqual(externalRequests, [], 'forced manual assignment fixture aborts all non-local requests');
    assert.deepEqual(browserErrors, [], 'forced manual assignment fixture has no browser errors');
    await page.close();
  }

  console.log('PASS: real request-detail page renders ordinary detail/comments, preserves capability gates and comment CSRF retries, verifies faculty/account/manual-assignment controls, and validates approval/rejection CSRF payload contracts.');
} finally {
  await browser.close();
  await server.close();
}
