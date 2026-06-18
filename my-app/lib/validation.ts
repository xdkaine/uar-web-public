import { NextRequest } from 'next/server';

/**
 * Maximum allowed size for request bodies (in bytes)
 */
export const MAX_REQUEST_BODY_SIZE = {
  DEFAULT: 1024 * 1024,
  SMALL: 10 * 1024,
  MEDIUM: 100 * 1024,
  LARGE: 10 * 1024 * 1024,
} as const;

/**
 * Maximum allowed lengths for string fields
 */
export const INPUT_LIMITS = {
  NAME: 200,
  EMAIL: 255,
  USERNAME: 64,
  PASSWORD: 128,
  INSTITUTION: 500,
  EVENT_REASON: 2000,
  COMMENT: 5000,
  DESCRIPTION: 10000,
  SUBJECT: 500,
  MESSAGE: 10000,
} as const;

export const INTERNAL_EMAIL_DOMAIN = '@cpp.edu';

export class JsonBodyError extends Error {
  statusCode: 400 | 413;

  constructor(message: string, statusCode: 400 | 413) {
    super(message);
    this.name = 'JsonBodyError';
    this.statusCode = statusCode;
  }
}

export function isJsonBodyError(error: unknown): error is JsonBodyError {
  return error instanceof JsonBodyError;
}

/**
 * Parse JSON request body with size limit enforcement
 * Prevents DoS attacks via extremely large payloads
 * 
 * @param request - Next.js request object
 * @param maxSizeBytes - Maximum allowed payload size in bytes
 * @returns Parsed JSON object
 * @throws Error if payload exceeds size limit
 */
export async function parseJsonWithLimit<T = unknown>(
  request: NextRequest,
  maxSizeBytes: number = MAX_REQUEST_BODY_SIZE.DEFAULT
): Promise<T> {
  const contentLength = request.headers.get('content-length');
  if (contentLength) {
    const size = parseInt(contentLength, 10);
    if (size > maxSizeBytes) {
      throw new JsonBodyError(`Request body too large: ${size} bytes (max: ${maxSizeBytes} bytes)`, 413);
    }
  }

  try {
    const body = await request.json();
    
    const bodyString = JSON.stringify(body);
    const actualSize = Buffer.byteLength(bodyString, 'utf8');
    
    if (actualSize > maxSizeBytes) {
      throw new JsonBodyError(`Request body too large: ${actualSize} bytes (max: ${maxSizeBytes} bytes)`, 413);
    }
    
    return body as T;
  } catch (error) {
    if (error instanceof JsonBodyError) {
      throw error;
    }

    if (error instanceof SyntaxError) {
      throw new JsonBodyError('Invalid JSON in request body', 400);
    }

    throw error;
  }
}

/**
 * Validate string length
 * 
 * @param value - String to validate
 * @param fieldName - Name of the field (for error messages)
 * @param maxLength - Maximum allowed length
 * @param minLength - Minimum required length (optional)
 * @returns Validation result
 */
export function validateStringLength(
  value: string | null | undefined,
  fieldName: string,
  maxLength: number,
  minLength?: number
): { valid: boolean; error?: string } {
  if (value === null || value === undefined) {
    return { valid: true };
  }

  if (typeof value !== 'string') {
    return { valid: false, error: `${fieldName} must be a string` };
  }

  if (minLength !== undefined && value.length < minLength) {
    return { 
      valid: false, 
      error: `${fieldName} must be at least ${minLength} characters` 
    };
  }

  if (value.length > maxLength) {
    return { 
      valid: false, 
      error: `${fieldName} must not exceed ${maxLength} characters` 
    };
  }

  return { valid: true };
}

/**
 * Validate multiple string fields at once
 * 
 * @param fields - Object with field names and values to validate
 * @param limits - Object with field names and max length limits
 * @returns Array of validation errors (empty if all valid)
 */
export function validateStringFields(
  fields: Record<string, string | null | undefined>,
  limits: Record<string, number>
): string[] {
  const errors: string[] = [];

  for (const [fieldName, value] of Object.entries(fields)) {
    const maxLength = limits[fieldName];
    if (maxLength !== undefined) {
      const result = validateStringLength(value, fieldName, maxLength);
      if (!result.valid && result.error) {
        errors.push(result.error);
      }
    }
  }

  return errors;
}

/**
 * Validate email format
 * 
 * @param email - Email address to validate
 * @returns True if valid email format
 */
export function validateEmail(email: string): boolean {
  if (!email || typeof email !== 'string') {
    return false;
  }

  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email) && email.length <= INPUT_LIMITS.EMAIL;
}

/**
 * Validate username format (alphanumeric, dots, underscores, hyphens)
 * 
 * @param username - Username to validate
 * @returns True if valid username format
 */
export function validateUsername(username: string): boolean {
  if (!username || typeof username !== 'string') {
    return false;
  }

  const usernameRegex = /^[a-zA-Z0-9._-]{3,64}$/;
  return usernameRegex.test(username);
}

/**
 * Sanitize string by removing potentially dangerous characters
 * Use for fields that will be displayed but not executed
 * 
 * @param value - String to sanitize
 * @param maxLength - Maximum length after sanitization
 * @returns Sanitized string
 */
export function sanitizeString(value: string, maxLength?: number): string {
  if (!value || typeof value !== 'string') {
    return '';
  }

  let sanitized = value.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');
  
  sanitized = sanitized.trim();
  
  if (maxLength && sanitized.length > maxLength) {
    sanitized = sanitized.substring(0, maxLength);
  }
  
  return sanitized;
}

/**
 * Validate required fields are present and non-empty
 * 
 * @param data - Object containing fields to validate
 * @param requiredFields - Array of field names that are required
 * @returns Array of missing field names (empty if all present)
 */
export function validateRequiredFields(
  data: Record<string, unknown>,
  requiredFields: string[]
): string[] {
  const missing: string[] = [];

  for (const field of requiredFields) {
    const value = data[field];
    if (value === undefined || value === null || value === '') {
      missing.push(field);
    }
  }

  return missing;
}

/**
 * Extract bronconame (username) from @cpp.edu email address
 * Used for internal CPP student accounts where the username should match the email prefix
 * 
 * @param email - Email address ending in @cpp.edu
 * @returns Username portion before @cpp.edu (lowercase), or null if invalid
 * @example
 * extractBronconame('billy@cpp.edu') // returns 'billy'
 * extractBronconame('John.Doe@cpp.edu') // returns 'john.doe'
 * extractBronconame('invalid@gmail.com') // returns null
 */
export function extractBronconame(email: string): string | null {
  if (!email || typeof email !== 'string') {
    return null;
  }

  // Must be a @cpp.edu email
  if (!email.toLowerCase().endsWith(INTERNAL_EMAIL_DOMAIN)) {
    return null;
  }

  const parts = email.split('@');
  if (parts.length !== 2 || !parts[0] || parts[0].trim() === '') {
    return null;
  }

  // Return lowercase username for consistency
  return parts[0].toLowerCase().trim();
}
