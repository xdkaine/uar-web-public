// Real configuration panels with compiled application CSS and local intercepted APIs only.
// Run from my-app: node e2e/components/check-config-doctor.mjs
import assert from 'node:assert/strict';
import { createServer } from 'vite';
import { chromium } from '@playwright/test';
import ts from 'typescript';

const root = process.cwd();
const server = await createServer({
  configFile: false,
  root,
  cacheDir: 'node_modules/.vite-react-doctor-config',
  resolve: { alias: [{ find: '@', replacement: root }] },
  server: { host: '127.0.0.1', port: 0 },
  plugins: [{
    name: 'config-doctor-fixture',
    enforce: 'pre',
    transform(code, id) {
      if (!id.endsWith('.tsx') || id.includes('node_modules')) return undefined;
      return ts.transpileModule(code, {
        compilerOptions: {
          jsx: ts.JsxEmit.ReactJSX,
          module: ts.ModuleKind.ESNext,
          target: ts.ScriptTarget.ES2022,
        },
      }).outputText;
    },
    configureServer(vite) {
      vite.middlewares.use(async (req, res, next) => {
        if (!req.url?.startsWith('/config-doctor-fixture')) return next();
        res.setHeader('content-type', 'text/html');
        res.end(await vite.transformIndexHtml(req.url, '<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>Configuration doctor fixture</title></head><body><div id="root"></div><script type="module" src="/e2e/components/config-doctor.fixture.tsx"></script></body></html>'));
      });
    },
  }],
});

await server.listen();
const origin = `http://127.0.0.1:${server.httpServer.address().port}`;
const browser = await chromium.launch({ headless: true });

const directoryConfig = [
  ['ldap.url', 'ldaps://directory.example.test:636'], ['ldap.failoverUrls', 'ldaps://directory-backup.example.test:636'],
  ['ldap.searchBase', 'OU=People,DC=example,DC=test'], ['ldap.groupSearchBase', 'OU=Groups,DC=example,DC=test'],
  ['ldap.bindDn', 'CN=portal,OU=Service,DC=example,DC=test'], ['ldap.bindPassword', undefined, true],
  ['ldap.domain', 'example.test'], ['ldap.adminGroups', ['CN=UAR-Admins,OU=Groups,DC=example,DC=test']],
  ['ldap.kaminoInternalGroup', 'CN=Internal,OU=Groups,DC=example,DC=test'], ['ldap.kaminoExternalGroup', 'CN=External,OU=Groups,DC=example,DC=test'], ['ldap.group2Add', 'CN=All,OU=Groups,DC=example,DC=test'],
  ['smtp.host', 'relay.example.test'], ['smtp.port', '587'], ['smtp.user', 'portal'], ['smtp.password', undefined, true],
  ['email.from', 'portal@example.test'], ['email.admin', 'admins@example.test'], ['email.faculty', 'faculty@example.test'], ['email.studentDirectors', 'directors@example.test'],
].map(([key, value, secret]) => ({ key, value, secret: Boolean(secret), configured: Boolean(secret), source: 'database', description: `${key} fixture` }));

function localJson(route, status, body) {
  return route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
}

try {
  for (const width of [1280, 390]) {
    const context = await browser.newContext({ viewport: { width, height: 1000 } });
    const page = await context.newPage();
    page.setDefaultTimeout(10000);
    const requests = [];
    const externalRequests = [];
    const browserErrors = [];
    const directorySaves = [];
    let relayAttempts = 0;
    let connectionAttempts = 0;
    let bindAttempts = 0;
    let moduleEnabled = true;
    let privilegeGroups = ['CN=UAR-Readers,OU=Groups,DC=example,DC=edu'];

    page.on('pageerror', (error) => browserErrors.push(error.message));
    await page.route('**/*', async (route) => {
      const request = route.request();
      if (!request.url().startsWith(origin)) {
        externalRequests.push(request.url());
        return route.abort();
      }
      const url = new URL(request.url());
      if (!url.pathname.startsWith('/api/')) return route.continue();
      if (url.pathname === '/api/csrf-token') return localJson(route, 200, { csrfToken: 'fixture-csrf-token' });
      if (url.pathname === '/api/admin/modules' && request.method() === 'GET') {
        return localJson(route, 200, { modules: [{
          moduleId: 'vpn.management',
          enabled: moduleEnabled,
          overridden: true,
          definition: {
            id: 'vpn.management',
            name: 'VPN Management',
            description: 'Manage VPN accounts.',
            disableImpact: ['VPN administration stops.'],
            dependsOn: [],
            adminTabs: ['vpn'],
          },
        }] });
      }
      if (url.pathname === '/api/admin/modules/usage') {
        return localJson(route, 200, { modules: [{
          moduleId: 'vpn.management',
          enabled: moduleEnabled,
          adminTabs: ['vpn'],
          workflows: [{ id: 'workflow-1', name: 'VPN approval', status: 'published', triggerKey: 'vpn.approved' }],
          automationRules: [],
          cronJobs: [],
        }] });
      }
      if (url.pathname === '/api/admin/config/privileges' && request.method() === 'GET') {
        return localJson(route, 200, { privileges: [{
          permissionKey: 'tickets.read',
          description: 'Read support tickets',
          adGroupDns: privilegeGroups,
          updatedBy: 'fixture-admin',
          updatedAt: '2026-09-04T00:00:00.000Z',
        }], legacyAdminGroupDns: [], operationalGaps: [] });
      }
      if (url.pathname === '/api/admin/config/directory-email' && request.method() === 'GET') return localJson(route, 200, { config: directoryConfig });
      if (url.pathname === '/api/admin/config/directory/suggest') return localJson(route, 200, { suggestions: [] });

      const payload = request.postData() ? request.postDataJSON() : null;
      requests.push({ method: request.method(), pathname: url.pathname, csrf: request.headers()['x-csrf-token'], payload });
      if (url.pathname === '/api/admin/config/directory/test-connection') {
        connectionAttempts += 1;
        return connectionAttempts === 1
          ? localJson(route, 503, { error: 'Synthetic directory unreachable' })
          : localJson(route, 200, { result: { ok: true, dnsHostName: 'directory.example.test', latencyMs: 0, tlsVerified: true } });
      }
      if (url.pathname === '/api/admin/config/directory/test-bind') {
        bindAttempts += 1;
        return bindAttempts === 1
          ? localJson(route, 200, { result: { ok: false, bindOk: true, searchOk: false, error: 'Synthetic search denied' } })
          : localJson(route, 200, { result: { ok: true, searchOk: true, searchedBase: 'OU=People,DC=example,DC=test', latencyMs: 0 } });
      }
      if (url.pathname === '/api/admin/modules' && request.method() === 'PATCH') {
        await new Promise((resolve) => setTimeout(resolve, 250));
        moduleEnabled = payload.enabled;
        return localJson(route, 200, { message: 'updated' });
      }
      if (url.pathname === '/api/admin/config/privileges' && request.method() === 'PUT') {
        await new Promise((resolve) => setTimeout(resolve, 250));
        privilegeGroups = payload.adGroupDns;
        return localJson(route, 200, { message: 'updated' });
      }
      if (url.pathname === '/api/admin/config/directory-email' && request.method() === 'PUT') {
        directorySaves.push({ csrf: request.headers()['x-csrf-token'], keys: Object.keys(payload.values), safeValues: Object.fromEntries(Object.entries(payload.values).filter(([key]) => !key.includes('password'))) });
        return localJson(route, 200, { updated: Object.keys(payload.values) });
      }
      if (url.pathname === '/api/admin/config/directory/test-email' && request.method() === 'POST') {
        relayAttempts += 1;
        return relayAttempts === 1 ? localJson(route, 503, { error: 'Relay unavailable' }) : localJson(route, 200, { ok: true, messageId: 'fixture-message' });
      }
      return localJson(route, 404, { error: `Unexpected fixture API: ${request.method()} ${url.pathname}` });
    });

    await page.goto(`${origin}/config-doctor-fixture`);
    await page.getByText('Capability Modules', { exact: true }).waitFor();
    await page.getByText('Privileges & Directory Groups', { exact: true }).waitFor();
    await page.getByText('Directory connection', { exact: true }).waitFor();

    const moduleSwitch = page.getByRole('switch');
    await moduleSwitch.click();
    await assert.doesNotReject(async () => moduleSwitch.waitFor({ state: 'attached' }));
    assert.equal(await moduleSwitch.isDisabled(), true, 'the updating module control remains disabled during its request');
    await page.getByText('Disabled vpn.management.', { exact: true }).waitFor();
    assert.equal(await moduleSwitch.isDisabled(), false);

    const dnInput = page.locator('#dns-tickets\\.read');
    await dnInput.fill('CN=UAR-Operators,OU=Groups,DC=example,DC=edu');
    await page.getByRole('button', { name: 'Add', exact: true }).click();
    const saveMapping = page.getByRole('button', { name: 'Save Mapping', exact: true });
    assert.equal(await saveMapping.isDisabled(), false, 'adding a group enables only its dirty mapping save');
    await saveMapping.click();
    assert.equal(await saveMapping.isDisabled(), true, 'the saving mapping button remains disabled during its request');
    await page.getByText('Saved mapping for "tickets.read".', { exact: true }).waitFor();

    assert.deepEqual(requests.map(({ method, pathname, csrf }) => ({ method, pathname, csrf })), [
      { method: 'PATCH', pathname: '/api/admin/modules', csrf: 'fixture-csrf-token' },
      { method: 'PUT', pathname: '/api/admin/config/privileges', csrf: 'fixture-csrf-token' },
    ]);
    assert.deepEqual(requests[0].payload, { moduleId: 'vpn.management', enabled: false });
    assert.deepEqual(requests[1].payload, {
      permissionKey: 'tickets.read',
      adGroupDns: [
        'CN=UAR-Readers,OU=Groups,DC=example,DC=edu',
        'CN=UAR-Operators,OU=Groups,DC=example,DC=edu',
      ],
    });

    const bindPassword = page.locator('#cfg-ldap\\.bindPassword');
    assert.equal(await page.locator('#config-change-reason').evaluate((saveReason) => {
      const lastField = document.getElementById('smtp-relay-test-recipient');
      return Boolean(lastField && (lastField.compareDocumentPosition(saveReason) & Node.DOCUMENT_POSITION_FOLLOWING));
    }), true, 'the save bar follows the directory and relay fields in reading and keyboard order');
    assert.equal(await bindPassword.getAttribute('type'), 'password', 'stored directory passwords remain masked');
    assert.equal(await bindPassword.inputValue(), '', 'stored directory passwords are never rendered back into the draft');
    await page.locator('#cfg-smtp\\.host').fill('relay-rotated.example.test');
    await page.locator('#cfg-email\\.from').fill('');
    await page.getByRole('button', { name: 'Save Configuration', exact: true }).click();
    await page.getByText('Saved 2 key(s). Takes effect immediately.', { exact: true }).waitFor();
    assert.deepEqual(directorySaves, [{
      csrf: 'fixture-csrf-token',
      keys: ['smtp.host', 'email.from'],
      safeValues: { 'smtp.host': 'relay-rotated.example.test', 'email.from': '' },
    }], 'blank secret drafts are kept, while non-secret blank drafts explicitly clear their override');

    await bindPassword.fill('synthetic-unsaved-draft');
    const connectionButton = page.getByRole('button', { name: 'Test connection', exact: true });
    await connectionButton.click();
    await page.getByText('ldaps://directory.example.test:636 — Synthetic directory unreachable', { exact: true }).locator('visible=true').first().waitFor();
    assert.equal(await connectionButton.isDisabled(), false, 'a failed connection probe can be retried');
    await connectionButton.click();
    await page.getByText('Server detected — directory.example.test (0 ms)', { exact: true }).locator('visible=true').first().waitFor();
    const bindButton = page.getByRole('button', { name: 'Test bind on primary', exact: true });
    await bindButton.click();
    await page.getByText('Synthetic search denied', { exact: true }).waitFor();
    assert.equal(await bindButton.isDisabled(), false, 'a partial bind failure can be retried');
    await bindButton.click();
    await page.getByText('Bind account works and can read OU=People,DC=example,DC=test (0 ms)', { exact: true }).waitFor();
    const probes = requests.filter(({ pathname }) => /test-(connection|bind)$/.test(pathname));
    assert.deepEqual(probes.map(({ method, csrf, payload }) => ({ method, csrf, payload })), [
      { method: 'POST', csrf: 'fixture-csrf-token', payload: { url: 'ldaps://directory.example.test:636' } },
      { method: 'POST', csrf: 'fixture-csrf-token', payload: { url: 'ldaps://directory.example.test:636' } },
      { method: 'POST', csrf: 'fixture-csrf-token', payload: {} },
      { method: 'POST', csrf: 'fixture-csrf-token', payload: {} },
    ], 'probes preserve CSRF, saved-credential semantics, and never send the unsaved password');
    assert.equal(await bindPassword.inputValue(), 'synthetic-unsaved-draft', 'testing does not discard an unsaved password draft');

    const recipient = page.locator('#smtp-relay-test-recipient');
    await recipient.fill('operator@example.test');
    const relayButton = page.getByRole('button', { name: 'Send test email', exact: true });
    await relayButton.click();
    await page.getByText('Relay unavailable', { exact: true }).waitFor();
    await relayButton.click();
    await page.getByText('Test message accepted by relay (fixture-message).', { exact: true }).waitFor();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, 'configuration controls must not overflow their viewport');
    assert.deepEqual(externalRequests, [], 'fixture must abort rather than contact external services');
    assert.deepEqual(browserErrors, [], `browser errors: ${browserErrors.join('\n')}`);
    await context.close();
  }
  console.log('Configuration fixture passed: module and privilege callbacks, disabled/loading states, CSRF, exact payloads, local APIs, and responsive viewports.');
} finally {
  await browser.close();
  await server.close();
}
