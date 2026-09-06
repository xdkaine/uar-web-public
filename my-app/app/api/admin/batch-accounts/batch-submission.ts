import { createHash, createHmac } from 'crypto';

export interface ADAccountInput {
  name: string;
  email?: string;
  ldapUsername: string;
  password: string;
  accountExpiresAt?: string;
  isInternal: boolean;
}

export interface VPNAccountInput {
  name: string;
  email?: string;
  vpnUsername: string;
  password: string;
  accountExpiresAt: string;
  isInternal?: boolean;
  portalType?: string; // "Management", "Limited", "External"
}

export interface BatchCreationRequest {
  description: string;
  linkedTicketId?: string;
  idempotencyKey: string;
  adAccounts: ADAccountInput[];
  vpnAccounts: VPNAccountInput[];
}

export function batchSubmissionFingerprint(body: BatchCreationRequest): string {
  const fingerprintSecret = process.env.ENCRYPTION_SECRET;
  if (!fingerprintSecret) {
    throw new Error('ENCRYPTION_SECRET is required for batch submission fingerprinting');
  }
  const credentialVerifier = (password: unknown) => (
    typeof password === 'string' && password.length > 0
      ? createHmac('sha256', fingerprintSecret).update(`batch-submission:${password}`).digest('hex')
      : null
  );
  const adAccounts = Array.isArray(body.adAccounts) ? body.adAccounts : [];
  const vpnAccounts = Array.isArray(body.vpnAccounts) ? body.vpnAccounts : [];
  const canonical = {
    description: typeof body.description === 'string' ? body.description.trim() : '',
    linkedTicketId: typeof body.linkedTicketId === 'string' ? body.linkedTicketId : null,
    adAccounts: adAccounts.map(account => ({
      name: typeof account.name === 'string' ? account.name.trim() : '',
      email: typeof account.email === 'string' ? account.email.trim().toLowerCase() : '',
      ldapUsername: typeof account.ldapUsername === 'string' ? account.ldapUsername.trim().toLowerCase() : '',
      accountExpiresAt: typeof account.accountExpiresAt === 'string' ? account.accountExpiresAt : null,
      isInternal: account.isInternal === true,
      credentialVerifier: credentialVerifier(account.password),
    })),
    vpnAccounts: vpnAccounts.map(account => ({
      name: typeof account.name === 'string' ? account.name.trim() : '',
      email: typeof account.email === 'string' ? account.email.trim().toLowerCase() : '',
      vpnUsername: typeof account.vpnUsername === 'string' ? account.vpnUsername.trim().toLowerCase() : '',
      accountExpiresAt: typeof account.accountExpiresAt === 'string' ? account.accountExpiresAt : '',
      isInternal: account.isInternal === true,
      portalType: typeof account.portalType === 'string' ? account.portalType : '',
      credentialVerifier: credentialVerifier(account.password),
    })),
  };
  return createHash('sha256').update(JSON.stringify(canonical)).digest('hex');
}
