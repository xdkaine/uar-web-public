import { describe, expect, it } from 'vitest';

import { reviewBatchAccountPlan } from './batch-account-plan';

const validAdAccount = {
  name: 'Workshop User',
  email: 'workshop@example.test',
  ldapUsername: 'workshopuser',
  password: 'not-a-real-password',
  accountExpiresAt: '',
  isInternal: true,
};

describe('batch account plan review', () => {
  it('accepts a complete AD-only plan', () => {
    expect(reviewBatchAccountPlan('Workshop accounts', [validAdAccount], [])).toMatchObject({
      isReady: true,
      issues: [],
      rows: [{ type: 'AD', username: 'workshopuser', issues: [] }],
    });
  });

  it('surfaces duplicate usernames and emails before submission', () => {
    const review = reviewBatchAccountPlan('Workshop accounts', [
      validAdAccount,
      { ...validAdAccount, name: 'Second User', ldapUsername: 'WorkshopUser', email: 'WORKSHOP@example.test' },
    ], []);

    expect(review.isReady).toBe(false);
    expect(review.rows.every(row => row.issues.includes('Username is duplicated in this batch.'))).toBe(true);
    expect(review.rows.every(row => row.issues.includes('Email is duplicated in this batch.'))).toBe(true);
  });

  it('requires expiration for external AD and all VPN accounts', () => {
    const review = reviewBatchAccountPlan('External access', [
      { ...validAdAccount, isInternal: false },
    ], [{
      name: 'VPN User',
      email: '',
      vpnUsername: 'vpnuser',
      password: 'not-a-real-password',
      accountExpiresAt: '',
      portalType: 'External',
    }]);

    expect(review.rows[0].issues).toContain('External accounts require an expiration.');
    expect(review.rows[1].issues).toContain('Expiration is required.');
  });
});
