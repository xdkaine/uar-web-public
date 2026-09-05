import {
  ALL_PERMISSION_KEYS,
  SYSTEM_ADMINISTRATOR_ROLE_KEY,
  type PermissionKey,
} from './permissions';

export interface RoleCatalogEntry {
  key: string;
  name: string;
  description: string;
  permissions: PermissionKey[];
  isSystem: boolean;
}

/**
 * Code-defined role catalog (ADR-0003 compatibility). Every role an operator
 * can map appears here even before any RoleDefinition row exists, so the
 * Roles & Access panel is never empty on a fresh deployment. Saving a mapping
 * or permission set persists a row; rows always win over catalog defaults.
 */
export const ROLE_CATALOG: RoleCatalogEntry[] = [
  {
    key: SYSTEM_ADMINISTRATOR_ROLE_KEY,
    name: 'System Administrator',
    description:
      'Full portal administration. Granted automatically to members of the configured admin groups and to break-glass accounts.',
    permissions: [...ALL_PERMISSION_KEYS],
    isSystem: true,
  },
  {
    key: 'director',
    name: 'Director',
    description: 'Acts on access requests at the director review stage.',
    permissions: ['access_requests.read', 'access_requests.review.director'],
    isSystem: false,
  },
  {
    key: 'faculty',
    name: 'Faculty',
    description: 'Acts on access requests at the faculty review stage.',
    permissions: ['access_requests.read', 'access_requests.review.faculty'],
    isSystem: false,
  },
];

export function findRoleCatalogEntry(key: string): RoleCatalogEntry | null {
  return ROLE_CATALOG.find((entry) => entry.key === key) ?? null;
}
