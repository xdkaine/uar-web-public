import { describe, expect, it } from 'vitest';
import { hashPassword, verifyPassword, PASSWORD_HASH_PREFIX } from './password-hash';

describe('password hashing', () => {
  it('round-trips a correct password', async () => {
    const stored = await hashPassword('Correct-Horse-9!battery');
    expect(stored.startsWith(`${PASSWORD_HASH_PREFIX}$`)).toBe(true);
    await expect(verifyPassword('Correct-Horse-9!battery', stored)).resolves.toBe(true);
  });

  it('rejects a wrong password without throwing', async () => {
    const stored = await hashPassword('Correct-Horse-9!battery');
    await expect(verifyPassword('wrong-password', stored)).resolves.toBe(false);
  });

  it('produces unique salts so identical passwords differ', async () => {
    const a = await hashPassword('Same-Password-1!');
    const b = await hashPassword('Same-Password-1!');
    expect(a).not.toEqual(b);
  });

  it('fails closed on malformed or tampered stored hashes', async () => {
    const stored = await hashPassword('Some-Valid-Pass-1!');
    const [, n, r, p, saltB64, keyB64] = stored.split('$');

    await expect(verifyPassword('x', 'not-a-valid-hash')).resolves.toBe(false);
    await expect(verifyPassword('x', 'md5$abc')).resolves.toBe(false);
    await expect(verifyPassword('x', `scrypt$abc$8$1$${saltB64}$${keyB64}`)).resolves.toBe(false);
    await expect(verifyPassword('x', `scrypt$${n}$${r}$${p}$!!!not-base64-salt!!!$${keyB64}`)).resolves.toBe(false);

    const flippedKey = Buffer.from(keyB64, 'base64');
    flippedKey[0] = flippedKey[0] ^ 0xff;
    await expect(
      verifyPassword('x', `scrypt$${n}$${r}$${p}$${saltB64}$${flippedKey.toString('base64')}`)
    ).resolves.toBe(false);
  });
});
