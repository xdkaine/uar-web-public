import assert from 'node:assert/strict';

function importData(id = 'synthetic-import', matched = false) {
  return {
    id, createdAt: '2026-01-01T00:00:00Z', portalType: 'Internal', fileName: `${id}.csv`,
    importedBy: 'fixture', totalRecords: 1, matchedRecords: matched ? 1 : 0, status: 'pending',
    importRecords: [{ id: `${id}-record`, vpnUsername: `${id}.user`, matchStatus: matched ? 'matched' : 'unmatched', adUsername: matched ? 'first.ad' : undefined }],
  };
}

export async function checkVPNMatchBehavior(browser, origin, scenario) {
  for (const width of [390, 1280]) {
    const context = await browser.newContext({ viewport: { width, height: 1000 } });
    const page = await context.newPage();
    page.setDefaultTimeout(10000);
    const errors = [];
    const calls = [];
    let getCount = 0;
    let matchCount = 0;
    let matched = false;
    let noMatch = false;
    let releaseOld;
    const oldGate = new Promise(resolve => { releaseOld = resolve; });
    page.on('pageerror', error => errors.push(error.message));
    await context.addCookies([{ name: 'csrf-token', value: 'synthetic-match-csrf', url: origin }]);
    await page.route('**/*', async route => {
      const request = route.request();
      const url = new URL(request.url());
      if (url.origin !== origin) { errors.push('Blocked non-local request'); return route.abort(); }
      if (!url.pathname.startsWith('/api/')) return route.continue();
      calls.push({ method: request.method(), path: url.pathname, body: request.postDataJSON(), csrf: request.headers()['x-csrf-token'] });
      if (request.method() === 'GET' && url.pathname.startsWith('/api/admin/vpn-import/')) {
        getCount++;
        if (scenario === 'feedback' && getCount === 1) return route.fulfill({ status: 500, json: { error: 'Synthetic load failure' } });
        if (scenario === 'refresh-failure' && getCount === 2) return route.fulfill({ status: 500, json: {} });
        if (scenario === 'stale' && getCount === 1) await oldGate;
        const data = importData(url.pathname.split('/').at(-1), matched);
        if (noMatch) data.importRecords[0].matchStatus = 'no_match';
        if (scenario === 'record-switch') {
          data.totalRecords = 2;
          data.importRecords.push({ id: 'second-record', vpnUsername: 'second.vpn', matchStatus: 'unmatched' });
        }
        return route.fulfill({ json: { data } });
      }
      if (url.pathname === '/api/admin/ad-search') {
        if (['record-switch', 'query-edit'].includes(scenario)) await oldGate;
        const username = url.searchParams.get('q') === 'second.ad' ? 'second.ad' : 'first.ad';
        return route.fulfill({ json: { data: [{ username, displayName: username, dn: `CN=${username},DC=example,DC=test` }] } });
      }
      if (url.pathname === '/api/admin/vpn-import/match') {
        matchCount++;
        if (['feedback', 'no-match'].includes(scenario) && matchCount === 1) return route.fulfill({ status: 500, json: {} });
        if (['pending-write', 'mutation-switch'].includes(scenario)) await oldGate;
        matched = request.method() === 'POST';
        noMatch = request.method() === 'PATCH';
        return route.fulfill({ json: { success: true } });
      }
      errors.push(`Unexpected local API: ${request.method()} ${url.pathname}`);
      return route.abort();
    });
    try {
      await page.goto(`${origin}/vpn-match-fixture`, { waitUntil: 'domcontentloaded', timeout: 60000 });
      if (scenario === 'stale') {
        await page.waitForFunction(() => document.querySelector('[role="dialog"]'));
        await page.evaluate(() => window.dispatchEvent(new CustomEvent('fixture-import', { detail: 'new-import' })));
        await page.getByText('new-import.csv', { exact: false }).waitFor();
        releaseOld();
        await page.waitForTimeout(300);
        assert.equal(await page.getByText('synthetic-import.csv', { exact: false }).count(), 0, 'late old import must not replace the new import');
        await page.getByText('new-import.csv', { exact: false }).waitFor();
      } else {
        if (scenario === 'feedback') {
          await page.getByText('Failed to load import data', { exact: true }).first().waitFor();
          await page.getByRole('button', { name: 'Retry loading' }).click();
        }
        await page.getByText('synthetic-import.csv', { exact: false }).waitFor();
        if (scenario === 'no-match') {
          await page.getByRole('button', { name: 'No Match', exact: true }).click();
          await page.getByText('Failed to update status', { exact: true }).waitFor();
          await page.getByRole('button', { name: 'No Match', exact: true }).click();
          await page.getByText('Marked as no match', { exact: true }).waitFor();
          assert.deepEqual(calls.filter(call => call.method === 'PATCH'), Array.from({ length: 2 }, () => ({
            method: 'PATCH', path: '/api/admin/vpn-import/match', csrf: 'synthetic-match-csrf',
            body: { recordId: 'synthetic-import-record', matchStatus: 'no_match', matchNotes: 'No matching AD account found' },
          })));
          assert.deepEqual(errors, []);
          console.log(`PASS: no-match at ${width}px`);
          continue;
        }
        if (scenario === 'record-switch') {
          await page.getByRole('row').filter({ hasText: 'synthetic-import.user' }).getByRole('button', { name: 'Match', exact: true }).click();
          await page.getByPlaceholder('Add any notes about this match...').fill('first record notes');
          await page.getByRole('button', { name: 'Search', exact: true }).click();
          await page.getByRole('button', { name: 'Searching...', exact: true }).waitFor();
          await page.getByRole('row').filter({ hasText: 'second.vpn' }).getByRole('button', { name: 'Match', exact: true }).click();
          releaseOld();
          await page.waitForTimeout(300);
          assert.equal(await page.getByText('first.ad', { exact: true }).count(), 0, 'old AD results must not become match candidates for the newly selected VPN record');
          assert.equal(await page.getByPlaceholder('Add any notes about this match...').inputValue(), '', 'notes belong to the selected VPN record');
          assert.equal(calls.filter(call => call.method !== 'GET').length, 0);
          console.log(`PASS: record-switch at ${width}px`);
          continue;
        }
        await page.getByRole('button', { name: 'Match', exact: true }).click();
        await page.getByRole('button', { name: 'Search', exact: true }).click();
        if (scenario === 'query-edit') {
          await page.getByRole('button', { name: 'Searching...', exact: true }).waitFor();
          await page.getByPlaceholder('Enter AD username...').fill('second.ad');
          releaseOld();
          await page.waitForTimeout(300);
          assert.equal(await page.getByText('first.ad', { exact: true }).count(), 0, 'edited query invalidates a pending search');
          assert.equal(calls.filter(call => call.method !== 'GET').length, 0);
          assert.deepEqual(errors, []);
          console.log(`PASS: query-edit at ${width}px`);
          continue;
        }
        const result = page.locator('[data-slot="card"]').filter({ has: page.getByText('first.ad', { exact: true }).first() }).last();
        await result.waitFor();
        if (scenario === 'keys') {
          await result.evaluate(element => { element.dataset.priorIdentity = 'first.ad'; });
          await page.getByPlaceholder('Enter AD username...').fill('second.ad');
          await page.getByRole('button', { name: 'Search', exact: true }).click();
          const nextResult = page.locator('[data-slot="card"]').filter({ has: page.getByText('second.ad', { exact: true }).first() }).last();
          await nextResult.waitFor();
          assert.equal(await nextResult.getAttribute('data-prior-identity'), null, 'a different AD identity must not inherit the previous result node');
        } else {
          await page.getByPlaceholder('Add any notes about this match...').fill('  operator match evidence  ');
          const cdp = await context.newCDPSession(page);
          await cdp.send('Performance.enable');
          const before = await cdp.send('Performance.getMetrics');
          await result.getByRole('button', { name: 'Match', exact: true }).click();
          if (scenario === 'pending-write') {
            await page.getByText('Saving match changes. Please wait before closing.', { exact: true }).waitFor();
            await page.keyboard.press('Escape');
            await page.getByRole('dialog').waitFor();
            for (const name of ['Close', 'Done', 'Cancel Matching']) assert.equal(await page.getByRole('button', { name, exact: true }).isDisabled(), true, `${name} cannot pretend to cancel an already-sent mutation`);
            assert.equal(calls.filter(call => call.method === 'POST').length, 1);
            releaseOld();
          }
          if (scenario === 'mutation-switch') {
            await page.getByText('Saving match changes. Please wait before closing.', { exact: true }).waitFor();
            await page.evaluate(() => window.dispatchEvent(new CustomEvent('fixture-import', { detail: 'new-import' })));
            await page.getByText('new-import.csv', { exact: false }).waitFor();
            releaseOld();
            await page.waitForTimeout(300);
            assert.equal(await page.getByText('synthetic-import.csv', { exact: false }).count(), 0);
            assert.equal(calls.filter(call => call.method === 'GET' && call.path === '/api/admin/vpn-import/synthetic-import').length, 1, 'old mutation completion cannot reload its closed session');
            assert.deepEqual(errors, []);
            console.log(`PASS: mutation-switch at ${width}px`);
            continue;
          }
          if (scenario === 'feedback') {
            await page.getByText('Failed to match account', { exact: true }).waitFor();
            assert.equal(await page.getByPlaceholder('Add any notes about this match...').inputValue(), '  operator match evidence  ');
            await result.getByRole('button', { name: 'Match', exact: true }).click();
          }
          if (scenario === 'refresh-failure') {
            await page.getByText('Change saved, but failed to reload import data. Retry loading.', { exact: true }).waitFor();
            assert.equal(await page.getByRole('button', { name: 'Match', exact: true }).isDisabled(), true, 'failed refresh prevents duplicate mutation against stale records');
            await page.getByRole('button', { name: 'Retry loading', exact: true }).click();
          }
          await page.getByText('100%', { exact: true }).waitFor();
          await page.waitForTimeout(400);
          const after = await cdp.send('Performance.getMetrics');
          const metric = (result, name) => result.metrics.find(item => item.name === name)?.value ?? 0;
          console.log(`${scenario} ${width}px LayoutCount delta=${metric(after, 'LayoutCount') - metric(before, 'LayoutCount')}`);
          if (scenario === 'feedback') await page.getByText('Successfully matched to AD account', { exact: true }).waitFor();
          const posts = calls.filter(call => call.method === 'POST');
          assert.equal(posts.length, scenario === 'feedback' ? 2 : 1);
          for (const post of posts) {
            assert.equal(post.csrf, 'synthetic-match-csrf');
            assert.deepEqual(post.body, { recordId: 'synthetic-import-record', adUsername: 'first.ad', matchNotes: '  operator match evidence  ' });
          }
        }
      }
      assert.deepEqual(errors, []);
      console.log(`PASS: ${scenario} at ${width}px`);
    } finally { releaseOld(); await context.close(); }
  }
}
