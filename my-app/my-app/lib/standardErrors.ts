import { NextResponse } from 'next/server';

/**
 * Standard error messages that don't leak sensitive information
 */
export const StandardErrors = {
  // Authentication & Authorization
  AUTHENTICATION_FAILED: 'Authentication failed. Please check your credentials and try again.',
  UNAUTHORIZED: 'You are not authorized to access this resource.',
  SESSION_EXPIRED: 'Your session has expired. Please log in again.',
  INVALID_CREDENTIALS: 'Invalid credentials provided.',

  // Rate Limiting
  RATE_LIMIT_EXCEEDED: 'Too many requests. Please try again later.',

  // Validation
  INVALID_INPUT: 'Invalid input provided. Please check your request and try again.',
  MISSING_REQUIRED_FIELD: 'Required field is missing.',
  VALIDATION_FAILED: 'Request validation failed.',

  // CSRF & Security
  CSRF_VALIDATION_FAILED: 'Security validation failed. Please refresh the page and try again.',
  INVALID_TOKEN: 'Invalid or expired token.',

  // General
  INTERNAL_ERROR: 'An internal error occurred. Please try again later.',
  SERVICE_UNAVAILABLE: 'This service is temporarily unavailable. Please try again later.',
  NOT_FOUND: 'The requested resource was not found.',
  FORBIDDEN: 'Access to this resource is forbidden.',

  // Form-specific
  TURNSTILE_VALIDATION_FAILED: 'Bot protection validation failed. Please try again.',
} as const;

/**
 * Log detailed error information server-side while returning safe message to client
 */
export function logAndReturnError(
  error: unknown,
  context: string,
  safeMessage: string,
  statusCode: number = 500
): NextResponse {
  // Log detailed error information server-side
  if (error instanceof Error) {
    console.error(`[${context}] Error:`, {
      message: error.message,
      stack: process.env.NODE_ENV !== 'production' ? error.stack : undefined,
      timestamp: new Date().toISOString(),
    });
  } else {
    console.error(`[${context}] Unknown error:`, error);
  }

  // Return safe, generic message to client
  return NextResponse.json(
    { error: safeMessage },
    { status: statusCode }
  );
}

/**
 * Create a standardized authentication error response
 */
export function authenticationError(
  actualError: unknown,
  context: string = 'Authentication'
): NextResponse {
  return logAndReturnError(
    actualError,
    context,
    StandardErrors.AUTHENTICATION_FAILED,
    401
  );
}

/**
 * Create a standardized authorization error response
 */
export function authorizationError(
  actualError: unknown,
  context: string = 'Authorization'
): NextResponse {
  return logAndReturnError(
    actualError,
    context,
    StandardErrors.UNAUTHORIZED,
    403
  );
}

/**
 * Create a standardized validation error response
 */
export function validationError(
  actualError: unknown,
  context: string = 'Validation'
): NextResponse {
  return logAndReturnError(
    actualError,
    context,
    StandardErrors.VALIDATION_FAILED,
    400
  );
}

/**
 * Create a standardized internal error response
 */
export function internalError(
  actualError: unknown,
  context: string = 'Internal'
): NextResponse {
  return logAndReturnError(
    actualError,
    context,
    StandardErrors.INTERNAL_ERROR,
    500
  );
}

/**
 * Create a standardized rate limit error response
 */
export function rateLimitError(retryAfter?: number): NextResponse {
  const response = NextResponse.json(
    {
      error: StandardErrors.RATE_LIMIT_EXCEEDED,
      retryAfter: retryAfter || undefined,
    },
    { status: 429 }
  );

  if (retryAfter) {
    response.headers.set('Retry-After', retryAfter.toString());
  }

  return response;
}
