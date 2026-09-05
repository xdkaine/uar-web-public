import { describe, expect, it } from 'vitest';

import {
  canAccessAdminRoute,
  getVisibleAdminConfigurationSections,
  getVisibleAdminNavDestinations,
  getVisibleAdminNavSections,
  isAdminNavItemModuleDisabled,
} from './navigation';
import { ALL_PERMISSION_KEYS } from '@/lib/rbac/permissions';

describe('admin navigation projection', () => {
  it('only includes items granted by the resolved permission set', () => {
    const sections = getVisibleAdminNavSections(new Set(['access_requests.read', 'tickets.read']));

    expect(sections.map((section) => section.id)).toEqual(['operations']);
    expect(sections[0].items.map((item) => item.id)).toEqual(['requests', 'support']);
  });

  it('retains permitted module entries and marks disabled modules for every consumer', () => {
    const disabledModules = new Set(['vpn.management']);
    const sections = getVisibleAdminNavSections(new Set(['vpn.manage']));
    const vpn = sections.flatMap((section) => section.items).find((item) => item.id === 'vpn');

    expect(vpn).toBeDefined();
    expect(isAdminNavItemModuleDisabled(vpn!, disabledModules)).toBe(true);
  });

  it('makes System Configuration discoverable for a single configuration capability', () => {
    const sections = getVisibleAdminNavSections(new Set(['messages.manage']));
    expect(sections.flatMap((section) => section.items).map((item) => item.id)).toEqual(['settings']);
    expect(getVisibleAdminConfigurationSections(new Set(['messages.manage'])).map((section) => section.id)).toEqual(['messages']);
  });

  it('authorizes configuration and direct routes from the same surface manifest', () => {
    expect(canAccessAdminRoute('/admin/settings', new Set(['directory.configure']))).toBe(true);
    expect(canAccessAdminRoute('/admin/settings', new Set(['messages.manage']))).toBe(true);
    expect(canAccessAdminRoute('/admin/users', new Set(['messages.manage']))).toBe(false);
    expect(canAccessAdminRoute('/admin/users', new Set(['users.read']))).toBe(true);
    expect(canAccessAdminRoute('/admin/batch-accounts/example', new Set(['batch.manage']))).toBe(true);
    expect(canAccessAdminRoute('/admin/unknown', new Set(['settings.manage']))).toBe(false);
    expect(canAccessAdminRoute('/admin/settings', new Set(ALL_PERMISSION_KEYS))).toBe(true);
  });

  it('indexes detailed destinations without leaking configuration sections', () => {
    const destinations = getVisibleAdminNavDestinations(new Set(['messages.manage']));

    expect(destinations.map((destination) => destination.id)).toEqual(['settings.messages']);
    expect(destinations[0]).toMatchObject({
      href: '/admin/settings?section=messages',
      keywords: expect.arrayContaining(['email', 'template']),
    });
  });

  it('requires every destination permission for cross-capability sections', () => {
    const lifecycleOnly = getVisibleAdminNavDestinations(new Set(['lifecycle.read']));
    expect(lifecycleOnly.map((destination) => destination.id)).toEqual([
      'lifecycle.accounts',
      'lifecycle.operations',
    ]);

    const withUsers = getVisibleAdminNavDestinations(new Set(['lifecycle.read', 'users.read']));
    expect(withUsers.map((destination) => destination.id)).toContain('lifecycle.groups');
  });

  it('omits detailed destinations for disabled capability modules', () => {
    const destinations = getVisibleAdminNavDestinations(
      new Set(['communications.manage']),
      new Set(['communications'])
    );

    expect(destinations).toEqual([]);
  });
});
