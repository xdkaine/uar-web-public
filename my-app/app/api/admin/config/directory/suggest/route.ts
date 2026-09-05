import { NextRequest, NextResponse } from 'next/server';
import { checkAdminAuthWithRateLimit } from '@/lib/adminAuth';
import { actorHasPermission } from '@/lib/rbac/core';
import { suggestDirectoryPaths, type DirectorySuggestionType } from '@/lib/ldap/directory-probe';

export const dynamic = 'force-dynamic';

const SUGGESTION_TYPES: ReadonlySet<string> = new Set(['group', 'ou']);

/**
 * Live DN autocomplete for configuration inputs. Read-only; intentionally not
 * audited per keystroke - the probe endpoint records explicit verification.
 */
export async function GET(request: NextRequest) {
  const { admin, response } = await checkAdminAuthWithRateLimit(request);
  if (!admin || response) {
    return response || NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (!actorHasPermission(admin, 'directory.configure')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const type = request.nextUrl.searchParams.get('type') ?? '';
  const term = request.nextUrl.searchParams.get('term') ?? '';

  if (!SUGGESTION_TYPES.has(type)) {
    return NextResponse.json({ error: 'type must be "group" or "ou"' }, { status: 400 });
  }

  try {
    const suggestions = await suggestDirectoryPaths(type as DirectorySuggestionType, term);
    return NextResponse.json({ suggestions });
  } catch (error) {
    console.error('Error suggesting directory paths:', error);
    // Autocomplete must degrade quietly; the operator can still type manually.
    return NextResponse.json({ suggestions: [] });
  }
}
