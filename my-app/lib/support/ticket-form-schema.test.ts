import { describe, expect, it } from 'vitest';
import {
  composeTicketDescription,
  getTicketFormFields,
  missingRequiredFieldKeys,
} from './ticket-form-schema';

describe('getTicketFormFields', () => {
  it('returns no extra prompts for a group join', () => {
    expect(getTicketFormFields({ category: 'ACCOUNT', accountIntent: 'join_group' })).toEqual([]);
  });

  it('returns account problem prompts for ACCOUNT', () => {
    const fields = getTicketFormFields({ category: 'ACCOUNT' });
    expect(fields.map((field) => field.key)).toEqual(['problemType', 'startedWhen']);
  });

  it('returns infrastructure prompts with a required affected system', () => {
    const fields = getTicketFormFields({ category: 'INFRASTRUCTURE' });
    expect(fields.find((field) => field.key === 'affectedSystem')?.required).toBe(true);
  });

  it('returns empty for unknown or missing topics', () => {
    expect(getTicketFormFields({ category: null })).toEqual([]);
    expect(getTicketFormFields({ category: 'NOPE' })).toEqual([]);
  });
});

describe('composeTicketDescription', () => {
  const fields = getTicketFormFields({ category: 'INFRASTRUCTURE' });

  it('renders select answers using their labels', () => {
    const composed = composeTicketDescription(
      fields,
      { affectedSystem: 'lab-01', impact: 'team' },
      'Switch port flapping.'
    );
    expect(composed).toBe(
      'Which system is affected: lab-01\nWho is affected: My team or group\n\nSwitch port flapping.'
    );
  });

  it('skips empty answers and keeps narrative passthrough', () => {
    const composed = composeTicketDescription(fields, { affectedSystem: 'lab-01' }, '');
    expect(composed).toBe('Which system is affected: lab-01');
    expect(composeTicketDescription(fields, {}, 'Just text.')).toBe('Just text.');
    expect(composeTicketDescription(fields, {}, '')).toBe('');
  });

  it('drops the trailing question mark from labels', () => {
    const composed = composeTicketDescription(
      getTicketFormFields({ category: 'ACCOUNT' }),
      { problemType: 'locked_out' },
      ''
    );
    expect(composed).toContain('What is happening: Locked out of my account');
  });
});

describe('missingRequiredFieldKeys', () => {
  it('flags required keys that are blank', () => {
    const fields = getTicketFormFields({ category: 'INFRASTRUCTURE' });
    expect(missingRequiredFieldKeys(fields, {})).toEqual([
      'affectedSystem',
      'impact',
    ]);
    expect(missingRequiredFieldKeys(fields, { affectedSystem: 'x', impact: 'team' })).toEqual([]);
  });
});
