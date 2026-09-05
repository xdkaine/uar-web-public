import { describe, expect, it } from 'vitest';
import type http from 'node:http';
import { clientIp } from './httputil';

function reqWith(
  headers: Record<string, string>,
  remoteAddress = '203.0.113.10'
): http.IncomingMessage {
  return {
    headers,
    socket: { remoteAddress },
  } as unknown as http.IncomingMessage;
}

describe('clientIp proxy-header gating (AUTH_TRUST_PROXY_HEADERS)', () => {
  it('ignores forwarded headers entirely when trust is OFF (default)', () => {
    const req = reqWith({
      'x-forwarded-for': '198.51.100.7, 198.51.100.8',
      'x-real-ip': '198.51.100.9',
    });
    expect(clientIp(req)).toBe('203.0.113.10');
    expect(clientIp(req, { trustForwardedHeaders: false })).toBe('203.0.113.10');
  });

  it('falls back to the socket address when no headers exist and trust is ON', () => {
    expect(clientIp(reqWith({}), { trustForwardedHeaders: true })).toBe('203.0.113.10');
  });

  it('takes the RIGHTMOST X-Forwarded-For hop when trust is ON', () => {
    const req = reqWith({ 'x-forwarded-for': '198.51.100.7, 198.51.100.8' });
    expect(clientIp(req, { trustForwardedHeaders: true })).toBe('198.51.100.8');
  });

  it('prefers the rightmost hop over X-Real-IP when trust is ON', () => {
    const req = reqWith({
      'x-forwarded-for': '198.51.100.7',
      'x-real-ip': '198.51.100.9',
    });
    expect(clientIp(req, { trustForwardedHeaders: true })).toBe('198.51.100.7');
  });

  it('uses X-Real-IP when only it is present and trust is ON', () => {
    const req = reqWith({ 'x-real-ip': '198.51.100.9' });
    expect(clientIp(req, { trustForwardedHeaders: true })).toBe('198.51.100.9');
  });

  it('reports unknown rather than throwing without an address', () => {
    const req = { headers: {}, socket: {} } as unknown as http.IncomingMessage;
    expect(clientIp(req)).toBe('unknown');
  });
});
