import type { RedisAdapter } from './adapter';
import { prisma } from './db';
import { listActiveSessions } from './session-store';

/**
 * Auth Manager console dashboard (ADR-0012 follow-up): a fixed widget
 * registry with per-admin layout persistence. Widgets are read-only
 * operational aggregates - no secrets, no token material, no PII beyond
 * what the console already exposes.
 */

export const DASHBOARD_WIDGET_KEYS = [
  'active_sessions',
  'distinct_users',
  'signins_24h',
  'failed_signins_24h',
  'high_risk_signins_24h',
  'registered_apps',
  'recent_activity',
] as const;

export type DashboardWidgetKey = (typeof DASHBOARD_WIDGET_KEYS)[number];

export const DEFAULT_DASHBOARD_LAYOUT: DashboardWidgetKey[] = [
  'high_risk_signins_24h',
  'failed_signins_24h',
  'active_sessions',
  'distinct_users',
  'signins_24h',
  'recent_activity',
  'registered_apps',
];

const MAX_LAYOUT_WIDGETS = 12;

export function validateDashboardLayout(input: unknown):
  | { ok: true; widgets: DashboardWidgetKey[] }
  | { ok: false } {
  if (!Array.isArray(input) || input.length === 0 || input.length > MAX_LAYOUT_WIDGETS) {
    return { ok: false };
  }
  const seen = new Set<string>();
  const widgets: DashboardWidgetKey[] = [];
  for (const entry of input) {
    if (typeof entry !== 'string') return { ok: false };
    if (!(DASHBOARD_WIDGET_KEYS as readonly string[]).includes(entry)) return { ok: false };
    if (seen.has(entry)) return { ok: false };
    seen.add(entry);
    widgets.push(entry as DashboardWidgetKey);
  }
  return { ok: true, widgets };
}

export interface DashboardData {
  generatedAt: string;
  widgets: {
    active_sessions: { count: number };
    distinct_users: { count: number };
    signins_24h: { success: number; successRate: number | null };
    failed_signins_24h: { count: number };
    high_risk_signins_24h: { count: number };
    registered_apps: { enabled: number; total: number };
    recent_activity: Array<{
      id: string;
      action: string;
      username: string;
      actorType: string | null;
      outcome: string | null;
      createdAt: string;
    }>;
  };
}

export async function buildDashboardData(
  redis: ConstructorParameters<typeof RedisAdapter>[1]
): Promise<DashboardData> {
  const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);

  const [sessions, success24h, failed24h, highRisk24h, enabledApps, totalApps, recent] = await Promise.all([
    listActiveSessions(redis).catch(() => null),
    prisma.auditLog
      .count({ where: { action: 'LOGIN_SUCCESS', createdAt: { gte: dayAgo } } })
      .catch(() => 0),
    prisma.auditLog
      .count({ where: { action: 'LOGIN_FAILED', createdAt: { gte: dayAgo } } })
      .catch(() => 0),
    prisma.auditLog
      .count({ where: { action: 'LOGIN_SUCCESS', riskLevel: 'high', createdAt: { gte: dayAgo } } })
      .catch(() => 0),
    prisma.oidcClient.count({ where: { enabled: true } }).catch(() => 0),
    prisma.oidcClient.count().catch(() => 0),
    prisma.auditLog
      .findMany({
        orderBy: { createdAt: 'desc' },
        take: 12,
        select: {
          id: true,
          action: true,
          username: true,
          actorType: true,
          outcome: true,
          createdAt: true,
        },
      })
      .catch(() => []),
  ]);

  const attempted = success24h + failed24h;

  return {
    generatedAt: new Date().toISOString(),
    widgets: {
      active_sessions: { count: sessions?.aggregates.totalSessions ?? 0 },
      distinct_users: { count: sessions?.aggregates.distinctUsers ?? 0 },
      signins_24h: {
        success: success24h,
        successRate: attempted > 0 ? Math.round((success24h / attempted) * 100) : null,
      },
      failed_signins_24h: { count: failed24h },
      high_risk_signins_24h: { count: highRisk24h },
      registered_apps: { enabled: enabledApps, total: totalApps },
      recent_activity: recent.map((row) => ({
        id: row.id,
        action: row.action,
        username: row.username,
        actorType: row.actorType,
        outcome: row.outcome,
        createdAt: row.createdAt.toISOString(),
      })),
    },
  };
}

type LayoutPrisma = Pick<typeof prisma, 'adminConsoleLayout'>;

export async function loadDashboardLayout(
  db: LayoutPrisma,
  adminUsername: string
): Promise<DashboardWidgetKey[]> {
  try {
    const row = await db.adminConsoleLayout.findUnique({
      where: { adminUsername },
      select: { widgets: true },
    });
    if (row) {
      const parsed = validateDashboardLayout(row.widgets);
      if (parsed.ok) return parsed.widgets;
    }
  } catch (error) {
    // Pre-migration deployments keep the default layout.
    console.error('[auth] dashboard layout read failed', error);
  }
  return DEFAULT_DASHBOARD_LAYOUT;
}

export async function saveDashboardLayout(
  db: LayoutPrisma,
  adminUsername: string,
  widgets: DashboardWidgetKey[]
): Promise<void> {
  await db.adminConsoleLayout.upsert({
    where: { adminUsername },
    update: { widgets },
    create: { adminUsername, widgets },
  });
}
