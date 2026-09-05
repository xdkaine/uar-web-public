import http from 'node:http';
import { execFile } from 'node:child_process';
import { timingSafeEqual } from 'node:crypto';
import net from 'node:net';

const port = 8091;
const token = process.env.MONITOR_PROBE_SHARED_SECRET || '';

function authorized(value) {
  const provided = Buffer.from(value || '');
  const expected = Buffer.from(token);
  return expected.length > 0 && provided.length === expected.length && timingSafeEqual(provided, expected);
}

function send(response, status, value) {
  response.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' });
  response.end(JSON.stringify(value));
}

function forbiddenAddress(address) {
  if (net.isIPv4(address)) {
    const octets = address.split('.').map(Number);
    return octets[0] === 0 || octets[0] === 127 || octets[0] >= 224 || (octets[0] === 169 && octets[1] === 254);
  }
  if (net.isIPv6(address)) {
    const value = address.toLowerCase();
    return value === '::' || value === '::1' || value.startsWith('fe80:') || value.startsWith('ff');
  }
  return true;
}

const server = http.createServer((request, response) => {
  if (request.method === 'GET' && request.url === '/healthz') return send(response, 200, { ok: true });
  if (request.method !== 'POST' || request.url !== '/probe') return send(response, 404, { error: 'Not found' });
  if (!authorized(request.headers['x-monitor-probe-token'])) return send(response, 401, { error: 'Unauthorized' });
  let raw = '';
  request.setEncoding('utf8');
  request.on('data', (chunk) => {
    raw += chunk;
    if (raw.length > 4096) request.destroy();
  });
  request.on('end', () => {
    let payload;
    try { payload = JSON.parse(raw); } catch { return send(response, 400, { error: 'Invalid JSON' }); }
    const host = typeof payload.host === 'string' ? payload.host.trim().toLowerCase() : '';
    const timeoutMs = Number(payload.timeoutMs);
    if (!host || forbiddenAddress(host) || !Number.isInteger(timeoutMs) || timeoutMs < 500 || timeoutMs > 15000) {
      return send(response, 400, { error: 'Invalid probe target' });
    }
    const seconds = String(Math.max(1, Math.ceil(timeoutMs / 1000)));
    execFile('ping', ['-c', '1', '-W', seconds, host], { timeout: timeoutMs + 500 }, (error) => {
      if (error) return send(response, 200, { reachable: false, error: 'ICMP target did not answer' });
      return send(response, 200, { reachable: true });
    });
  });
});

if (!token) {
  console.error('MONITOR_PROBE_SHARED_SECRET is required');
  process.exit(1);
}
server.listen(port, '0.0.0.0', () => console.log(`monitor-probe listening on ${port}`));
