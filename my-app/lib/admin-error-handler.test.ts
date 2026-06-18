import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  logAuditAction: vi.fn(),
}));

vi.mock('@/lib/audit-log', () => ({
  AuditActions: { ADMIN_API_REQUEST: 'admin_api_request' },
  AuditCategories: { NAVIGATION: 'navigation' },
  getIpAddress: vi.fn(() => '127.0.0.1'),
  getUserAgent: vi.fn(() => 'vitest'),
  logAuditAction: mocks.logAuditAction,
  sanitizeDatabaseText: (value: string, maxLength = 5000) =>
    value
      .replace(/\0/g, '')
      .replace(/[\x00-\x08\x0B-\x0C\x0E-\x1F\x7F]/g, '')
      .substring(0, maxLength),
}));

import {
  AdminRouteError,
  getAdminClientErrorMessage,
  getAdminErrorStatus,
  handleAdminRouteError,
} from './admin-error-handler';
import { JsonBodyError } from './validation';

beforeEach(() => {
  mocks.logAuditAction.mockReset();
});

describe('admin error helpers', () => {
  it('preserves JsonBodyError statuses and messages', () => {
    const error = new JsonBodyError('Invalid JSON in request body', 400);

    expect(getAdminErrorStatus(error)).toBe(400);
    expect(getAdminClientErrorMessage(error)).toBe('Invalid JSON in request body');
  });

  it('preserves AdminRouteError statuses and client messages', () => {
    const error = new AdminRouteError('internal detail', 409, 'Conflict happened');

    expect(getAdminErrorStatus(error)).toBe(409);
    expect(getAdminClientErrorMessage(error)).toBe('Conflict happened');
  });

  it('hides generic server errors behind the standard client message', () => {
    expect(getAdminErrorStatus(new Error('database exploded'))).toBe(500);
    expect(getAdminClientErrorMessage(new Error('database exploded'))).toBe(
      'An internal error occurred. Please try again later.'
    );
  });
});

describe('handleAdminRouteError', () => {
  it('returns a NextResponse and records an audit failure when context has a username', async () => {
    const response = await handleAdminRouteError(new AdminRouteError('Denied', 403), {
      route: 'test-route',
      action: 'test_action',
      category: 'test_category',
      username: 'admin1',
      request: new Request('https://example.test/api/admin/test', {
        headers: { 'user-agent': 'vitest' },
      }),
      details: { field: 'value' },
    });

    await expect(response.json()).resolves.toEqual({ error: 'Denied' });
    expect(response.status).toBe(403);
    expect(mocks.logAuditAction).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'test_action',
        category: 'test_category',
        username: 'admin1',
        outcome: 'failure',
        success: false,
        errorMessage: 'Denied',
      })
    );
  });

  it('does not let audit logging failures replace the client response', async () => {
    mocks.logAuditAction.mockRejectedValueOnce(new Error('audit unavailable'));
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const response = await handleAdminRouteError(new Error('database exploded'), {
      route: 'test-route',
      username: 'admin1',
    });

    await expect(response.json()).resolves.toEqual({
      error: 'An internal error occurred. Please try again later.',
    });
    expect(response.status).toBe(500);
    expect(errorSpy).toHaveBeenCalled();
    errorSpy.mockRestore();
  });

  it('uses the existing navigation category when no audit category is provided', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    await handleAdminRouteError(new AdminRouteError('Nope', 400), {
      route: 'test-route',
      username: 'admin1',
    });

    expect(mocks.logAuditAction).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'admin_api_request',
        category: 'navigation',
      })
    );
    errorSpy.mockRestore();
  });
});