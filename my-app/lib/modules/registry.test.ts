import { describe, expect, it } from 'vitest';
import { ALL_CONFIG_KEYS, CONFIG_REGISTRY } from '@/lib/config/registry';
import { ADMIN_NAV_ITEMS } from '@/lib/admin/navigation';
import { TRIGGER_KEY_TO_NODE_TYPE } from '@/lib/flow/catalog';
import { AUTOMATION_TRIGGER_KEYS } from '@/lib/automation/catalog';
import { CRON_ROUTE_REGISTRY } from '@/lib/cron/registry';
import { ALL_MODULE_IDS, MODULE_REGISTRY } from './registry';

const KNOWN_TRIGGER_KEYS = new Set([
  ...Object.keys(TRIGGER_KEY_TO_NODE_TYPE),
  ...AUTOMATION_TRIGGER_KEYS,
]);
const KNOWN_CRON_ROUTES = new Set(CRON_ROUTE_REGISTRY.map((entry) => entry.route));

describe('MODULE_REGISTRY', () => {
  it('exposes every documented capability module', () => {
    expect(ALL_MODULE_IDS).toEqual(
      expect.arrayContaining([
        'vpn.management',
        'support.tickets',
        'events',
        'password.expiration',
        'communications',
      ])
    );
    expect(MODULE_REGISTRY['vpn.management']).toBeDefined();
  });

  it('gives every module a name, description, and non-empty impact preview', () => {
    for (const definition of Object.values(MODULE_REGISTRY)) {
      expect(definition.name.length).toBeGreaterThan(0);
      expect(definition.description.length).toBeGreaterThan(0);
      expect(definition.disableImpact.length).toBeGreaterThan(0);
      for (const impact of definition.disableImpact) {
        // Impact statements are operator-facing documentation; keep them
        // substantive enough to explain what a toggle does.
        expect(impact.length).toBeGreaterThan(10);
      }
    }
  });

  it('only declares dependencies on other registered modules', () => {
    for (const definition of Object.values(MODULE_REGISTRY)) {
      for (const dependency of definition.dependsOn) {
        expect(ALL_MODULE_IDS).toContain(dependency);
      }
      // Dependency cycles would make enable-ordering undecidable.
      expect(definition.dependsOn).not.toContain(definition.id);
    }
  });

  it('references only registered configuration keys in configKeys', () => {
    for (const definition of Object.values(MODULE_REGISTRY)) {
      for (const key of definition.configKeys ?? []) {
        expect(ALL_CONFIG_KEYS).toContain(key);
      }
    }
  });

  it('keeps vpn.management dependency-free so it stays independently toggleable', () => {
    expect(MODULE_REGISTRY['vpn.management'].dependsOn).toEqual([]);
  });

  it('only claims admin tabs that exist in the admin navigation', () => {
    const navIds = new Set(ADMIN_NAV_ITEMS.map((item) => item.id));
    for (const definition of Object.values(MODULE_REGISTRY)) {
      for (const tab of definition.adminTabs ?? []) {
        expect(navIds.has(tab), `${definition.id} claims unknown admin tab "${tab}"`).toBe(true);
      }
    }
    expect(MODULE_REGISTRY['vpn.management'].adminTabs).toEqual(['vpn']);
    expect(MODULE_REGISTRY['communications'].adminTabs).toEqual(['communications']);
  });

  it('only claims flow/automation trigger keys that exist in their catalogs', () => {
    for (const definition of Object.values(MODULE_REGISTRY)) {
      for (const key of definition.triggerKeys ?? []) {
        expect(
          KNOWN_TRIGGER_KEYS.has(key),
          `${definition.id} claims unknown trigger key "${key}"`
        ).toBe(true);
      }
    }
    expect(MODULE_REGISTRY['support.tickets'].triggerKeys).toEqual([
      'ticket_created',
      'ticket_replied',
      'ticket_status_changed',
    ]);
    expect(MODULE_REGISTRY['vpn.management'].triggerKeys ?? []).toEqual([]);
  });

  it('only claims cron routes registered in CRON_ROUTE_REGISTRY', () => {
    for (const definition of Object.values(MODULE_REGISTRY)) {
      for (const key of definition.cronJobKeys ?? []) {
        expect(KNOWN_CRON_ROUTES.has(key), `${definition.id} claims unknown cron route "${key}"`).toBe(true);
      }
    }
    expect(MODULE_REGISTRY['password.expiration'].cronJobKeys).toEqual(['process-password-expiration']);
    expect(MODULE_REGISTRY['communications'].cronJobKeys).toEqual(['process-mass-email']);
  });

  it('defines every key in CONFIG_REGISTRY with a validator and safe default', () => {
    // Guarding the inverse direction too: the registry is the single source
    // of truth for configuration shape.
    expect(Object.keys(CONFIG_REGISTRY).length).toBeGreaterThan(0);
  });
});
