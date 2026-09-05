import { X509Certificate } from 'node:crypto';

const PEM_CERTIFICATE_PATTERN = /-----BEGIN CERTIFICATE-----[\s\S]+-----END CERTIFICATE-----/;

export function parseLDAPCACertificate(encodedCertificate?: string): string | undefined {
  if (!encodedCertificate?.trim()) {
    return undefined;
  }

  const normalized = encodedCertificate.trim();
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(normalized) || normalized.length % 4 !== 0) {
    throw new Error('LDAP_CA_CERT_BASE64 must be valid base64');
  }

  const certificate = Buffer.from(normalized, 'base64').toString('utf8').trim();
  if (!PEM_CERTIFICATE_PATTERN.test(certificate)) {
    throw new Error('LDAP_CA_CERT_BASE64 must decode to a PEM certificate');
  }

  try {
    new X509Certificate(certificate);
  } catch {
    throw new Error('LDAP_CA_CERT_BASE64 must decode to a valid X.509 certificate');
  }

  return certificate;
}
