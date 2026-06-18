import { NextRequest, NextResponse } from 'next/server';
import { checkAdminAuthWithRateLimit } from '@/lib/adminAuth';
import {
  runLockedPasswordExpirationNotifications,
  type PasswordExpirationStatus,
} from '@/lib/password-expiration';
import {
  isJsonBodyError,
  MAX_REQUEST_BODY_SIZE,
  parseJsonWithLimit,
} from '@/lib/validation';

const ALLOWED_STATUSES = new Set<PasswordExpirationStatus>(['expiring_soon', 'expired', 'must_change']);
const MAX_SELECTED_USERS = 200;

interface NotifyRequestBody {
  usernames?: unknown;
  statuses?: unknown;
  force?: unknown;
}

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return Array.from(new Set(
    value
      .map((item) => typeof item === 'string' ? item.trim() : '')
      .filter(Boolean)
  ));
}

function normalizeStatuses(value: unknown): PasswordExpirationStatus[] | null {
  if (value === undefined) return ['expiring_soon', 'expired', 'must_change'];
  if (!Array.isArray(value)) return null;

  const statuses = normalizeStringArray(value);
  if (
    statuses.length === 0 ||
    statuses.some((status) => !ALLOWED_STATUSES.has(status as PasswordExpirationStatus))
  ) {
    return null;
  }
  return statuses as PasswordExpirationStatus[];
}

export async function POST(request: NextRequest) {
  try {
    const { admin, response } = await checkAdminAuthWithRateLimit(request);
    if (!admin || response) {
      return response || NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await parseJsonWithLimit<NotifyRequestBody>(request, MAX_REQUEST_BODY_SIZE.SMALL);
    const usernames = normalizeStringArray(body.usernames);
    if (usernames.length === 0) {
      return NextResponse.json(
        { error: 'At least one username must be selected' },
        { status: 400 }
      );
    }
    if (usernames.length > MAX_SELECTED_USERS) {
      return NextResponse.json(
        { error: `No more than ${MAX_SELECTED_USERS} users can be selected at once` },
        { status: 400 }
      );
    }
    const statuses = normalizeStatuses(body.statuses);
    if (!statuses) {
      return NextResponse.json(
        { error: 'Statuses must contain one or more supported password expiration states' },
        { status: 400 }
      );
    }
    if (body.force !== undefined && typeof body.force !== 'boolean') {
      return NextResponse.json(
        { error: 'Force must be a boolean' },
        { status: 400 }
      );
    }

    const processing = await runLockedPasswordExpirationNotifications({
      actor: admin.username,
      usernames,
      statuses,
      force: body.force === true,
    });
    if (processing.status === 'busy') {
      return NextResponse.json(processing, { status: 409 });
    }

    return NextResponse.json({ success: true, ...processing.result });
  } catch (error) {
    if (isJsonBodyError(error)) {
      return NextResponse.json({ error: error.message }, { status: error.statusCode });
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to send password expiration reminders' },
      { status: 500 }
    );
  }
}
