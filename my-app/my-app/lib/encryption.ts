import { createCipheriv, createDecipheriv, randomBytes, scryptSync, timingSafeEqual } from 'crypto';

/**
 * Password Encryption Utility
 * 
 * This module provides functions to encrypt and decrypt sensitive passwords before storing them in the database.
 * Uses AES-256-GCM for authenticated encryption to prevent tampering.
 * 
 * Security Notes:
 * - ENCRYPTION_SECRET must be set in environment variables (min 32 characters recommended)
 * - Each encryption uses a unique IV (Initialization Vector)
 * - GCM mode provides authentication, preventing tampering
 * - Passwords should still be cleared after account creation when possible
 */

const ALGORITHM = 'aes-256-gcm';

/**
 * Validates entropy of salt to ensure it's not predictable
 * Checks for basic entropy by ensuring diverse character usage
 */
function validateSaltEntropy(salt: string): boolean {
  // Check for at least 4 different characters (basic entropy check)
  const uniqueChars = new Set(salt.split(''));
  if (uniqueChars.size < 8) {
    return false;
  }
  
  // Check that it's not all the same character repeated
  const firstChar = salt[0];
  if (salt.split('').every(c => c === firstChar)) {
    return false;
  }
  
  // Check for common weak patterns
  const weakPatterns = [
    /^0+$/, // All zeros
    /^1+$/, // All ones
    /^(abc)+$/i, // Repeated 'abc'
    /^(123)+$/, // Repeated '123'
    /^(password)+$/i, // Contains 'password'
  ];
  
  return !weakPatterns.some(pattern => pattern.test(salt));
}

/**
 * Get the encryption key derived from the secret.
 * Uses scrypt for key derivation which is intentionally slow to prevent brute force.
 */
function getEncryptionKey(): Buffer {
  const secret = process.env.ENCRYPTION_SECRET;
  const salt = process.env.ENCRYPTION_SALT;
  
  if (!secret || secret.length < 32) {
    throw new Error(
      'ENCRYPTION_SECRET must be set in environment variables and be at least 32 characters long. ' +
      'Generate a strong secret with: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"'
    );
  }
  
  if (!salt || salt.length < 32) {
    throw new Error(
      'ENCRYPTION_SALT must be set in environment variables and be at least 32 characters long (64 hex characters recommended). ' +
      'Generate a strong salt with: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"'
    );
  }
  
  // Validate salt entropy
  if (!validateSaltEntropy(salt)) {
    throw new Error(
      'ENCRYPTION_SALT has insufficient entropy. Use a cryptographically random value. ' +
      'Generate with: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"'
    );
  }
  
  // Derive a 32-byte key from the secret using the salt
  return scryptSync(secret, salt, 32);
}

/**
 * Encrypts a password for secure storage in the database.
 * 
 * @param password - The plaintext password to encrypt
 * @returns Encrypted string in format: iv:authTag:encrypted (all hex encoded)
 * @throws {Error} If encryption fails or ENCRYPTION_SECRET is not configured
 * 
 * @example
 * const encrypted = encryptPassword('MySecurePassword123!');
 * // Returns: "a1b2c3d4....:e5f6g7h8....:i9j0k1l2...."
 */
export function encryptPassword(password: string): string {
  if (!password || typeof password !== 'string') {
    throw new Error('Password must be a non-empty string');
  }
  
  try {
    const key = getEncryptionKey();
    const iv = randomBytes(16); // Generate random IV for each encryption
    const cipher = createCipheriv(ALGORITHM, key, iv);
    
    let encrypted = cipher.update(password, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    
    const authTag = cipher.getAuthTag();
    
    // Return format: iv:authTag:encrypted (all in hex)
    return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted}`;
  } catch (error) {
    console.error('[Encryption] Failed to encrypt password:', error);
    throw new Error('Failed to encrypt password. Check ENCRYPTION_SECRET configuration.');
  }
}

/**
 * Decrypts a password from the database.
 * 
 * @param encryptedPassword - The encrypted string from the database (iv:authTag:encrypted format)
 * @returns The original plaintext password
 * @throws {Error} If decryption fails (wrong key, tampered data, or invalid format)
 * 
 * @example
 * const plaintext = decryptPassword('a1b2c3d4....:e5f6g7h8....:i9j0k1l2....');
 * // Returns: "MySecurePassword123!"
 */
export function decryptPassword(encryptedPassword: string): string {
  if (!encryptedPassword || typeof encryptedPassword !== 'string') {
    throw new Error('Encrypted password must be a non-empty string');
  }
  
  try {
    const parts = encryptedPassword.split(':');
    
    if (parts.length !== 3) {
      throw new Error('Invalid encrypted password format. Expected format: iv:authTag:encrypted');
    }
    
    const [ivHex, authTagHex, encrypted] = parts;
    
    const key = getEncryptionKey();
    const iv = Buffer.from(ivHex, 'hex');
    const authTag = Buffer.from(authTagHex, 'hex');
    const decipher = createDecipheriv(ALGORITHM, key, iv);
    
    decipher.setAuthTag(authTag);
    
    let decrypted = decipher.update(encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    
    return decrypted;
  } catch (error) {
    console.error('[Encryption] Failed to decrypt password:', error);
    throw new Error('Failed to decrypt password. Data may be corrupted or key may have changed.');
  }
}

/**
 * Validates that a string is properly encrypted (correct format).
 * Does NOT attempt decryption.
 * 
 * @param value - The string to validate
 * @returns true if the format matches encrypted password format
 */
export function isEncryptedFormat(value: string): boolean {
  if (!value || typeof value !== 'string') {
    return false;
  }
  
  const parts = value.split(':');
  if (parts.length !== 3) {
    return false;
  }
  
  // Check if all parts are valid hex strings
  const hexRegex = /^[0-9a-f]+$/i;
  return parts.every(part => part.length > 0 && hexRegex.test(part));
}

/**
 * Safely compares two strings for equality using a constant-time algorithm.
 * Prevents timing attacks where an attacker could guess the string character by character.
 * 
 * @param a - First string
 * @param b - Second string
 * @returns true if strings are identical
 */
export function timingSafeCompare(a: string, b: string): boolean {
  if (!a || !b || a.length !== b.length) {
    return false;
  }
  
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  
  if (bufA.length !== bufB.length) {
    return false;
  }
  
  return timingSafeEqual(bufA, bufB);
}

/**
 * Safely compares two encrypted passwords for equality without decrypting.
 * Uses constant-time comparison to prevent timing attacks.
 * 
 * @param encrypted1 - First encrypted password
 * @param encrypted2 - Second encrypted password
 * @returns true if both encrypted values are identical
 */
export function compareEncryptedPasswords(encrypted1: string, encrypted2: string): boolean {
  if (!encrypted1 || !encrypted2) {
    return false;
  }
  
  return timingSafeCompare(encrypted1, encrypted2);
}
