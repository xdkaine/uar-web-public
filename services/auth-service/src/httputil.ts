import http from 'node:http';

/**
 * Shared HTTP helpers. Kept dependency-free so every entry point (interaction
 * pages, internal admin API) reasons about clients identically.
 */

/**
 * Client IP resolution has two modes (AUTH_TRUST_PROXY_HEADERS):
 *  - OFF (default): X-Forwarded-For/X-Real-IP are IGNORED entirely and the
 *    socket address is used. Directly exposed deployments must never trust
 *    spoofable headers for rate limiting or audit.
 *  - ON: behind the trusted reverse proxy (docs/deploy/nginx-auth.example.conf)
 *    the proxy OVERWRITES X-Forwarded-For, so the RIGHTMOST entry is the hop
 *    we added. Taking the first entry would let clients rotate spoofed IPs
 *    through the header and defeat the login limiter.
 */
export function clientIp(
  req: http.IncomingMessage,
  options: { trustForwardedHeaders?: boolean } = {}
): string {
  if (!options.trustForwardedHeaders) {
    return req.socket.remoteAddress ?? 'unknown';
  }
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.trim()) {
    const hops = forwarded.split(',').map((hop) => hop.trim()).filter(Boolean);
    const last = hops[hops.length - 1];
    if (last) return last;
  }
  const realIp = req.headers['x-real-ip'];
  if (typeof realIp === 'string' && realIp.trim()) return realIp.trim();
  return req.socket.remoteAddress ?? 'unknown';
}

/** Read a request body as a string, refusing bodies over `maxBytes`. */
export function readRawBody(req: http.IncomingMessage, maxBytes: number): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = '';
    let bytes = 0;
    req.on('data', (chunk: Buffer) => {
      bytes += chunk.length;
      if (bytes > maxBytes) {
        reject(new Error('Request body too large'));
        req.destroy();
        return;
      }
      data += chunk.toString('utf8');
    });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

/** Parse the Cookie header into a map. Tolerates malformed pairs. */
export function parseCookies(req: http.IncomingMessage): Record<string, string> {
  const header = req.headers.cookie;
  const out: Record<string, string> = {};
  if (typeof header !== 'string' || !header) return out;
  for (const pair of header.split(';')) {
    const separator = pair.indexOf('=');
    if (separator < 0) continue;
    const name = pair.slice(0, separator).trim();
    const value = pair.slice(separator + 1).trim();
    if (name) out[name] = decodeURIComponent(value);
  }
  return out;
}

export interface CookieWriteOptions {
  maxAgeSeconds?: number;
  httpOnly?: boolean;
  secure?: boolean;
  sameSite?: 'Lax' | 'Strict' | 'None';
  path?: string;
}

/** Serialize a Set-Cookie header value for one attribute set. */
export function cookieHeaderValue(
  name: string,
  value: string,
  options: CookieWriteOptions = {}
): string {
  const parts = [`${name}=${encodeURIComponent(value)}`];
  parts.push(`Path=${options.path ?? '/'}`);
  if (options.maxAgeSeconds !== undefined) {
    parts.push(`Max-Age=${Math.floor(options.maxAgeSeconds)}`);
  }
  parts.push(`SameSite=${options.sameSite ?? 'Lax'}`);
  if (options.httpOnly !== false) parts.push('HttpOnly');
  if (options.secure) parts.push('Secure');
  return parts.join('; ');
}
