import ExcelJS from 'exceljs';

export interface BatchExportItem {
  id: string;
  batchId: string;
  lifecycleOwnerKind: string;
  accessRequestId: string | null;
  accountType: string;
  name: string;
  email: string | null;
  ldapUsername: string;
  vpnUsername: string | null;
  password: string;
  accountExpiresAt: Date | null;
  isInternal: boolean;
  status: string;
  mutationStage: string | null;
  completedAt: Date | null;
  ldapCreatedAt: Date | null;
  vpnCreatedAt: Date | null;
  targetDirectoryDn: string | null;
  targetDirectoryObjectGuid: string | null;
  adAccountStatus: string | null;
  vpnAccount: { portalType: string; status: string; username: string; batchId: string | null; accessRequestId: string | null } | null;
}

export interface BatchExportSource {
  id: string;
  description: string;
  createdBy: string;
  status: string;
  completedAt: Date | null;
  accounts: BatchExportItem[];
}

export function initialPasswordAvailability(batch: BatchExportSource, item: BatchExportItem, retentionDays: number, now: Date): string {
  if (batch.status !== 'completed' || item.status !== 'completed') return 'Unavailable: creation not completed';
  if (item.batchId !== batch.id || item.lifecycleOwnerKind !== 'batch_item' || item.accessRequestId) return 'Unavailable: not a standalone batch owner';
  if (!batch.completedAt || !item.completedAt || item.mutationStage !== 'external_mutations_complete') return 'Unavailable: incomplete creation evidence';
  const age = now.getTime() - item.completedAt.getTime();
  if (!Number.isFinite(age) || age < 0 || age >= Math.min(retentionDays, 7) * 86_400_000) return 'Unavailable: retention period ended';
  if (!item.password) return 'Unavailable: password cleared';
  if (item.accountType === 'AD') {
    if (!item.ldapCreatedAt || !item.targetDirectoryDn || !item.targetDirectoryObjectGuid || !['active', 'disabled'].includes(item.adAccountStatus ?? '')) return 'Unavailable: directory evidence missing or account deleted';
  } else if (item.accountType === 'VPN') {
    const vpn = item.vpnAccount;
    if (!item.vpnCreatedAt || !vpn || vpn.batchId !== batch.id || vpn.accessRequestId || !item.vpnUsername || vpn.username.toLowerCase() !== item.vpnUsername.toLowerCase() || !['active', 'disabled', 'pending_faculty'].includes(vpn.status)) return 'Unavailable: VPN evidence missing or account revoked';
  } else return 'Unavailable: unsupported account type';
  return 'Available: initial password (may have changed)';
}

export async function buildBatchAccountExport(batch: BatchExportSource, retentionDays: number, decrypt: (value: string) => string, now = new Date()) {
  const workbook = new ExcelJS.Workbook();
  const headers = ['Batch ID', 'Item ID', 'Name', 'Email', 'Username', 'Initial password', 'Password availability', 'Status', 'Account status', 'Expires at (UTC)', 'Internal', 'Portal type', 'Completed at (UTC)', 'Directory DN', 'Directory object GUID', 'Access request ID', 'Owner kind', 'Batch purpose', 'Account type'];
  const addSheet = (name: string) => {
    const sheet = workbook.addWorksheet(name, { views: [{ state: 'frozen', ySplit: 1 }] });
    sheet.addRow(headers);
    sheet.getRow(1).font = { bold: true };
    sheet.columns.forEach(column => { column.width = 26; });
    sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: headers.length } };
    return sheet;
  };
  const sheets = ['AD', 'VPN'].map(addSheet);
  const disclosures: Array<{ itemId: string; availability: string }> = [];
  for (const item of batch.accounts) {
    let availability = initialPasswordAvailability(batch, item, retentionDays, now);
    let password = '';
    if (availability.startsWith('Available:')) {
      try {
        password = decrypt(item.password);
        if (!password) availability = 'Unavailable: empty initial password';
      } catch {
        availability = 'Unavailable: password decryption failed';
      }
    }
    disclosures.push({ itemId: item.id, availability });
    // Plain string cells preserve leading zeroes and formula-like credentials without executing them.
    const sheet = item.accountType === 'AD' ? sheets[0] : item.accountType === 'VPN' ? sheets[1] : workbook.getWorksheet('Other') ?? addSheet('Other');
    sheet.addRow([
      batch.id, item.id, item.name, item.email ?? '', item.accountType === 'AD' ? item.ldapUsername : item.vpnUsername ?? item.ldapUsername,
      password, availability, item.status, item.accountType === 'AD' ? item.adAccountStatus ?? '' : item.vpnAccount?.status ?? '',
      item.accountExpiresAt?.toISOString() ?? '', String(item.isInternal), item.vpnAccount?.portalType ?? '', item.completedAt?.toISOString() ?? '',
      item.targetDirectoryDn ?? '', item.targetDirectoryObjectGuid ?? '', item.accessRequestId ?? '', item.lifecycleOwnerKind, batch.description, item.accountType,
    ]);
  }
  const notes = workbook.addWorksheet('Read me');
  notes.getColumn(1).width = 110;
  notes.addRows([
    ['Batch account results — contains sensitive initial passwords. Store and share securely.'],
    ['AD is sheet 1; VPN is sheet 2. Every recorded account is included with its outcome.'],
    ['These are initial passwords, not a live check of current credentials. Passwords may have changed.'],
    [`Passwords are available only while retained, for at most ${Math.min(retentionDays, 7)} days after item completion.`],
    ['Blank passwords have an explicit reason in Password availability. Failed, legacy, revoked, deleted, or unresolved accounts are not revealed.'],
    ['New AD accounts are created disabled. Enable them separately through Account Lifecycle when appropriate.'],
    ['This results workbook is not an import template. Use Download template to prepare a new batch.'],
  ]);
  return { bytes: new Uint8Array(await workbook.xlsx.writeBuffer()), disclosures };
}
