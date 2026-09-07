import ExcelJS from 'exceljs';
import { describe, expect, it, vi } from 'vitest';
import { buildBatchAccountExport, initialPasswordAvailability, type BatchExportItem, type BatchExportSource } from './batch-account-export';

const now = new Date('2026-09-06T12:00:00Z');
export function exportFixture(): BatchExportSource {
  const ad: BatchExportItem = {
    id: 'ad-1', batchId: 'batch-1', lifecycleOwnerKind: 'batch_item', accessRequestId: null,
    accountType: 'AD', name: '=literal name', email: 'ad@example.test', ldapUsername: '00001', vpnUsername: null,
    password: 'cipher-ad', accountExpiresAt: null, isInternal: true, status: 'completed',
    mutationStage: 'external_mutations_complete', completedAt: new Date('2026-09-06T11:00:00Z'),
    ldapCreatedAt: new Date('2026-09-06T10:59:00Z'), vpnCreatedAt: null,
    targetDirectoryDn: 'CN=00001,DC=example,DC=test', targetDirectoryObjectGuid: 'guid-1', adAccountStatus: 'disabled', vpnAccount: null,
  };
  const vpn: BatchExportItem = {
    ...ad, id: 'vpn-1', accountType: 'VPN', name: 'VPN person', ldapUsername: 'vpn01', vpnUsername: 'vpn01',
    password: 'cipher-vpn', ldapCreatedAt: null, vpnCreatedAt: new Date('2026-09-06T10:59:00Z'),
    targetDirectoryDn: null, targetDirectoryObjectGuid: null, adAccountStatus: null,
    vpnAccount: { portalType: 'External', status: 'active', username: 'vpn01', batchId: 'batch-1', accessRequestId: null },
  };
  return { id: 'batch-1', description: 'Workshop', createdBy: 'operator', status: 'completed', completedAt: now, accounts: [ad, vpn] };
}

describe('batch initial password export', () => {
  it('exports every item for a five-AD, three-VPN batch', async () => {
    const batch = exportFixture();
    batch.accounts = [
      ...Array.from({ length: 5 }, (_, index) => ({ ...batch.accounts[0], id: `ad-${index}` })),
      ...Array.from({ length: 3 }, (_, index) => ({ ...batch.accounts[1], id: `vpn-${index}` })),
    ];
    const result = await buildBatchAccountExport(batch, 7, () => 'initial-test-password', now);
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(result.bytes as unknown as ExcelJS.Buffer);
    expect(workbook.worksheets[0].actualRowCount).toBe(6);
    expect(workbook.worksheets[1].actualRowCount).toBe(4);
    expect(result.disclosures).toHaveLength(8);
  });
  it('round trips separate AD/VPN sheets, exact text credentials and IDs', async () => {
    const batch = exportFixture();
    const decrypt = vi.fn((cipher: string) => cipher === 'cipher-ad' ? '=SUM(1,2)' : ' 001! ');
    const result = await buildBatchAccountExport(batch, 7, decrypt, now);
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(result.bytes as unknown as ExcelJS.Buffer);
    expect(workbook.worksheets.map(sheet => sheet.name)).toEqual(['AD', 'VPN', 'Read me']);
    expect(workbook.worksheets[0].getCell('C2').value).toBe('=literal name');
    expect(workbook.worksheets[0].getCell('E2').value).toBe('00001');
    expect(workbook.worksheets[0].getCell('F2').value).toBe('=SUM(1,2)');
    expect(workbook.worksheets[1].getCell('F2').value).toBe(' 001! ');
    expect(workbook.worksheets[0].getCell('B2').value).toBe('ad-1');
    expect(JSON.stringify(result.disclosures)).not.toMatch(/cipher-ad|SUM\(1/);
  });

  it.each([
    { status: 'processing' }, { status: 'failed' }, { status: 'rolled_back' }, { status: 'reconciliation_required' },
    { lifecycleOwnerKind: 'unresolved' }, { lifecycleOwnerKind: 'access_request_legacy', accessRequestId: 'request-1' },
    { batchId: 'different' }, { password: '' }, { adAccountStatus: 'deleted' }, { targetDirectoryObjectGuid: null },
    { completedAt: null }, { mutationStage: 'ldap_password_started' },
    { completedAt: new Date('2026-08-30T12:00:00Z') }, { completedAt: new Date('2026-09-07T12:00:00Z') },
  ])('never decrypts unavailable AD credentials: %j', async (override) => {
    const batch = exportFixture();
    batch.accounts = [{ ...batch.accounts[0], ...override }];
    const decrypt = vi.fn();
    const result = await buildBatchAccountExport(batch, 7, decrypt, now);
    expect(decrypt).not.toHaveBeenCalled();
    expect(result.disclosures[0].availability).toMatch(/^Unavailable:/);
  });

  it('obeys shorter configured retention and caps longer retention at seven days', () => {
    const batch = exportFixture();
    const item = { ...batch.accounts[0], completedAt: new Date('2026-09-04T12:00:00Z') };
    expect(initialPasswordAvailability(batch, item, 1, now)).toContain('retention period ended');
    expect(initialPasswordAvailability(batch, { ...item, completedAt: new Date('2026-08-29T12:00:00Z') }, 30, now)).toContain('retention period ended');
  });

  it.each(['revoked', 'deleted', 'unknown'])('withholds VPN passwords for %s live records', async status => {
    const batch = exportFixture();
    const vpn = batch.accounts[1];
    batch.accounts = [{ ...vpn, vpnAccount: { ...vpn.vpnAccount!, status } }];
    const decrypt = vi.fn();
    await buildBatchAccountExport(batch, 7, decrypt, now);
    expect(decrypt).not.toHaveBeenCalled();
  });

  it('withholds all passwords for a failed batch and when a VPN record is absent', async () => {
    const batch = exportFixture();
    const decrypt = vi.fn();
    await buildBatchAccountExport({ ...batch, status: 'failed' }, 7, decrypt, now);
    await buildBatchAccountExport({ ...batch, accounts: [{ ...batch.accounts[1], vpnAccount: null }] }, 7, decrypt, now);
    expect(decrypt).not.toHaveBeenCalled();
  });

  it('retains all rows with an explicit reason for a corrupt credential or unknown legacy type', async () => {
    const batch = exportFixture();
    batch.accounts.push({ ...batch.accounts[0], id: 'legacy-other', accountType: 'OTHER' });
    const decrypt = vi.fn((value: string) => {
      if (value === 'cipher-ad') throw new Error('sensitive-exception-must-not-escape');
      return 'valid-vpn-password';
    });
    const result = await buildBatchAccountExport(batch, 7, decrypt, now);
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(result.bytes as unknown as ExcelJS.Buffer);
    expect(workbook.getWorksheet('AD')!.getCell('F2').value).toBe('');
    expect(workbook.getWorksheet('AD')!.getCell('G2').value).toBe('Unavailable: password decryption failed');
    expect(workbook.getWorksheet('VPN')!.getCell('F2').value).toBe('valid-vpn-password');
    expect(workbook.getWorksheet('Other')!.getCell('B2').value).toBe('legacy-other');
    expect(workbook.getWorksheet('Other')!.getCell('F2').value).toBe('');
    expect(JSON.stringify(result.disclosures)).not.toContain('sensitive-exception');
    expect(decrypt).toHaveBeenCalledTimes(2);
  });
});
