import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  permission: vi.fn(),
  getMessageTemplate: vi.fn(),
}));

vi.mock('@/lib/adminAuth', () => ({ checkAdminAuthWithRateLimit: mocks.auth }));
vi.mock('@/lib/rbac/core', () => ({ actorHasPermission: mocks.permission }));
vi.mock('@/lib/messages/core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/messages/core')>();
  return { ...actual, getMessageTemplate: mocks.getMessageTemplate };
});

import { POST } from './route';
import { MESSAGE_TEMPLATE_CATALOG } from '@/lib/messages/catalog';

beforeEach(() => {
  vi.clearAllMocks();
  mocks.auth.mockResolvedValue({ admin: { username: 'admin1' }, response: null });
  mocks.permission.mockReturnValue(true);
  const definition = MESSAGE_TEMPLATE_CATALOG['request.rejection_notice'];
  mocks.getMessageTemplate.mockResolvedValue({
    ...definition,
    subject: definition.defaultSubject,
    body: '<p class="lead">Hello {{name}}</p>',
    css: '.lead { color: #123456; }',
  });
});

describe('POST /api/admin/config/messages/preview', () => {
  it('uses the published CSS when the caller requests the saved preview', async () => {
    const request = new NextRequest('http://localhost/api/admin/config/messages/preview', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ key: 'request.rejection_notice' }),
    });

    const response = await POST(request);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.html).toContain('Hello Alex Rivera');
    expect(body.html).toMatch(/color:\s*#123456/i);
  });
});
