import { describe, expect, it } from 'vitest';
import { isSeededWorkflowExample, validateWorkflowEmailRecipients, validateWorkflowPublication } from './publication-guard';

describe('workflow publication guard', () => {
  const trigger = { id: 'trigger', type: 'trigger_dc_unreachable', config: {} };

  it('recognizes only the stable seeded example graph IDs', () => {
    expect(isSeededWorkflowExample('flowseed_outage02')).toBe(true);
    expect(isSeededWorkflowExample('flowseed_outage02-copy')).toBe(false);
  });

  it('rejects reserved recipients, recipient tokens, and malformed recipient syntax', () => {
    expect(validateWorkflowPublication([
      trigger,
      { id: 'email', type: 'action_send_email', config: { to: 'ops@example.org, {{target}}, not-an-email', subject: 'Example text is fine', body: 'Example explanation is fine' } },
    ])).toEqual(expect.arrayContaining([
      expect.stringContaining('reserved/example destination "example.org"'),
      expect.stringContaining('runtime tokens are not valid recipients'),
      expect.stringContaining('invalid recipient address "not-an-email"'),
    ]));
  });

  it('allows known runtime tokens in URLs and leaves descriptions out of destination scanning', () => {
    expect(validateWorkflowPublication([
      trigger,
      { id: 'email', type: 'action_send_email', config: { to: 'ops@cpp.edu', subject: 'Directory outage', body: 'Use ops@example.org only as a written example.' } },
      { id: 'url', type: 'future_action', config: { endpoint: 'https://portal.sdc.cpp/operations/{{target}}' } },
    ])).toEqual([]);
  });

  it('rejects reserved URL hosts in executable configuration', () => {
    expect(validateWorkflowPublication([
      trigger,
      { id: 'custom', type: 'future_action', config: { url: 'https://service.invalid/notify' } },
    ])).toEqual([expect.stringContaining('reserved/example destination "service.invalid"')]);
  });

  it('rejects reserved nested monitor hosts', () => {
    expect(validateWorkflowPublication([
      {
        id: 'monitor',
        type: 'source_monitor_endpoints',
        config: { checks: [{ name: 'Example service', kind: 'tcp', host: 'service.example.edu', port: 443 }] },
      },
    ])).toEqual([expect.stringContaining('checks[0].host uses the reserved/example destination "service.example.edu"')]);
  });

  it('applies the reserved-domain guard to resolved recipients at execution time', () => {
    expect(validateWorkflowEmailRecipients('ops@example.net')).toEqual([
      expect.stringContaining('reserved/example destination "example.net"'),
    ]);
    expect(validateWorkflowEmailRecipients('noc@cpp.edu')).toEqual([]);
  });
});
