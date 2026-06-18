import type { NextRequest } from 'next/server';
import {
  isJsonBodyError,
  JsonBodyError,
  MAX_REQUEST_BODY_SIZE,
  parseJsonWithLimit,
} from '@/lib/validation';

export { isJsonBodyError, JsonBodyError, MAX_REQUEST_BODY_SIZE };

export async function parseAdminJson<T = unknown>(
  request: NextRequest,
  maxSizeBytes: number = MAX_REQUEST_BODY_SIZE.SMALL
): Promise<T> {
  return parseJsonWithLimit<T>(request, maxSizeBytes);
}