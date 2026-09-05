import net from 'node:net';
import { once } from 'node:events';

export type MalwareScanResult =
  | { status: 'clean' }
  | { status: 'infected'; signature: string };

export function parseClamdResponse(raw: string): MalwareScanResult {
  const response = raw.replace(/\0+$/, '').trim();
  if (response === 'stream: OK') return { status: 'clean' };
  const infected = /^stream: (.+) FOUND$/.exec(response);
  if (infected?.[1]) return { status: 'infected', signature: infected[1] };
  const detail = response.replace(/^stream:\s*/i, '').replace(/\. ERROR$/i, '');
  throw new Error(`Malware scanner error: ${detail || 'unexpected response'}`);
}

export async function scanAttachmentStream(chunks: AsyncIterable<Uint8Array>): Promise<MalwareScanResult> {
  const host = process.env.CLAMAV_HOST?.trim();
  const port = Number.parseInt(process.env.CLAMAV_PORT || '3310', 10);
  const timeoutMs = Number.parseInt(process.env.CLAMAV_TIMEOUT_MS || '15000', 10);
  if (!host) throw new Error('CLAMAV_HOST is required for attachment uploads');

  return await new Promise<MalwareScanResult>((resolve, reject) => {
    const socket = net.createConnection({ host, port });
    const responseChunks: Buffer[] = [];
    let settled = false;
    const finish = (callback: () => void) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      callback();
    };

    socket.setTimeout(timeoutMs);
    socket.on('timeout', () => finish(() => reject(new Error('Malware scanner timed out'))));
    socket.on('error', (error) => finish(() => reject(new Error(`Malware scanner unavailable: ${error.message}`))));
    socket.on('data', (chunk) => responseChunks.push(Buffer.from(chunk)));
    socket.on('end', () => finish(() => {
      try {
        resolve(parseClamdResponse(Buffer.concat(responseChunks).toString('utf8')));
      } catch (error) {
        reject(error);
      }
    }));
    socket.on('connect', () => {
      void (async () => {
        socket.write('zINSTREAM\0');
        for await (const rawChunk of chunks) {
          const chunk = Buffer.from(rawChunk);
          const size = Buffer.allocUnsafe(4);
          size.writeUInt32BE(chunk.byteLength, 0);
          if (!socket.write(size)) await once(socket, 'drain');
          if (!socket.write(chunk)) await once(socket, 'drain');
        }
        socket.end(Buffer.alloc(4));
      })().catch((error) => finish(() => reject(error)));
    });
  });
}

export async function scanAttachmentBytes(bytes: Uint8Array): Promise<MalwareScanResult> {
  async function* oneChunk(): AsyncGenerator<Uint8Array> {
    yield bytes;
  }
  return scanAttachmentStream(oneChunk());
}
