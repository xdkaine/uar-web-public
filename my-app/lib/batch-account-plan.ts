export interface BatchAdAccountDraft {
  name: string;
  email?: string;
  ldapUsername: string;
  password: string;
  accountExpiresAt: string;
  isInternal: boolean;
}

export interface BatchVpnAccountDraft {
  name: string;
  email?: string;
  vpnUsername: string;
  password: string;
  accountExpiresAt: string;
  portalType: string;
}

export interface BatchPlanReviewRow {
  key: string;
  type: 'AD' | 'VPN';
  name: string;
  username: string;
  issues: string[];
}

export interface BatchPlanReview {
  rows: BatchPlanReviewRow[];
  issues: string[];
  isReady: boolean;
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function duplicateValues(values: string[]): Set<string> {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const rawValue of values) {
    const value = rawValue.trim().toLowerCase();
    if (!value) continue;
    if (seen.has(value)) duplicates.add(value);
    seen.add(value);
  }
  return duplicates;
}

export function reviewBatchAccountPlan(
  description: string,
  adAccounts: BatchAdAccountDraft[],
  vpnAccounts: BatchVpnAccountDraft[]
): BatchPlanReview {
  const issues: string[] = [];
  if (!description.trim()) issues.push('Enter a batch description.');
  if (adAccounts.length === 0) issues.push('Add at least one AD account.');
  if (adAccounts.length + vpnAccounts.length > 100) issues.push('A batch can contain at most 100 accounts.');

  const duplicateAdUsernames = duplicateValues(adAccounts.map(account => account.ldapUsername));
  const duplicateAdEmails = duplicateValues(adAccounts.map(account => account.email || ''));
  const duplicateVpnUsernames = duplicateValues(vpnAccounts.map(account => account.vpnUsername));

  const adRows: BatchPlanReviewRow[] = adAccounts.map((account, index) => {
    const rowIssues: string[] = [];
    const username = account.ldapUsername.trim();
    const email = account.email?.trim() || '';
    if (!account.name.trim()) rowIssues.push('Full name is required.');
    if (!email) rowIssues.push('Email is required.');
    else if (!EMAIL_PATTERN.test(email)) rowIssues.push('Email is invalid.');
    if (!username) rowIssues.push('Username is required.');
    else if (username.length > 20) rowIssues.push('Username exceeds 20 characters.');
    if (!account.password) rowIssues.push('Password is required.');
    if (!account.isInternal && !account.accountExpiresAt) rowIssues.push('External accounts require an expiration.');
    if (duplicateAdUsernames.has(username.toLowerCase())) rowIssues.push('Username is duplicated in this batch.');
    if (duplicateAdEmails.has(email.toLowerCase())) rowIssues.push('Email is duplicated in this batch.');
    return { key: `ad-${index}`, type: 'AD', name: account.name.trim(), username, issues: rowIssues };
  });

  const vpnRows: BatchPlanReviewRow[] = vpnAccounts.map((account, index) => {
    const rowIssues: string[] = [];
    const username = account.vpnUsername.trim();
    if (!account.name.trim()) rowIssues.push('Full name is required.');
    if (!username) rowIssues.push('Username is required.');
    if (!account.password) rowIssues.push('Password is required.');
    if (!account.accountExpiresAt) rowIssues.push('Expiration is required.');
    if (!account.portalType) rowIssues.push('Portal type is required.');
    if (duplicateVpnUsernames.has(username.toLowerCase())) rowIssues.push('Username is duplicated in this batch.');
    return { key: `vpn-${index}`, type: 'VPN', name: account.name.trim(), username, issues: rowIssues };
  });

  const rows = [...adRows, ...vpnRows];
  return {
    rows,
    issues,
    isReady: issues.length === 0 && rows.length > 0 && rows.every(row => row.issues.length === 0),
  };
}
