import { describe, expect, it } from 'vitest';
import { validateAdminInput } from './admin-validation-helper';

describe('validateAdminInput', () => {
  it('returns sanitized typed data when all fields are valid', () => {
    const result = validateAdminInput(
      {
        email: ' Fixture.User@Example.test ',
        username: ' user.name ',
        enabled: true,
        notes: ' hello\0 ',
      },
      {
        email: { type: 'email', label: 'Email', required: true },
        username: { type: 'username', label: 'Username', required: true },
        enabled: { type: 'boolean', label: 'Enabled', required: true },
        notes: { type: 'string', label: 'Notes', maxLength: 20 },
      }
    );

    expect(result).toEqual({
      valid: true,
      errors: [],
      data: {
        email: 'Fixture.User@Example.test',
        username: 'user.name',
        enabled: true,
        notes: 'hello',
      },
    });
  });

  it('collects all validation errors', () => {
    const result = validateAdminInput(
      {
        email: 'not-email',
        username: 'no spaces',
        enabled: 'yes',
        notes: 'abcdef',
      },
      {
        email: { type: 'email', label: 'Email', required: true },
        username: { type: 'username', label: 'Username', required: true },
        enabled: { type: 'boolean', label: 'Enabled', required: true },
        notes: { type: 'string', label: 'Notes', maxLength: 5 },
        reason: { type: 'string', label: 'Reason', required: true },
      }
    );

    expect(result.valid).toBe(false);
    expect(result.errors).toEqual([
      'Email must be a valid email address',
      'Username must be a valid username',
      'Enabled must be a boolean',
      'Notes must not exceed 5 characters',
      'Reason is required',
    ]);
  });

  it('treats required whitespace-only strings as missing after normalization', () => {
    const result = validateAdminInput(
      { reason: '   ' },
      { reason: { type: 'string', label: 'Reason', required: true } }
    );

    expect(result).toMatchObject({
      valid: false,
      errors: ['Reason is required'],
    });
  });
});