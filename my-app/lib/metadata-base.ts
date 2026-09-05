const DEFAULT_METADATA_BASE = 'https://portal.calpolysoc.org';

export function getMetadataBase(configuredUrl: string | undefined): URL {
  const value = configuredUrl || DEFAULT_METADATA_BASE;
  if (!URL.canParse(value)) {
    // Keep invalid deployment configuration visible without echoing its value.
    throw new Error('Invalid NEXT_PUBLIC_APP_URL: metadata requires an absolute URL');
  }
  return new URL(value);
}
