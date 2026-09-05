import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

type EnrollmentState =
  | 'new'
  | 'pending'
  | 'verification-failed'
  | 'verification-sending'
  | 'active'
  | 'transaction-race'
  | 'smtp-failure';

const mocks = vi.hoisted(() => ({
  checkRateLimitAsync: vi.fn(),
  verifyTurnstileToken: vi.fn(),
  systemSettingsFindFirst: vi.fn(),
  blockedEmailFindFirst: vi.fn(),
  accessRequestFindFirst: vi.fn(),
  accessRequestDeleteMany: vi.fn(),
  accessRequestUpdateMany: vi.fn(),
  requestCommentCreate: vi.fn(),
  transaction: vi.fn(),
  transactionQueryRaw: vi.fn(),
  transactionAccessRequestFindFirst: vi.fn(),
  transactionAccessRequestCreate: vi.fn(),
  sendVerificationEmail: vi.fn(),
  searchLDAPUser: vi.fn(),
  findReusableOffboardedRequest: vi.fn(),
  reusableOffboardedUsername: vi.fn(),
  after: vi.fn(),
}));

vi.mock('next/server', async importOriginal => {
  const actual = await importOriginal<typeof import('next/server')>();
  return { ...actual, after: mocks.after };
});

vi.mock('@/lib/ratelimit', () => ({
  checkRateLimitAsync: mocks.checkRateLimitAsync,
  getRequiredClientIp: () => '203.0.113.40',
  isRateLimitUnavailable: () => false,
  RateLimitPresets: {
    requestSubmission: {
      maxRequests: 10,
      windowMs: 60 * 60 * 1000,
    },
  },
}));

vi.mock('@/lib/turnstile', () => ({
  verifyTurnstileToken: mocks.verifyTurnstileToken,
}));

vi.mock('@/lib/prisma', () => ({
  prisma: {
    systemSettings: {
      findFirst: mocks.systemSettingsFindFirst,
    },
    blockedEmail: {
      findFirst: mocks.blockedEmailFindFirst,
    },
    accessRequest: {
      findFirst: mocks.accessRequestFindFirst,
      deleteMany: mocks.accessRequestDeleteMany,
      updateMany: mocks.accessRequestUpdateMany,
    },
    requestComment: {
      create: mocks.requestCommentCreate,
    },
    $transaction: mocks.transaction,
  },
}));

vi.mock('@/lib/email', () => ({
  sendVerificationEmail: mocks.sendVerificationEmail,
}));

vi.mock('@/lib/ldap', () => ({
  searchLDAPUser: mocks.searchLDAPUser,
}));

vi.mock('@/lib/logger', () => ({
  appLogger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock('@/lib/offboard-reenrollment', () => ({
  findReusableOffboardedRequest: mocks.findReusableOffboardedRequest,
  reusableOffboardedUsername: mocks.reusableOffboardedUsername,
}));

import { POST } from './route';

type RequestOverrides = {
  name?: string;
  email?: string;
  isInternal?: boolean;
  turnstileToken?: string;
  institution?: string;
  eventReason?: string;
};

function request(overrides: RequestOverrides = {}) {
  return new NextRequest('https://portal.example.test/api/request', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      name: 'Victim User',
      email: 'victim@cpp.edu',
      isInternal: true,
      ...overrides,
    }),
  });
}

async function fingerprint(response: Response) {
  return {
    status: response.status,
    headers: [...response.headers.entries()].sort(([left], [right]) => (
      left.localeCompare(right)
    )),
    body: await response.text(),
  };
}

describe('public access-request success response', () => {
  let enrollmentState: EnrollmentState;
  let scheduledCallbacks: Array<() => void | Promise<void>>;

  beforeEach(() => {
    vi.clearAllMocks();
    enrollmentState = 'new';
    scheduledCallbacks = [];
    mocks.after.mockImplementation((callback: () => void | Promise<void>) => {
      scheduledCallbacks.push(callback);
    });

    mocks.checkRateLimitAsync.mockResolvedValue({
      success: true,
      limit: 10,
      remaining: 9,
      reset: Date.now() + 60 * 60 * 1000,
    });
    mocks.verifyTurnstileToken.mockResolvedValue(true);
    mocks.systemSettingsFindFirst.mockResolvedValue(null);
    mocks.blockedEmailFindFirst.mockResolvedValue(null);
    mocks.accessRequestFindFirst.mockImplementation(async ({ where }) => {
      if (
        ['pending', 'verification-failed', 'verification-sending'].includes(enrollmentState) &&
        Array.isArray(where.status?.in)
      ) {
        return { id: 'pending-request-id' };
      }
      if (enrollmentState === 'active' && where.status === 'approved') {
        return { id: 'active-request-id' };
      }
      return null;
    });
    mocks.transactionAccessRequestFindFirst.mockImplementation(async ({ where }) => {
      if (
        enrollmentState === 'transaction-race' &&
        Array.isArray(where.status?.in)
      ) {
        return { id: 'racing-request-id' };
      }
      return null;
    });
    mocks.transactionAccessRequestCreate.mockResolvedValue({
      id: 'new-request-id',
    });
    mocks.accessRequestUpdateMany.mockResolvedValue({ count: 1 });
    mocks.transaction.mockImplementation(async (operation) => operation({
      $queryRaw: mocks.transactionQueryRaw,
      accessRequest: {
        findFirst: mocks.transactionAccessRequestFindFirst,
        create: mocks.transactionAccessRequestCreate,
      },
    }));
    mocks.sendVerificationEmail.mockImplementation(async () => {
      if (enrollmentState === 'smtp-failure') {
        throw new Error('SMTP unavailable');
      }
    });
  });

  it('is byte-equivalent for new, active-delivery, racing duplicate, and SMTP failure paths', async () => {
    const responses = [];
    for (const state of [
      'new',
      'pending',
      'verification-failed',
      'verification-sending',
      'active',
      'transaction-race',
      'smtp-failure',
    ] as const) {
      enrollmentState = state;
      const sendsBeforeResponse = mocks.sendVerificationEmail.mock.calls.length;
      const response = await POST(request({
        name: 'Public Requester',
        email: 'requester@example.test',
        institution: 'Example University',
        eventReason: 'Security workshop',
        isInternal: false,
        turnstileToken: 'valid-turnstile-token',
      }));
      responses.push(await fingerprint(response));
      expect(mocks.sendVerificationEmail.mock.calls.length).toBe(sendsBeforeResponse);
      const callbacks = scheduledCallbacks.splice(0);
      await Promise.all(callbacks.map(callback => callback()));
    }

    expect(responses[0]).toEqual({
      status: 201,
      headers: [['content-type', 'application/json']],
      body: JSON.stringify({
        message: 'Request submitted successfully. Please check your email for verification.',
      }),
    });
    expect(responses.slice(1)).toEqual(Array(6).fill(responses[0]));
    expect(mocks.accessRequestFindFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        status: {
          in: expect.arrayContaining([
            'verification_email_failed',
            'verification_email_sending',
          ]),
        },
      }),
    }));
    expect(mocks.transactionAccessRequestFindFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        status: {
          in: expect.arrayContaining([
            'verification_email_failed',
            'verification_email_sending',
          ]),
        },
      }),
    }));
    expect(mocks.accessRequestUpdateMany).toHaveBeenCalledWith({
      where: {
        id: 'new-request-id',
        status: 'pending_verification',
        isVerified: false,
        verificationTokenHash: expect.any(String),
      },
      data: {
        status: 'verification_email_failed',
        provisioningState: 'verification_email_failed',
        provisioningError: 'Verification email delivery failed',
      },
    });
  });
});

describe('public re-enrollment directory ownership fencing', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.checkRateLimitAsync.mockResolvedValue(allowedRateLimit());
    mocks.verifyTurnstileToken.mockResolvedValue(true);
    mocks.systemSettingsFindFirst.mockResolvedValue(null);
    mocks.blockedEmailFindFirst.mockResolvedValue(null);
    mocks.accessRequestFindFirst.mockResolvedValue(null);
    mocks.transactionAccessRequestFindFirst.mockResolvedValue(null);
    mocks.transactionAccessRequestCreate.mockResolvedValue({ id: 'new-request-id' });
    mocks.accessRequestUpdateMany.mockResolvedValue({ count: 1 });
    mocks.requestCommentCreate.mockResolvedValue({ id: 'comment-1' });
    mocks.transactionQueryRaw.mockResolvedValue([{ lock_acquired: 'locked' }]);
    mocks.transaction.mockImplementation(async (operation) => operation({
      $queryRaw: mocks.transactionQueryRaw,
      accessRequest: {
        findFirst: mocks.transactionAccessRequestFindFirst,
        create: mocks.transactionAccessRequestCreate,
      },
    }));
    mocks.findReusableOffboardedRequest.mockResolvedValue({
      id: 'offboarded-request',
      vpnUsername: 'victim',
      linkedVpnUsername: 'victim',
    });
    mocks.reusableOffboardedUsername.mockReturnValue('victim');
    mocks.after.mockImplementation(() => undefined);
  });

  it('waits for the deletion fence and does not bind a request when the AD object disappeared', async () => {
    let releaseFence!: () => void;
    let fenceStarted!: () => void;
    const fenceEntered = new Promise<void>((resolve) => { fenceStarted = resolve; });
    const fencePending = new Promise<void>((resolve) => { releaseFence = resolve; });
    const originalDirectoryUser = {
      objectName: 'CN=victim,OU=Users,DC=example,DC=test',
      attributes: [
        { type: 'mail', values: ['victim@cpp.edu'] },
        { type: 'objectGUID', values: ['guid-victim'] },
      ],
    };
    mocks.searchLDAPUser
      .mockResolvedValueOnce(originalDirectoryUser)
      .mockResolvedValueOnce(null);
    mocks.transactionQueryRaw.mockImplementationOnce(async () => {
      fenceStarted();
      await fencePending;
      return [{ lock_acquired: 'locked' }];
    });

    const submission = POST(request({ turnstileToken: 'valid-turnstile-token' }));
    await fenceEntered;
    expect(mocks.transactionAccessRequestCreate).not.toHaveBeenCalled();

    releaseFence();
    const response = await submission;

    expect(response.status).toBe(201);
    expect(mocks.transactionAccessRequestCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        needsDomainAccount: true,
        ldapUsername: null,
        linkedAdUsername: null,
        isManuallyAssigned: false,
      }),
    }));
    expect(mocks.transactionQueryRaw.mock.calls[0].slice(1)).toEqual(['victim', 873211]);
  });
});

function allowedRateLimit(remaining = 9) {
  return {
    success: true,
    limit: 10,
    remaining,
    reset: Date.now() + 60 * 60 * 1000,
  };
}

describe('public access-request target quota ordering', () => {
  let targetAttempts: number;

  beforeEach(() => {
    vi.clearAllMocks();
    targetAttempts = 0;
    mocks.checkRateLimitAsync.mockImplementation(async (key: string) => {
      if (key !== 'access-request-email') {
        return allowedRateLimit();
      }

      targetAttempts += 1;
      return {
        success: targetAttempts <= 2,
        limit: 2,
        remaining: Math.max(0, 2 - targetAttempts),
        reset: Date.now() + 60 * 60 * 1000,
      };
    });
    mocks.verifyTurnstileToken.mockImplementation(
      async (token: string) => token === 'valid-turnstile-token'
    );
    mocks.systemSettingsFindFirst.mockResolvedValue(null);
    mocks.blockedEmailFindFirst.mockResolvedValue(null);
    mocks.accessRequestFindFirst.mockImplementation(async ({ where }) => (
      Array.isArray(where.status?.in) ? { id: 'existing-request' } : null
    ));
  });

  it.each([
    ['missing', undefined],
    ['invalid', 'invalid-turnstile-token'],
  ])(
    'does not consume a victim target quota for %s Turnstile attempts',
    async (_label, invalidToken) => {
      for (let attempt = 0; attempt < 2; attempt += 1) {
        const rejected = await POST(request({ turnstileToken: invalidToken }));
        expect(rejected.status).toBe(400);
      }

      const accepted = await POST(
        request({ turnstileToken: 'valid-turnstile-token' })
      );

      expect(accepted.status).toBe(201);
      expect(targetAttempts).toBe(1);
    }
  );

  it('validates the normalized request before consuming a target quota', async () => {
    const response = await POST(request({
      email: 'not-an-email',
      isInternal: false,
      turnstileToken: 'valid-turnstile-token',
    }));

    expect(response.status).toBe(400);
    expect(targetAttempts).toBe(0);
  });

  it('still applies the two-request target quota after valid challenges', async () => {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const accepted = await POST(
        request({ turnstileToken: 'valid-turnstile-token' })
      );
      expect(accepted.status).toBe(201);
    }

    const limited = await POST(
      request({ turnstileToken: 'valid-turnstile-token' })
    );

    expect(limited.status).toBe(429);
    expect(targetAttempts).toBe(3);
  });
});
