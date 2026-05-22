let insecureCookieOverrideWarningLogged = false;

export function shouldUseSecureCookies(): boolean {
  const allowInsecure =
    process.env.SESSION_COOKIE_ALLOW_INSECURE === 'true';

  if (allowInsecure) {
    if (process.env.NODE_ENV === 'production' && !insecureCookieOverrideWarningLogged) {
      console.warn(
        '[Cookies] SESSION_COOKIE_ALLOW_INSECURE=true; auth cookies will be sent over HTTP. Use only for trusted internal deployments without TLS.'
      );
      insecureCookieOverrideWarningLogged = true;
    }

    return false;
  }

  return true;
}