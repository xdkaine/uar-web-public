import { expect, it } from 'vitest';
import { buildFacultyHandoffMessage } from './buildFacultyHandoffMessage';
import type { AccessRequest } from './RequestDetailTypes';

const externalRequest: AccessRequest = {
  id: 'request-1', version: 1, createdAt: '2026-09-04T00:00:00.000Z', updatedAt: '2026-09-04T00:00:00.000Z',
  name: 'Taylor Example', email: 'taylor@example.test', isInternal: false, needsDomainAccount: false,
  isVerified: true, status: 'pending_faculty', acknowledgedByDirector: true, vpnUsername: 'taylor-vpn',
};

it('requires an audited reveal placeholder for external handoffs until a password is supplied', () => {
  const message = buildFacultyHandoffMessage({
    request: externalRequest,
    facultyHandoffTemplate: null,
    revealedFacultyPassword: '',
  });

  expect(message).toContain('Password: [Reveal the password before copying this message]');
  expect(message).toContain('VPN Username: taylor-vpn');
  expect(message).toContain('create the requester\'s VPN account');
});

it('renders a revealed external password and leaves unknown custom template tokens intact', () => {
  expect(buildFacultyHandoffMessage({
    request: externalRequest,
    facultyHandoffTemplate: '{{name}} {{password}} {{unknownToken}}',
    revealedFacultyPassword: 'audited-password',
  })).toBe('Taylor Example audited-password {{unknownToken}}');
});

it('renders internal handoffs with N/A password and no VPN line', () => {
  const message = buildFacultyHandoffMessage({
    request: { ...externalRequest, isInternal: true, vpnUsername: 'should-not-render' },
    facultyHandoffTemplate: null,
    revealedFacultyPassword: 'must-not-render',
  });

  expect(message).toContain('Password: N/A');
  expect(message).not.toContain('VPN Username:');
  expect(message).toContain('verify the requester\'s access');
  expect(message).toContain('Please let me know once access has been verified.');
});

it('uses the supplied local date formatting for the account-disable template token', () => {
  const accountExpiresAt = '2026-09-10T17:04:00.000Z';
  expect(buildFacultyHandoffMessage({
    request: { ...externalRequest, accountExpiresAt },
    facultyHandoffTemplate: '{{accountDisableDate}}',
    revealedFacultyPassword: 'audited-password',
  })).toBe(`\nAccount Disable Date: ${new Date(accountExpiresAt).toLocaleString()}`);
});

it('returns an empty message without a request', () => {
  expect(buildFacultyHandoffMessage({
    request: null,
    facultyHandoffTemplate: null,
    revealedFacultyPassword: '',
  })).toBe('');
});
