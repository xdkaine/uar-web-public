import { describe, expect, it } from 'vitest';
import {
  getContextField,
  isAutomationTriggerKey,
  renderTemplate,
  validateAction,
  validateCondition,
  validateRuleDefinition,
} from './catalog';

describe('trigger keys', () => {
  it('recognizes catalog trigger keys and rejects unknown values', () => {
    expect(isAutomationTriggerKey('dc_unreachable')).toBe(true);
    expect(isAutomationTriggerKey('ticket_created')).toBe(true);
    expect(isAutomationTriggerKey('nope')).toBe(false);
    expect(isAutomationTriggerKey(42)).toBe(false);
  });
});

describe('validateCondition', () => {
  it('accepts context_field_equals', () => {
    const result = validateCondition({ key: 'context_field_equals', field: 'ticketCategory', value: 'SDC' });
    expect(result.ok).toBe(true);
  });

  it('rejects unknown keys and malformed fields', () => {
    expect(validateCondition({ key: 'wat' }).ok).toBe(false);
    expect(validateCondition({ key: 'context_field_exists', field: '' }).ok).toBe(false);
    expect(validateCondition(null).ok).toBe(false);
  });
});

describe('validateAction', () => {
  it('accepts a valid create_service_alert config', () => {
    const result = validateAction({
      key: 'create_service_alert',
      config: {
        dedupeKey: 'dc-primary',
        category: 'directory',
        severity: 'critical',
        title: 'DC offline',
        message: 'Primary DC unreachable',
      },
    });
    expect(result.ok).toBe(true);
  });

  it('rejects invalid severity and category', () => {
    const bad = validateAction({
      key: 'create_service_alert',
      config: { dedupeKey: 'k', category: 'nonsense', title: 't', message: 'm' },
    });
    expect(bad.ok).toBe(false);
  });

  it('enforces email recipient bounds and format', () => {
    expect(
      validateAction({ key: 'send_email', config: { to: [], subject: 's', body: 'b' } }).ok
    ).toBe(false);
    expect(
      validateAction({
        key: 'send_email',
        config: { to: ['not-an-email'], subject: 's', body: 'b' },
      }).ok
    ).toBe(false);
    expect(
      validateAction({
        key: 'send_email',
        config: { to: ['a@b.co'], subject: 's', body: 'b' },
      }).ok
    ).toBe(true);
  });

  it('rejects config fields on zero-config actions', () => {
    expect(
      validateAction({ key: 'close_ticket', config: { surprise: true } }).ok
    ).toBe(false);
    expect(validateAction({ key: 'close_ticket' }).ok).toBe(true);
  });

  it('rejects unknown action keys', () => {
    expect(validateAction({ key: 'format_disk' }).ok).toBe(false);
  });
});

describe('validateRuleDefinition', () => {
  it('requires at least one action', () => {
    expect(validateRuleDefinition({ conditions: [], actions: [] }).ok).toBe(false);
  });

  it('accepts conditions plus actions', () => {
    const result = validateRuleDefinition({
      conditions: [{ key: 'context_field_exists', field: 'ticketId' }],
      actions: [{ key: 'close_ticket' }],
    });
    expect(result.ok).toBe(true);
  });
});

describe('template rendering', () => {
  const context = { ticketId: 't1', nested: { value: 'x' }, flag: null };

  it('substitutes present fields', () => {
    expect(renderTemplate('Ticket {{ticketId}}/{{nested.value}}', context)).toBe('Ticket t1/x');
  });

  it('throws on missing fields so actions fail loudly', () => {
    expect(() => renderTemplate('{{missing}}', context)).toThrow();
  });

  it('reads dotted paths', () => {
    expect(getContextField(context, 'nested.value')).toBe('x');
    expect(getContextField(context, 'absent.deep')).toBeUndefined();
  });
});
