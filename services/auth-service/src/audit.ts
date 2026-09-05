import { prisma } from './db';

/**
 * Shared audit writer for administrative events on this service. Rows land
 * in the portal-owned AuditLog table (ADR-0012): this service INSERTs
 * identity/security events only.
 */
export async function auditAdminEvent(input: {
  action: string;
  username: string;
  subjectUsername?: string;
  outcome: string;
  ip: string | null;
  userAgent: string | null;
  error?: string;
  details?: Record<string, unknown>;
  success?: boolean;
}): Promise<void> {
  await prisma.auditLog.create({
      data: {
        action: input.action,
        category: 'authentication',
        username: input.username,
        actorType: 'admin',
        subjectUsername: input.subjectUsername ?? input.username,
        eventKind: 'security',
        outcome: input.outcome,
        details: JSON.stringify({
          surface: 'admin_console',
          error: input.error ?? undefined,
          ...input.details,
        }),
        ipAddress: input.ip,
        userAgent: input.userAgent,
        success: input.success ?? input.action.endsWith('SUCCESS'),
      },
  });
}
