import { NextResponse } from 'next/server';
import {
  AuditActions,
  AuditCategories,
  getIpAddress,
  getUserAgent,
  logAuditAction,
  sanitizeDatabaseText,
  type AuditActorType,
  type AuditEventKind,
  type AuditOutcome,
} from '@/lib/audit-log';
import { isJsonBodyError } from '@/lib/validation';
import { StandardErrors } from '@/lib/standardErrors';

export class AdminRouteError extends Error {
  statusCode: number;
  clientMessage?: string;

  constructor(message: string, statusCode = 400, clientMessage?: string) {
    super(message);
    this.name = 'AdminRouteError';
    this.statusCode = statusCode;
    this.clientMessage = clientMessage;
  }
}

export type AdminRouteErrorContext = {
  route: string;
  action?: string;
  category?: string;
  username?: string;
  actorType?: AuditActorType;
  targetId?: string | null;
  targetType?: string | null;
  request?: Request;
  eventKind?: AuditEventKind;
  outcome?: AuditOutcome;
  details?: Record<string, unknown>;
  audit?: boolean;
};

function numericErrorProperty(error: unknown, key: 'status' | 'statusCode'): number | null {
  if (!error || typeof error !== 'object' || !(key in error)) {
    return null;
  }

  const value = (error as Record<string, unknown>)[key];
  return typeof value === 'number' && Number.isInteger(value) ? value : null;
}

export function getAdminErrorStatus(error: unknown): number {
  if (isJsonBodyError(error)) {
    return error.statusCode;
  }

  return numericErrorProperty(error, 'statusCode') ?? numericErrorProperty(error, 'status') ?? 500;
}

export function getAdminClientErrorMessage(error: unknown, statusCode = getAdminErrorStatus(error)): string {
  if (isJsonBodyError(error)) {
    return error.message;
  }

  if (error instanceof AdminRouteError) {
    return error.clientMessage || error.message;
  }

  if (statusCode >= 400 && statusCode < 500 && error instanceof Error && error.message) {
    return error.message;
  }

  return StandardErrors.INTERNAL_ERROR;
}

function serverErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Unknown error';
}

export async function handleAdminRouteError(
  error: unknown,
  context: AdminRouteErrorContext
): Promise<NextResponse> {
  const statusCode = getAdminErrorStatus(error);
  const clientMessage = getAdminClientErrorMessage(error, statusCode);
  const errorMessage = sanitizeDatabaseText(serverErrorMessage(error)) || 'Unknown error';

  console.error(`[${context.route}] Admin route error:`, {
    statusCode,
    error: errorMessage,
    stack: error instanceof Error && process.env.NODE_ENV !== 'production' ? error.stack : undefined,
  });

  if (context.audit !== false && context.username) {
    try {
      await logAuditAction({
        action: context.action || AuditActions.ADMIN_API_REQUEST,
        category: context.category || AuditCategories.NAVIGATION,
        username: context.username,
        actorType: context.actorType || 'admin',
        targetId: context.targetId || undefined,
        targetType: context.targetType || undefined,
        eventKind: context.eventKind || 'write',
        outcome: context.outcome || 'failure',
        success: false,
        errorMessage,
        details: context.details,
        ipAddress: context.request ? getIpAddress(context.request) : undefined,
        userAgent: context.request ? getUserAgent(context.request) : undefined,
      });
    } catch (auditError) {
      console.error(`[${context.route}] Failed to record admin route failure:`, auditError);
    }
  }

  return NextResponse.json({ error: clientMessage }, { status: statusCode });
}