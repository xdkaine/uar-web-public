import { NextResponse } from 'next/server';
import { getPortalSignInPolicy } from '@/lib/auth/sign-in-policy';
import { appLogger } from '@/lib/logger';

export const dynamic = 'force-dynamic';

/** Public discovery for the portal-owned sign-in chooser. */
export async function GET() {
  try {
    const resolved = await getPortalSignInPolicy();
    const methods = resolved.methods
      .filter((method) => method.enabled && method.ready)
      .map(({ id, displayName, description }) => ({ id, displayName, description }));

    if (methods.length === 0) {
      appLogger.error('[AuthPolicy] No enabled sign-in method is currently usable');
      return NextResponse.json(
        { error: 'No sign-in method is currently available.', methods: [] },
        { status: 503 }
      );
    }

    // Compatibility fields remain until older login clients have moved to
    // the ordered `methods` contract. They describe the first usable method;
    // they do not authorize a route.
    const first = methods[0].id;
    const compatibilityMode = first === 'oidc' ? 'oidc' : first === 'native_ad' ? 'native' : 'local';
    return NextResponse.json({
      methods,
      policySource: resolved.source,
      authMode: compatibilityMode,
      configuredAuthMode: compatibilityMode,
      availableSignInMethods: methods.map((method) => method.id),
    });
  } catch (error) {
    appLogger.error('[AuthPolicy] Failed to resolve sign-in policy', undefined, {
      error: error instanceof Error ? error.message : 'unknown',
    });
    return NextResponse.json(
      { error: 'The sign-in policy is unavailable.', methods: [] },
      { status: 503 }
    );
  }
}
