import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { checkAdminAuthWithRateLimit } from '@/lib/adminAuth';
import { actorHasPermission } from '@/lib/rbac/core';
import logger from '@/lib/logger';
import { logAuditAction, AuditActions, AuditCategories, getIpAddress, getUserAgent } from '@/lib/audit-log';
import { validateAuthModeWrite } from '@/lib/auth/mode';
import { isJsonBodyError, MAX_REQUEST_BODY_SIZE, parseJsonWithLimit, validateEmail, validateStringLength } from '@/lib/validation';

export const dynamic = 'force-dynamic';

const DEFAULT_SYSTEM_SETTINGS = {
  loginDisabled: false,
  internalRegistrationDisabled: false,
  externalRegistrationDisabled: false,
  globalNotificationBanner: null,
  notificationBannerType: null,
  manualOverride: false,
  authMode: null,
  lastModifiedBy: null,
  emailFrom: null,
  adminEmail: null,
  facultyEmail: null,
  studentDirectorEmails: null,
} as const;

interface SettingsUpdateBody {
  loginDisabled?: unknown;
  authMode?: unknown;
  internalRegistrationDisabled?: unknown;
  externalRegistrationDisabled?: unknown;
  globalNotificationBanner?: unknown;
  notificationBannerType?: unknown;
  manualOverride?: unknown;
  emailFrom?: unknown;
  adminEmail?: unknown;
  facultyEmail?: unknown;
  studentDirectorEmails?: unknown;
}

type SettingsUpdateData = {
  lastModifiedBy: string;
  loginDisabled?: boolean;
  authMode?: string | null;
  internalRegistrationDisabled?: boolean;
  externalRegistrationDisabled?: boolean;
  globalNotificationBanner?: string | null;
  notificationBannerType?: string | null;
  manualOverride?: boolean;
  emailFrom?: string | null;
  adminEmail?: string | null;
  facultyEmail?: string | null;
  studentDirectorEmails?: string | null;
};

function isValidEmailAddress(value: string, allowDisplayName = false): boolean {
  if (validateEmail(value.toLowerCase())) {
    return true;
  }

  if (!allowDisplayName) {
    return false;
  }

  const displayNameMatch = value.match(/^.+<([^<>]+)>$/);
  return !!displayNameMatch && validateEmail(displayNameMatch[1].trim().toLowerCase());
}

function normalizeOptionalEmail(
  value: unknown,
  fieldName: string,
  options: { allowDisplayName?: boolean } = {}
): { value?: string | null; error?: string } {
  if (value === undefined) {
    return {};
  }

  if (value === null) {
    return { value: null };
  }

  if (typeof value !== 'string') {
    return { error: `${fieldName} must be an email address` };
  }

  const normalized = options.allowDisplayName ? value.trim() : value.trim().toLowerCase();
  if (!normalized) {
    return { value: null };
  }

  if (!isValidEmailAddress(normalized, options.allowDisplayName)) {
    return { error: `${fieldName} must be a valid email address` };
  }

  return { value: normalized };
}

function normalizeStudentDirectorEmails(value: unknown): { value?: string | null; error?: string } {
  if (value === undefined) {
    return {};
  }

  if (value === null) {
    return { value: null };
  }

  if (typeof value !== 'string') {
    return { error: 'Student director emails must be a comma-separated list' };
  }

  const lengthValidation = validateStringLength(value, 'Student director emails', 2000);
  if (!lengthValidation.valid) {
    return { error: lengthValidation.error };
  }

  const emails = Array.from(new Set(
    value
      .split(',')
      .map((email) => email.trim().toLowerCase())
      .filter(Boolean)
  ));

  const invalidEmail = emails.find((email) => !validateEmail(email));
  if (invalidEmail) {
    return { error: `Student director email is invalid: ${invalidEmail}` };
  }

  return { value: emails.length > 0 ? emails.join(', ') : null };
}

// GET /api/admin/settings - Get system settings
export async function GET(request: NextRequest) {
  try {
    const { admin, response } = await checkAdminAuthWithRateLimit(request);
    if (!admin || response) {
      return response || NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    if (!actorHasPermission(admin, 'settings.manage')) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const persistedSettings = await prisma.systemSettings.findFirst({
      orderBy: { createdAt: 'desc' },
    });
    // Reading an unconfigured installation must not persist policy or imply a save.
    const settings = persistedSettings ?? {
      ...DEFAULT_SYSTEM_SETTINGS,
      id: null,
      createdAt: null,
      updatedAt: null,
    };

    return NextResponse.json({
      settings: {
        ...settings,
        emailFrom: settings.emailFrom || process.env.EMAIL_FROM || null,
        adminEmail: settings.adminEmail || process.env.ADMIN_EMAIL || null,
        facultyEmail: settings.facultyEmail || process.env.FACULTY_EMAIL || null,
        studentDirectorEmails: settings.studentDirectorEmails || process.env.STUDENT_DIRECTOR_EMAILS || null,
      },
    });
  } catch (error) {
    logger.error('Error fetching system settings', {
      action: 'fetch_settings',
      error: error instanceof Error ? error.message : 'Unknown error',
    });
    return NextResponse.json(
      { error: 'Failed to fetch system settings' },
      { status: 500 }
    );
  }
}

// PATCH /api/admin/settings - Update system settings
export async function PATCH(request: NextRequest) {
  try {
    const { admin, response } = await checkAdminAuthWithRateLimit(request);
    if (!admin || response) {
      return response || NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    if (!actorHasPermission(admin, 'settings.manage')) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const body = await parseJsonWithLimit<SettingsUpdateBody>(request, MAX_REQUEST_BODY_SIZE.SMALL);
    const {
      loginDisabled,
      authMode,
      internalRegistrationDisabled,
      externalRegistrationDisabled,
      globalNotificationBanner,
      notificationBannerType,
      manualOverride,
      emailFrom,
      adminEmail,
      facultyEmail,
      studentDirectorEmails,
    } = body;

    // Validate notification banner type
    const validBannerTypes = ['info', 'warning', 'error', 'success', null];
    if (
      notificationBannerType !== undefined &&
      !(notificationBannerType === null || (typeof notificationBannerType === 'string' && validBannerTypes.includes(notificationBannerType)))
    ) {
      return NextResponse.json(
        { error: 'Invalid notification banner type' },
        { status: 400 }
      );
    }

    for (const [fieldName, fieldValue] of Object.entries({
      loginDisabled,
      internalRegistrationDisabled,
      externalRegistrationDisabled,
      manualOverride,
    })) {
      if (fieldValue !== undefined && typeof fieldValue !== 'boolean') {
        return NextResponse.json(
          { error: `${fieldName} must be a boolean` },
          { status: 400 }
        );
      }
    }

    // Get current settings
    let currentSettings = await prisma.systemSettings.findFirst({
      orderBy: { createdAt: 'desc' },
    });

    // If no settings exist, create them
    if (!currentSettings) {
      currentSettings = await prisma.systemSettings.create({
        data: DEFAULT_SYSTEM_SETTINGS,
      });
    }

    // A live manual override can only be cleared through the documented database procedure.
    const clearsManualLoginLock =
      currentSettings.manualOverride &&
      (
        manualOverride === false ||
        (currentSettings.loginDisabled && loginDisabled === false)
      );

    if (clearsManualLoginLock) {
      return NextResponse.json(
        { error: 'Login re-enabling is locked. Manual database override is required to unlock this setting.' },
        { status: 403 }
      );
    }

    if (
      loginDisabled === false &&
      !currentSettings.manualOverride &&
      currentSettings.lastModifiedBy?.startsWith('break-glass:')
    ) {
      const recoveryOperator = currentSettings.lastModifiedBy.split(':')[1]?.toLowerCase();
      if (recoveryOperator === admin.username.toLowerCase()) {
        return NextResponse.json(
          { error: 'A different authenticated administrator must re-enable logins after break-glass recovery.' },
          { status: 403 }
        );
      }
    }

    // Prepare update data
    const updateData: SettingsUpdateData = {
      lastModifiedBy: admin.username,
    };

    if (authMode !== undefined) {
      const verdict = await validateAuthModeWrite(authMode);
      if (!verdict.ok) {
        return NextResponse.json({ error: verdict.error }, { status: 400 });
      }
      updateData.authMode = verdict.value;
    }
    if (loginDisabled !== undefined) updateData.loginDisabled = loginDisabled as boolean;
    if (internalRegistrationDisabled !== undefined) updateData.internalRegistrationDisabled = internalRegistrationDisabled as boolean;
    if (externalRegistrationDisabled !== undefined) updateData.externalRegistrationDisabled = externalRegistrationDisabled as boolean;
    if (globalNotificationBanner !== undefined) {
      if (globalNotificationBanner !== null && typeof globalNotificationBanner !== 'string') {
        return NextResponse.json({ error: 'Notification banner must be text' }, { status: 400 });
      }
      updateData.globalNotificationBanner = typeof globalNotificationBanner === 'string'
        ? globalNotificationBanner.trim() || null
        : null;
    }
    if (notificationBannerType !== undefined) updateData.notificationBannerType = notificationBannerType as string | null;
    
    // Update manualOverride if login is being disabled
    if (manualOverride !== undefined) {
      updateData.manualOverride = manualOverride as boolean;
    }
    if (manualOverride === true) {
      updateData.loginDisabled = true;
    }

    // Update email configuration
    const normalizedEmailFrom = normalizeOptionalEmail(emailFrom, 'From address', { allowDisplayName: true });
    if (normalizedEmailFrom.error) {
      return NextResponse.json({ error: normalizedEmailFrom.error }, { status: 400 });
    }
    if (emailFrom !== undefined) updateData.emailFrom = normalizedEmailFrom.value ?? null;

    const normalizedAdminEmail = normalizeOptionalEmail(adminEmail, 'Admin email');
    if (normalizedAdminEmail.error) {
      return NextResponse.json({ error: normalizedAdminEmail.error }, { status: 400 });
    }
    if (adminEmail !== undefined) updateData.adminEmail = normalizedAdminEmail.value ?? null;

    const normalizedFacultyEmail = normalizeOptionalEmail(facultyEmail, 'Faculty email');
    if (normalizedFacultyEmail.error) {
      return NextResponse.json({ error: normalizedFacultyEmail.error }, { status: 400 });
    }
    if (facultyEmail !== undefined) updateData.facultyEmail = normalizedFacultyEmail.value ?? null;

    const normalizedDirectorEmails = normalizeStudentDirectorEmails(studentDirectorEmails);
    if (normalizedDirectorEmails.error) {
      return NextResponse.json({ error: normalizedDirectorEmails.error }, { status: 400 });
    }
    if (studentDirectorEmails !== undefined) updateData.studentDirectorEmails = normalizedDirectorEmails.value ?? null;

    let updatedSettings;
    if (loginDisabled === false || manualOverride === false) {
      const updateResult = await prisma.systemSettings.updateMany({
        where: {
          id: currentSettings.id,
          manualOverride: false,
        },
        data: updateData,
      });

      if (updateResult.count !== 1) {
        return NextResponse.json(
          { error: 'Login re-enabling is locked. Manual database override is required to unlock this setting.' },
          { status: 403 }
        );
      }

      updatedSettings = await prisma.systemSettings.findUnique({
        where: { id: currentSettings.id },
      });
      if (!updatedSettings) {
        throw new Error('Updated system settings could not be loaded');
      }
    } else {
      updatedSettings = await prisma.systemSettings.update({
        where: { id: currentSettings.id },
        data: updateData,
      });
    }

    // Clear email config cache when email settings are updated
    if (emailFrom !== undefined || adminEmail !== undefined || facultyEmail !== undefined || studentDirectorEmails !== undefined) {
      const { clearEmailConfigCache } = await import('@/lib/email-config');
      clearEmailConfigCache();
    }

    logger.info('System settings updated', {
      action: 'update_settings',
      settingsId: updatedSettings.id,
      updatedBy: admin.username,
      changedFields: Object.keys(updateData).filter((key) => key !== 'lastModifiedBy'),
    });

    // Log the settings update to audit log
    await logAuditAction({
      action: AuditActions.UPDATE_SETTINGS,
      category: AuditCategories.SETTINGS,
      username: admin.username,
      targetId: updatedSettings.id,
      targetType: 'SystemSettings',
      details: {
        changedFields: Object.keys(updateData).filter((key) => key !== 'lastModifiedBy'),
        loginDisabled: updatedSettings.loginDisabled,
        internalRegistrationDisabled: updatedSettings.internalRegistrationDisabled,
        externalRegistrationDisabled: updatedSettings.externalRegistrationDisabled,
        manualOverride: updatedSettings.manualOverride,
      },
      ipAddress: getIpAddress(request),
      userAgent: getUserAgent(request),
    });

    return NextResponse.json({ 
      settings: updatedSettings,
      message: 'Settings updated successfully',
    });
  } catch (error) {
    if (isJsonBodyError(error)) {
      return NextResponse.json({ error: error.message }, { status: error.statusCode });
    }

    logger.error('Error updating system settings', {
      action: 'update_settings',
      error: error instanceof Error ? error.message : 'Unknown error',
    });
    
    // Log the failed settings update
    const { admin } = await checkAdminAuthWithRateLimit(request);
    if (admin) {
      await logAuditAction({
        action: AuditActions.UPDATE_SETTINGS,
        category: AuditCategories.SETTINGS,
        username: admin.username,
        targetType: 'SystemSettings',
        success: false,
        errorMessage: error instanceof Error ? error.message : 'Unknown error',
        ipAddress: getIpAddress(request),
        userAgent: getUserAgent(request),
      });
    }
    
    return NextResponse.json(
      { error: 'Failed to update system settings' },
      { status: 500 }
    );
  }
}
