import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MESSAGE_TEMPLATE_CATALOG } from './messages/catalog';

const mocks = vi.hoisted(() => {
  const sendMail = vi.fn().mockResolvedValue({
    messageId: 'message-1',
    accepted: ['user@example.test'],
    rejected: [],
  });

  return {
    sendMail,
    createTransport: vi.fn(() => ({ sendMail })),
    getEmailConfig: vi.fn().mockResolvedValue({ emailFrom: 'no-reply@example.test' }),
    getRequiredEnv: vi.fn((key: string) => ({
      SMTP_HOST: 'smtp.example.test',
      SMTP_PORT: '587',
      SMTP_USER: 'smtp-user',
      NEXT_PUBLIC_APP_URL: 'https://portal.example.test',
      EMAIL_FROM: 'no-reply@example.test',
    })[key]),
    getConfigValue: vi.fn(async (key: string) => ({
      'smtp.host': 'smtp.example.test',
      'smtp.port': 587,
      'smtp.user': 'smtp-user',
    })[key]),
    getRequiredSecretValue: vi.fn().mockResolvedValue('smtp-password'),
  };
});

vi.mock('nodemailer', () => ({
  default: { createTransport: mocks.createTransport },
}));

vi.mock('./env-validator', () => ({ getRequiredEnv: mocks.getRequiredEnv }));
vi.mock('@/lib/config/resolver', () => ({
  getConfigValue: mocks.getConfigValue,
  getRequiredSecretValue: mocks.getRequiredSecretValue,
}));
vi.mock('./email-config', () => ({ getEmailConfig: mocks.getEmailConfig }));
vi.mock('./clone-safety', () => ({ assertExternalSideEffectAllowed: vi.fn() }));
vi.mock('./messages/core', () => ({
  resolveEmailContent: vi.fn(async (
    _key: string,
    _variables: Record<string, string>,
    fallback: { subject: string; html: string },
  ) => fallback),
}));

import { sendOffboardDirectCompletedEmail } from './email';

describe('direct offboarding completion notice', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.sendMail.mockResolvedValue({
      messageId: 'message-1',
      accepted: ['user@example.test'],
      rejected: [],
    });
  });

  it('registers an operator-editable lifecycle template', () => {
    const template = MESSAGE_TEMPLATE_CATALOG['offboard.direct_completed'];

    expect(template).toMatchObject({
      category: 'lifecycle',
      defaultSubject: 'Your Student SOC Access Has Been Offboarded',
    });
    expect(template.defaultBody).toContain('{{requestUrl}}');
    expect(template.defaultBody).toContain('{{supportUrl}}');
  });

  it('sends the completed notice with escaped account fields and portal links', async () => {
    await sendOffboardDirectCompletedEmail({
      email: 'user@example.test',
      name: '<Ava & Co>',
      adUsername: 'ava<admin>',
      vpnUsername: 'ava&vpn',
    });

    const message = mocks.sendMail.mock.calls[0][0];
    expect(message.to).toBe('user@example.test');
    expect(message.subject).toBe('Your Student SOC Access Has Been Offboarded');
    expect(message.html).toContain('Hello &lt;Ava &amp; Co&gt;,');
    expect(message.html).toContain('ava&lt;admin&gt;');
    expect(message.html).toContain('ava&amp;vpn');
    expect(message.html).toContain('Your linked VPN access has also been revoked.');
    expect(message.html).toContain('https://portal.example.test/request');
    expect(message.html).toContain('https://portal.example.test/support/create');
  });

  it('fails the caller when SMTP rejects the completed notice', async () => {
    mocks.sendMail.mockResolvedValue({
      messageId: 'message-1',
      accepted: [],
      rejected: ['user@example.test'],
    });

    await expect(sendOffboardDirectCompletedEmail({
      email: 'user@example.test',
      name: 'Ava',
      adUsername: 'ava',
    })).rejects.toThrow('Email rejected by server for recipients: user@example.test');
  });
});
