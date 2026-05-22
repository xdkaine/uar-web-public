import { appLogger } from './logger';

const VERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

interface TurnstileResponse {
  success: boolean;
  'error-codes': string[];
  challenge_ts?: string;
  hostname?: string;
}

/**
 * Verifies the Cloudflare Turnstile token.
 * @param token The token received from the client.
 * @returns True if the token is valid, false otherwise.
 */
export async function verifyTurnstileToken(token: string): Promise<boolean> {
  const secretKey = process.env.TURNSTILE_SECRET_KEY;

  if (!secretKey) {
    appLogger.error('TURNSTILE_SECRET_KEY is not defined');
    // Fail closed if configuration is missing
    return false;
  }

  if (!token) {
    appLogger.warn('Turnstile token is missing');
    return false;
  }

  try {
    const formData = new FormData();
    formData.append('secret', secretKey);
    formData.append('response', token);

    const result = await fetch(VERIFY_URL, {
      method: 'POST',
      body: formData,
    });

    const outcome: TurnstileResponse = await result.json();

    if (!outcome.success) {
      appLogger.warn('Turnstile verification failed', { errorCodes: outcome['error-codes'] });
      return false;
    }

    return true;
  } catch (error) {
    appLogger.error('Error verifying Turnstile token', { error });
    return false;
  }
}
