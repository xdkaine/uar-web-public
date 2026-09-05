import { createHash, generateKeyPairSync } from 'node:crypto';

const { publicKey, privateKey } = generateKeyPairSync('rsa', {
  modulusLength: 3072,
  publicKeyEncoding: { type: 'spki', format: 'jwk' },
  privateKeyEncoding: { type: 'pkcs8', format: 'jwk' },
});

const canonical = JSON.stringify({ e: publicKey.e, kty: 'RSA', n: publicKey.n });
const kid = createHash('sha256').update(canonical).digest('base64url');

process.stdout.write(`${JSON.stringify({
  keys: [{
    kty: 'RSA',
    kid,
    use: 'sig',
    alg: 'RS256',
    ...publicKey,
    ...privateKey,
  }],
})}\n`);
