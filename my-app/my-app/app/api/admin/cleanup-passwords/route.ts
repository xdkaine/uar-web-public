import { NextRequest, NextResponse } from 'next/server';
import { checkAdminAuthWithRateLimit } from '@/lib/adminAuth';
import { runPasswordCleanup } from '@/lib/password-cleanup';
import { runAllCleanupTasks } from '@/lib/session-cleanup';
import { secureJsonResponse } from '@/lib/apiResponse';
import { logAuditAction, AuditActions, AuditCategories, getIpAddress, getUserAgent } from '@/lib/audit-log';

export async function POST(request: NextRequest) {
  try {
    const { admin, response } = await checkAdminAuthWithRateLimit(request);

    if (!admin || response) {
      return response || NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const [passwordResults, cleanupResults] = await Promise.all([
      runPasswordCleanup(),
      runAllCleanupTasks()
    ]);

    const summary = {
      totalPasswordsCleared: passwordResults.totalCleared,
      totalSessionsCleared: cleanupResults.sessions.totalCleaned,
      totalResetTokensCleared: cleanupResults.resetTokens
    };

    // Log audit action
    await logAuditAction({
      action: AuditActions.RUN_CLEANUP,
      category: AuditCategories.SETTINGS,
      username: admin.username,
      details: {
        passwords: passwordResults,
        sessions: cleanupResults.sessions,
        resetTokens: cleanupResults.resetTokens,
        summary,
      },
      ipAddress: getIpAddress(request),
      userAgent: getUserAgent(request),
    });

    return secureJsonResponse({
      message: 'All cleanup tasks completed successfully',
      passwords: passwordResults,
      sessions: cleanupResults.sessions,
      resetTokens: cleanupResults.resetTokens,
      summary
    });
  } catch (error) {
    console.error('Error running cleanup tasks:', error);
    
    // Log failed cleanup attempt
    const { admin: adminRetry } = await checkAdminAuthWithRateLimit(request);
    if (adminRetry) {
      await logAuditAction({
        action: AuditActions.RUN_CLEANUP,
        category: AuditCategories.SETTINGS,
        username: adminRetry.username,
        success: false,
        errorMessage: error instanceof Error ? error.message : 'Unknown error',
        ipAddress: getIpAddress(request),
        userAgent: getUserAgent(request),
      });
    }
    
    return secureJsonResponse(
      { error: 'Failed to run cleanup tasks' },
      500
    );
  }
}
