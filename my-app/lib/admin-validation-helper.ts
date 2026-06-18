import {
  INPUT_LIMITS,
  sanitizeString,
  validateEmail,
  validateStringLength,
  validateUsername,
} from '@/lib/validation';

type FieldType = 'string' | 'email' | 'username' | 'boolean';

export type AdminValidationRule = {
  type: FieldType;
  label?: string;
  required?: boolean;
  minLength?: number;
  maxLength?: number;
  trim?: boolean;
  sanitize?: boolean;
};

export type AdminValidationSchema = Record<string, AdminValidationRule>;

export type AdminValidationResult<T extends Record<string, unknown>> =
  | { valid: true; data: T; errors: [] }
  | { valid: false; data: Partial<T>; errors: string[] };

const DEFAULT_MAX_LENGTH: Record<FieldType, number | undefined> = {
  string: INPUT_LIMITS.DESCRIPTION,
  email: INPUT_LIMITS.EMAIL,
  username: INPUT_LIMITS.USERNAME,
  boolean: undefined,
};

function isMissing(value: unknown): boolean {
  return value === undefined || value === null || value === '';
}

function fieldLabel(fieldName: string, rule: AdminValidationRule): string {
  return rule.label || fieldName;
}

function normalizeString(value: string, rule: AdminValidationRule): string {
  const shouldTrim = rule.trim !== false;
  const shouldSanitize = rule.sanitize !== false;
  const normalized = shouldTrim ? value.trim() : value;

  return shouldSanitize ? sanitizeString(normalized) : normalized;
}

export function validateAdminInput<T extends Record<string, unknown> = Record<string, unknown>>(
  input: Record<string, unknown>,
  schema: AdminValidationSchema
): AdminValidationResult<T> {
  const errors: string[] = [];
  const data: Record<string, unknown> = {};

  for (const [fieldName, rule] of Object.entries(schema)) {
    const label = fieldLabel(fieldName, rule);
    const value = input[fieldName];

    if (isMissing(value)) {
      if (rule.required) {
        errors.push(`${label} is required`);
      }
      continue;
    }

    if (rule.type === 'boolean') {
      if (typeof value !== 'boolean') {
        errors.push(`${label} must be a boolean`);
        continue;
      }

      data[fieldName] = value;
      continue;
    }

    if (typeof value !== 'string') {
      errors.push(`${label} must be a string`);
      continue;
    }

    const normalized = normalizeString(value, rule);
    if (rule.required && normalized === '') {
      errors.push(`${label} is required`);
      continue;
    }

    const maxLength = rule.maxLength ?? DEFAULT_MAX_LENGTH[rule.type];

    if (maxLength !== undefined) {
      const lengthResult = validateStringLength(normalized, label, maxLength, rule.minLength);
      if (!lengthResult.valid && lengthResult.error) {
        errors.push(lengthResult.error);
        continue;
      }
    }

    if (rule.type === 'email' && !validateEmail(normalized)) {
      errors.push(`${label} must be a valid email address`);
      continue;
    }

    if (rule.type === 'username' && !validateUsername(normalized)) {
      errors.push(`${label} must be a valid username`);
      continue;
    }

    data[fieldName] = normalized;
  }

  if (errors.length > 0) {
    return { valid: false, data: data as Partial<T>, errors };
  }

  return { valid: true, data: data as T, errors: [] };
}