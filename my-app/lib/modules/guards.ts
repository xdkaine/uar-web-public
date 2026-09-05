import { NextResponse } from 'next/server';
import { isModuleEnabled } from './core';

export const MODULE_DISABLED_ERROR_CODE = 'MODULE_DISABLED';

/**
 * Route guard for module-gated endpoints. Returns a consistent 503 response
 * when the module is disabled, or null when the caller may proceed.
 */
export async function requireModuleEnabled(
  moduleId: string
): Promise<NextResponse | null> {
  if (await isModuleEnabled(moduleId)) {
    return null;
  }
  return NextResponse.json(
    {
      error: `The ${moduleId} capability is currently disabled.`,
      code: MODULE_DISABLED_ERROR_CODE,
      moduleId,
    },
    { status: 503 }
  );
}
