import { NextRequest, NextResponse } from 'next/server';
import { checkAuditAccessWithRateLimit } from '@/lib/adminAuth';
import { CONTROL_MANIFEST, validateControlManifest } from '@/lib/evidence/control-manifest';

export const dynamic = 'force-dynamic';

/**
 * Read-only view of the control self-test catalog. The manifest is
 * code-defined and immutable per release; this endpoint adds nothing and
 * mutates nothing.
 */
export async function GET(request: NextRequest) {
  const { admin, response } = await checkAuditAccessWithRateLimit(request);
  if (!admin || response) {
    return response || NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const integrity = validateControlManifest();
  return NextResponse.json({
    controls: CONTROL_MANIFEST,
    integrity,
    generatedAt: new Date().toISOString(),
  });
}
