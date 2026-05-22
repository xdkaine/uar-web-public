import { NextRequest, NextResponse } from 'next/server';
import { checkAdminAuthWithRateLimit } from '@/lib/adminAuth';
import { generateStrongPassword } from '@/lib/password';
import { secureJsonResponse } from '@/lib/apiResponse';

/**
 * Generate Password API Endpoint
 * 
 * Generates a secure, user-friendly password using the server-side generator.
 * This ensures consistency across all password generation in the application.
 * 
 * Pattern: WordWordWordNumberNumberSpecialCharacterSpecialCharacter
 * Example: FlameReadyVision42$@
 */
export async function GET(request: NextRequest) {
  try {
    const { admin, response } = await checkAdminAuthWithRateLimit(request);

    if (!admin || response) {
      return response || NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Generate a secure password
    const password = generateStrongPassword();

    return secureJsonResponse({ password }, 200);
  } catch (error) {
    console.error('Error generating password:', error);
    return NextResponse.json(
      { error: 'Failed to generate password' },
      { status: 500 }
    );
  }
}
