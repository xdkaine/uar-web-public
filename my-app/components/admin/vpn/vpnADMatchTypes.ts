export interface ImportRecord {
  id: string;
  vpnUsername: string;
  fullName?: string;
  email?: string;
  notes?: string;
  matchStatus: string;
  adUsername?: string;
  adDisplayName?: string;
  adEmail?: string;
  adDepartment?: string;
  matchedBy?: string;
  matchedAt?: string;
  matchNotes?: string;
}

export interface VPNImport {
  id: string;
  createdAt: string;
  portalType: string;
  fileName: string;
  importedBy: string;
  totalRecords: number;
  matchedRecords: number;
  status: string;
  notes?: string;
  importRecords: ImportRecord[];
}

export interface ADSearchResult {
  username: string;
  displayName?: string;
  email?: string;
  dn?: string | null;
}
