'use client';

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { 
  Table, 
  TableBody, 
  TableCell, 
  TableHead, 
  TableHeader, 
  TableRow 
} from "@/components/ui/table";

export interface VPNAccount {
  id: string;
  username: string;
  name: string;
  email: string;
  portalType: string;
  isInternal: boolean;
  status: string;
  expiresAt?: string;
  createdAt: string;
  createdBy: string;
  createdByFaculty: boolean;
  facultyCreatedAt?: string;
  disabledAt?: string;
  disabledBy?: string;
  disabledReason?: string;
  revokedAt?: string;
  revokedBy?: string;
  revokedReason?: string;
  restoredAt?: string;
  restoredBy?: string;
  canRestore?: boolean;
  notes?: string;
  adUsername?: string;
}

type SortField = 'username' | 'name' | 'email' | 'createdAt' | 'expiresAt';

interface VPNAccountsTableProps {
  accounts: VPNAccount[];
  title?: string;
  titleColor?: string;
  selectedIds: Set<string>;
  onToggleSelection: (id: string) => void;
  onToggleAllSelection: () => void;
  onViewAccount: (accountId: string) => void;
  sortField: SortField;
  sortDirection: 'asc' | 'desc';
  onSort: (field: SortField) => void;
  isLoading?: boolean;
}

/**
 * Accounts table component for VPN Management Tab
 * Displays VPN accounts with sorting, selection, and view actions
 */
export default function VPNAccountsTable({
  accounts,
  title,
  titleColor,
  selectedIds,
  onToggleSelection,
  onToggleAllSelection,
  onViewAccount,
  sortField,
  sortDirection,
  onSort,
  isLoading = false,
}: VPNAccountsTableProps) {
  
  const getStatusBadge = (status: string) => {
    const styles: Record<string, string> = {
      active: 'bg-green-100 text-green-800 border-green-300',
      pending_faculty: 'bg-yellow-100 text-yellow-800 border-yellow-300',
      disabled: 'bg-red-100 text-red-800 border-red-300',
      revoked: 'bg-purple-100 text-purple-800 border-purple-300',
    };

    const labels: Record<string, string> = {
      active: 'Active',
      pending_faculty: 'Pending Faculty',
      disabled: 'Disabled',
      revoked: 'Revoked',
    };

    return (
      <Badge variant="outline" className={styles[status] || 'bg-gray-100 text-gray-800 border-gray-300'}>
        {labels[status] || status}
      </Badge>
    );
  };

  const getPortalBadge = (portalType: string) => {
    const styles: Record<string, string> = {
      Management: 'bg-blue-100 text-blue-800 border-blue-300',
      Limited: 'bg-purple-100 text-purple-800 border-purple-300',
      External: 'bg-orange-100 text-orange-800 border-orange-300',
    };

    return (
      <Badge variant="outline" className={styles[portalType] || 'bg-gray-100 text-gray-800 border-gray-300'}>
        {portalType}
      </Badge>
    );
  };

  const SortIcon = ({ field }: { field: SortField }) => {
    if (sortField !== field) {
      return <span className="text-gray-400 ml-1">↕</span>;
    }
    return <span className="ml-1">{sortDirection === 'asc' ? '↑' : '↓'}</span>;
  };

  if (isLoading) {
    return (
      <div className="rounded-md border bg-white animate-pulse">
        <div className="h-12 bg-gray-100 rounded-t-md"></div>
        {[...Array(5)].map((_, i) => (
          <div key={i} className="h-14 border-t bg-gray-50"></div>
        ))}
      </div>
    );
  }

  if (accounts.length === 0) {
    return (
      <div className="text-center text-gray-600 py-8 border rounded-md bg-gray-50">
        {title ? `No ${title.toLowerCase()} accounts` : 'No accounts found'}
      </div>
    );
  }

  return (
    <div className={title ? "mb-8" : ""}>
      {title && (
        <h3 className={`text-lg font-bold mb-4 ${titleColor}`}>
          {title} ({accounts.length})
        </h3>
      )}
      <div className="rounded-md border bg-white overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow className="bg-gray-50">
              <TableHead className="w-[40px]">
                <Checkbox
                  checked={selectedIds.size === accounts.length && accounts.length > 0}
                  onCheckedChange={onToggleAllSelection}
                />
              </TableHead>
              <TableHead 
                className="cursor-pointer hover:bg-gray-100" 
                onClick={() => onSort('username')}
              >
                Username<SortIcon field="username" />
              </TableHead>
              <TableHead 
                className="cursor-pointer hover:bg-gray-100"
                onClick={() => onSort('name')}
              >
                Name<SortIcon field="name" />
              </TableHead>
              <TableHead>Portal</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Faculty</TableHead>
              <TableHead 
                className="cursor-pointer hover:bg-gray-100"
                onClick={() => onSort('createdAt')}
              >
                Created<SortIcon field="createdAt" />
              </TableHead>
              <TableHead 
                className="cursor-pointer hover:bg-gray-100"
                onClick={() => onSort('expiresAt')}
              >
                Expires<SortIcon field="expiresAt" />
              </TableHead>
              <TableHead>Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {accounts.map((account) => (
              <TableRow 
                key={account.id} 
                className={`hover:bg-gray-50 ${selectedIds.has(account.id) ? 'bg-blue-50' : ''}`}
              >
                <TableCell>
                  <Checkbox
                    checked={selectedIds.has(account.id)}
                    onCheckedChange={() => onToggleSelection(account.id)}
                  />
                </TableCell>
                <TableCell className="font-mono text-sm font-medium">
                  {account.username}
                  {account.adUsername && (
                    <span className="ml-2 text-xs text-gray-500" title="Linked AD account">
                      🔗
                    </span>
                  )}
                </TableCell>
                <TableCell className="max-w-[150px] truncate" title={account.name}>
                  {account.name}
                </TableCell>
                <TableCell>{getPortalBadge(account.portalType)}</TableCell>
                <TableCell>{getStatusBadge(account.status)}</TableCell>
                <TableCell>
                  {account.createdByFaculty ? (
                    <span className="text-green-600 font-semibold text-sm">✓ Yes</span>
                  ) : (
                    <span className="text-yellow-600 text-sm">⧗ Pending</span>
                  )}
                </TableCell>
                <TableCell className="text-sm text-gray-500">
                  {new Date(account.createdAt).toLocaleDateString()}
                </TableCell>
                <TableCell className="text-sm text-gray-500">
                  {account.expiresAt 
                    ? new Date(account.expiresAt).toLocaleDateString() 
                    : '-'
                  }
                </TableCell>
                <TableCell>
                  <Button
                    variant="link"
                    size="sm"
                    onClick={() => onViewAccount(account.id)}
                    className="p-0 h-auto"
                  >
                    View
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
