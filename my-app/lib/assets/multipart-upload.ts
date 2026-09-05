import Busboy from 'busboy';
import { randomUUID } from 'node:crypto';
import { createWriteStream, promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';

export interface StagedUpload {
  filename: string;
  declaredContentType: string;
  sizeBytes: number;
  path: string;
}

export interface StagedMultipartUpload {
  directory: string;
  files: StagedUpload[];
}

export class MultipartUploadError extends Error {
  constructor(message: string, readonly statusCode = 400) {
    super(message);
  }
}

export async function cleanupStagedUpload(staged: StagedMultipartUpload | null): Promise<void> {
  if (!staged) return;
  await fs.rm(staged.directory, { recursive: true, force: true });
}

export async function stageMultipartUpload(
  request: Request,
  limits: { maxFiles: number; maxFileBytes: number; maxRequestBytes: number }
): Promise<StagedMultipartUpload> {
  const contentType = request.headers.get('content-type') || '';
  if (!contentType.toLowerCase().startsWith('multipart/form-data')) {
    throw new MultipartUploadError('Expected multipart form data with a files field');
  }
  const declaredLength = Number(request.headers.get('content-length'));
  if (Number.isFinite(declaredLength) && declaredLength > limits.maxRequestBytes) {
    throw new MultipartUploadError(`Upload request exceeds ${limits.maxRequestBytes} bytes`, 413);
  }
  if (!request.body) throw new MultipartUploadError('Upload request body is empty');

  const directory = await fs.mkdtemp(path.join(tmpdir(), 'uar-upload-'));
  const files: StagedUpload[] = [];
  const writes: Promise<void>[] = [];
  let parseError: Error | null = null;

  try {
    const parser = Busboy({
      headers: { 'content-type': contentType },
      limits: {
        files: limits.maxFiles,
        fileSize: limits.maxFileBytes,
        fields: 4,
        parts: limits.maxFiles + 4,
      },
    });

    parser.on('file', (fieldName, stream, info) => {
      if (fieldName !== 'files') {
        stream.resume();
        return;
      }
      const target = path.join(directory, randomUUID());
      const staged: StagedUpload = {
        filename: info.filename,
        declaredContentType: info.mimeType,
        sizeBytes: 0,
        path: target,
      };
      files.push(staged);
      const output = createWriteStream(target, { mode: 0o600 });
      stream.on('data', (chunk: Buffer) => {
        staged.sizeBytes += chunk.byteLength;
      });
      stream.on('limit', () => {
        parseError = new MultipartUploadError(
          `Each file must be between 1 byte and ${limits.maxFileBytes} bytes`,
          413
        );
      });
      writes.push(pipeline(stream, output));
    });
    parser.on('filesLimit', () => {
      parseError = new MultipartUploadError(`Upload allows at most ${limits.maxFiles} files`, 413);
    });
    parser.on('partsLimit', () => {
      parseError = new MultipartUploadError('Multipart upload contains too many parts', 413);
    });

    let received = 0;
    const counter = new Transform({
      transform(chunk, _encoding, callback) {
        received += chunk.length;
        if (received > limits.maxRequestBytes) {
          callback(new MultipartUploadError(`Upload request exceeds ${limits.maxRequestBytes} bytes`, 413));
          return;
        }
        callback(null, chunk);
      },
    });

    await pipeline(Readable.fromWeb(request.body as never), counter, parser);
    await Promise.all(writes);
    if (parseError) throw parseError;
    if (files.length === 0) throw new MultipartUploadError('No files were uploaded');
    if (files.some((file) => file.sizeBytes <= 0)) {
      throw new MultipartUploadError('Empty files are not allowed');
    }
    return { directory, files };
  } catch (error) {
    await fs.rm(directory, { recursive: true, force: true });
    if (error instanceof MultipartUploadError) throw error;
    throw new MultipartUploadError(error instanceof Error ? error.message : 'Invalid multipart upload');
  }
}
