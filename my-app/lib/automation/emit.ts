import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { appLogger } from '@/lib/logger';
import { isAutomationTriggerKey, type AutomationContext, type AutomationTriggerKey } from './catalog';
import { runAutomationRule, type RuleExecutionResult } from './evaluator';

export interface RuleEmissionSummary {
  ruleId: string;
  ruleName: string;
  status: 'succeeded' | 'failed' | 'skipped' | 'duplicate';
  matched: boolean;
  error?: string;
}

export interface AutomationEmissionResult {
  triggerKey: AutomationTriggerKey;
  eventKey: string;
  rulesConsidered: number;
  summaries: RuleEmissionSummary[];
}

function asRuleRow(row: {
  id: string;
  name: string;
  conditions: unknown;
  actions: unknown;
}) {
  return {
    id: row.id,
    name: row.name,
    triggerKey: '',
    conditions: row.conditions,
    actions: row.actions,
  };
}

export async function emitAutomationEvent(
  triggerKey: AutomationTriggerKey,
  eventKey: string,
  context: AutomationContext
): Promise<AutomationEmissionResult> {
  if (!isAutomationTriggerKey(triggerKey)) {
    throw new Error(`Unknown automation trigger key: ${String(triggerKey)}`);
  }
  if (typeof eventKey !== 'string' || !eventKey || eventKey.length > 300) {
    throw new Error('eventKey must be a non-empty string of at most 300 characters');
  }

  const rules = await prisma.automationRule.findMany({
    where: { triggerKey, enabled: true },
    select: { id: true, name: true, conditions: true, actions: true },
    orderBy: { createdAt: 'asc' },
  });

  const result: AutomationEmissionResult = {
    triggerKey,
    eventKey,
    rulesConsidered: rules.length,
    summaries: [],
  };

  for (const rule of rules) {
    let runId: string;
    try {
      const created = await prisma.automationRun.create({
        data: {
          ruleId: rule.id,
          eventKey,
          triggerKey,
          status: 'succeeded',
        },
        select: { id: true },
      });
      runId = created.id;
    } catch {
      result.summaries.push({
        ruleId: rule.id,
        ruleName: rule.name,
        status: 'duplicate',
        matched: false,
      });
      continue;
    }

    let execution: RuleExecutionResult;
    try {
      execution = await runAutomationRule(asRuleRow(rule), context);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      appLogger.error('Automation rule evaluation threw', { ruleId: rule.id, error: message });
      execution = { matched: false, outcomes: [], error: message };
    }

    const failed = Boolean(execution.error);
    await prisma.automationRun.update({
      where: { id: runId },
      data: {
        status: execution.matched ? (failed ? 'failed' : 'succeeded') : 'skipped',
        matched: execution.matched,
        outcomes:
          execution.outcomes.length > 0
            ? (execution.outcomes as unknown as Prisma.InputJsonValue)
            : undefined,
        error: execution.error,
        finishedAt: new Date(),
      },
    });

    result.summaries.push({
      ruleId: rule.id,
      ruleName: rule.name,
      status: execution.matched ? (failed ? 'failed' : 'succeeded') : 'skipped',
      matched: execution.matched,
      error: execution.error,
    });
  }

  return result;
}
