#!/usr/bin/env node
/* eslint-disable @typescript-eslint/no-require-imports */

/**
 * Break-glass recovery for a manual login lock.
 *
 * This command clears only manualOverride. loginDisabled deliberately remains
 * true until an authenticated administrator re-enables logins through the
 * settings API, which creates the normal application audit trail.
 */

const { PrismaClient } = require('@prisma/client');

function requiredMetadata(environment = process.env) {
  const operator = environment.LOGIN_LOCK_RECOVERY_OPERATOR?.trim();
  const approver = environment.LOGIN_LOCK_RECOVERY_APPROVER?.trim();
  const ticket = environment.LOGIN_LOCK_RECOVERY_TICKET?.trim();
  const settingsId = environment.LOGIN_LOCK_RECOVERY_SETTINGS_ID?.trim();
  const expectedUpdatedAt = environment.LOGIN_LOCK_RECOVERY_EXPECTED_UPDATED_AT?.trim();
  const action = environment.LOGIN_LOCK_RECOVERY_ACTION?.trim();

  if (!operator || !approver || !ticket || !settingsId || !expectedUpdatedAt || !action) {
    throw new Error(
      'Operator, approver, ticket, settings ID, expected updatedAt, and action recovery variables are required'
    );
  }

  if (operator.toLowerCase() === approver.toLowerCase()) {
    throw new Error('Recovery operator and approver must be different people');
  }

  if (!['unlock', 'restore'].includes(action)) {
    throw new Error('LOGIN_LOCK_RECOVERY_ACTION must be unlock or restore');
  }

  const updatedAt = new Date(expectedUpdatedAt);
  if (Number.isNaN(updatedAt.getTime())) {
    throw new Error('LOGIN_LOCK_RECOVERY_EXPECTED_UPDATED_AT must be an ISO timestamp');
  }

  return { operator, approver, ticket, settingsId, expectedUpdatedAt: updatedAt, action };
}

async function clearManualOverride(prisma, metadata) {
  return prisma.$transaction(async transaction => {
    const currentSettings = await transaction.systemSettings.findUnique({
      where: { id: metadata.settingsId },
    });

    if (!currentSettings) {
      throw new Error('No SystemSettings row exists; recovery requires manual investigation');
    }

    if (metadata.action === 'unlock' && !currentSettings.manualOverride) {
      return { changed: false, settings: currentSettings };
    }

    const attribution = `break-glass:${metadata.operator}:${metadata.ticket}`;
    const restore = metadata.action === 'restore';
    const updateResult = await transaction.systemSettings.updateMany({
      where: {
        id: currentSettings.id,
        updatedAt: metadata.expectedUpdatedAt,
        ...(restore ? {} : { manualOverride: true, loginDisabled: true }),
      },
      data: {
        manualOverride: restore,
        loginDisabled: true,
        lastModifiedBy: attribution,
      },
    });

    if (updateResult.count !== 1) {
      throw new Error('System settings changed concurrently or the login lock invariant was not satisfied');
    }

    const updatedSettings = await transaction.systemSettings.findUnique({
      where: { id: currentSettings.id },
    });

    await transaction.auditLog.create({
      data: {
        action: restore
          ? 'break_glass_restore_manual_login_override'
          : 'break_glass_clear_manual_login_override',
        category: 'settings',
        username: metadata.operator,
        actorType: 'admin',
        targetId: currentSettings.id,
        targetType: 'SystemSettings',
        eventKind: 'security',
        outcome: restore ? 'rollback' : 'pending',
        success: true,
        details: JSON.stringify({
          ticket: metadata.ticket,
          approver: metadata.approver,
          manualOverride: restore,
          loginDisabled: true,
          nextStep: restore ? 'incident_review' : 'authenticated_admin_reenable',
        }),
      },
    });

    return { changed: true, settings: updatedSettings };
  });
}

async function main() {
  const metadata = requiredMetadata();
  const prisma = new PrismaClient();

  try {
    const result = await clearManualOverride(prisma, metadata);
    if (!result.changed) {
      console.log('Manual override is already clear; no database change was made.');
      return;
    }

    console.log(metadata.action === 'restore'
      ? 'Manual override restored with loginDisabled true.'
      : 'Manual override cleared with loginDisabled still true.');
    if (metadata.action === 'unlock') {
      console.log('A different authenticated administrator must now re-enable logins through the settings page.');
    }
    console.log(`Recovery ticket: ${metadata.ticket}`);
  } finally {
    await prisma.$disconnect();
  }
}

if (require.main === module) {
  main().catch(error => {
    console.error('Login-lock recovery failed:', error instanceof Error ? error.message : 'Unknown error');
    process.exitCode = 1;
  });
}

module.exports = { clearManualOverride, requiredMetadata };
