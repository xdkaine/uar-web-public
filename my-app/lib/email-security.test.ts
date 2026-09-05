import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const sendMail = vi.fn().mockResolvedValue({
    messageId: 'message-1',
    accepted: ['user@example.test'],
    rejected: [],
  });

  return {
    sendMail,
    createTransport: vi.fn(() => ({ sendMail })),
    getEmailConfig: vi.fn().mockResolvedValue({
      emailFrom: 'no-reply@example.test',
      adminEmail: 'admin@example.test',
    }),
    getRequiredEnv: vi.fn((key: string) => ({
      SMTP_HOST: 'smtp.example.test',
      SMTP_PORT: '587',
      SMTP_USER: 'smtp-user',
      SMTP_PASSWORD: 'smtp-password',
      NEXT_PUBLIC_APP_URL: 'https://portal.example.test',
      EMAIL_FROM: 'no-reply@example.test',
    })[key]),
    getConfigValue: vi.fn(async (key: string) => ({
      'smtp.host': 'smtp.example.test',
      'smtp.port': 587,
      'smtp.user': 'smtp-user',
    }[key])),
    getRequiredSecretValue: vi.fn(async (key: string) =>
      key === 'smtp.password' ? 'smtp-password' : Promise.reject(new Error('unexpected secret ' + key))
    ),
    appLogger: {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    },
  };
});

vi.mock('nodemailer', () => ({
  default: {
    createTransport: mocks.createTransport,
  },
}));

vi.mock('./env-validator', () => ({
  getRequiredEnv: mocks.getRequiredEnv,
}));

vi.mock('@/lib/config/resolver', () => ({
  getConfigValue: mocks.getConfigValue,
  getRequiredSecretValue: mocks.getRequiredSecretValue,
}));

vi.mock('./email-config', () => ({
  getEmailConfig: mocks.getEmailConfig,
}));

vi.mock('@/lib/logger', () => ({
  appLogger: mocks.appLogger,
}));

// These tests exercise SMTP construction and secret-safe logging, not persisted
// message-template lookup. Returning the supplied fallback keeps the suite
// deterministic when no disposable database is running.
vi.mock('./messages/core', () => ({
  resolveEmailContent: vi.fn(async (
    _key: string,
    _variables: Record<string, string>,
    fallback: { subject: string; html: string },
  ) => fallback),
}));

import { sendAccountReadyEmail, sendPasswordResetEmail } from './email';

function serializedApplicationLogs(): string {
  return JSON.stringify([
    ...mocks.appLogger.info.mock.calls,
    ...mocks.appLogger.warn.mock.calls,
    ...mocks.appLogger.error.mock.calls,
    ...mocks.appLogger.debug.mock.calls,
  ]);
}

describe('SMTP logging security', () => {
  beforeEach(() => {
    mocks.sendMail.mockClear();
    Object.values(mocks.appLogger).forEach((loggerMethod) => loggerMethod.mockClear());
  });

  it('disables Nodemailer protocol and message debug logging', async () => {
    // Transport creation is lazy (ADR-0005): trigger a send to build it.
    await sendPasswordResetEmail('user@example.test', 'transport-init-canary');

    expect(mocks.createTransport).toHaveBeenCalledWith({
      host: 'smtp.example.test',
      port: 587,
      secure: false,
      requireTLS: true,
      tls: {
        rejectUnauthorized: true,
      },
      auth: {
        user: 'smtp-user',
        pass: 'smtp-password',
      },
      logger: false,
      debug: false,
    });
  });

  it('still delivers the one-time reset URL without sending it to application logs', async () => {
    const token = 'one-time-reset-token-canary';

    await sendPasswordResetEmail('user@example.test', token);

    const message = mocks.sendMail.mock.calls[0][0];
    expect(message.html).toContain(
      `https://portal.example.test/reset-password?token=${token}`
    );
    expect(serializedApplicationLogs()).not.toContain(token);
  });

  it('still delivers an account password without sending it to application logs', async () => {
    const password = 'account-password-canary';

    await sendAccountReadyEmail(
      'user@example.test',
      'Test User',
      'test-user',
      password,
      false
    );

    const message = mocks.sendMail.mock.calls[0][0];
    expect(message.html).toContain(password);
    expect(serializedApplicationLogs()).not.toContain(password);
  });

  it('rebuilds the SMTP transport after a saved password rotation', async () => {
    mocks.createTransport.mockClear();
    mocks.getRequiredSecretValue
      .mockResolvedValueOnce('rotated-password-one')
      .mockResolvedValueOnce('rotated-password-two');

    await sendPasswordResetEmail('user@example.test', 'first-token');
    await sendPasswordResetEmail('user@example.test', 'second-token');

    expect(mocks.createTransport).toHaveBeenCalledTimes(2);
    const transportOptions = (mocks.createTransport.mock.calls as unknown as Array<[
      { auth: { pass: string } },
    ]>).map(([options]) => options);
    expect(transportOptions[0]?.auth.pass).toBe('rotated-password-one');
    expect(transportOptions[1]?.auth.pass).toBe('rotated-password-two');
  });
});
