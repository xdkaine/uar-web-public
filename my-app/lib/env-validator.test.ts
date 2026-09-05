import { afterEach, describe, expect, it, vi } from 'vitest';
import { validateEnvironment } from './env-validator';

function setValidBaseEnvironment(): void {
  process.env.DATABASE_URL = 'postgresql://db:5432/portal?sslmode=require';
  process.env.SMTP_HOST = 'smtp.example.test';
  process.env.SMTP_PORT = '587';
  process.env.SMTP_USER = 'mailer';
  process.env.SMTP_PASSWORD = 'smtp-password-value';
  process.env.EMAIL_FROM = 'Portal <portal@example.test>';
  process.env.ADMIN_EMAIL = 'admin@example.test';
  process.env.LDAP_URL = 'ldaps://directory.example.test:636';
  process.env.LDAP_BIND_DN = 'CN=svc,DC=example,DC=test';
  process.env.LDAP_BIND_PASSWORD = 'bind-password-value';
  process.env.LDAP_SEARCH_BASE = 'DC=example,DC=test';
  process.env.LDAP_DOMAIN = 'example.test';
  process.env.LDAP_ADMIN_GROUPS = 'CN=Portal Admins,DC=example,DC=test';
  process.env.LDAP_GROUP2ADD = 'CN=Users,DC=example,DC=test';
  process.env.LDAP_KAMINO_INTERNAL_GROUP = 'internal';
  process.env.LDAP_KAMINO_EXTERNAL_GROUP = 'external';
  process.env.LDAP_GROUPSEARCH = 'OU=Groups,DC=example,DC=test';
  process.env.NEXT_PUBLIC_APP_URL = 'https://portal.example.test';
  process.env.NEXTAUTH_SECRET = 'a'.repeat(32);
  process.env.ENCRYPTION_SECRET = 'b'.repeat(32);
  process.env.ENCRYPTION_SALT = '0123456789abcdef0123456789abcdef01234567';
  process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY = 'site-key';
  process.env.TURNSTILE_SECRET_KEY = 'turnstile-key';
  process.env.MONITOR_PROBE_SHARED_SECRET = 'm'.repeat(32);
}

describe('validateEnvironment production secret placeholders', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it.each(['NEXTAUTH_SECRET', 'ENCRYPTION_SECRET', 'ENCRYPTION_SALT', 'CRON_SECRET']) (
    'rejects the documented placeholder for %s in production',
    (name) => {
      setValidBaseEnvironment();
      process.env = { ...process.env, NODE_ENV: 'production' };
      process.env.CRON_SECRET = 'c'.repeat(32);
      process.env[name] = `replace_with_a_${name.toLowerCase()}_at_least_32_characters`;
      expect(() => validateEnvironment()).toThrow(/Known-placeholder/);
    }
  );
});

describe('validateEnvironment database-managed configuration', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('allows directory and email environment fallbacks to be absent', () => {
    setValidBaseEnvironment();
    for (const name of [
      'SMTP_HOST', 'SMTP_PORT', 'SMTP_USER', 'SMTP_PASSWORD', 'EMAIL_FROM', 'ADMIN_EMAIL',
      'LDAP_URL', 'LDAP_BIND_DN', 'LDAP_BIND_PASSWORD', 'LDAP_SEARCH_BASE', 'LDAP_DOMAIN',
      'LDAP_ADMIN_GROUPS', 'LDAP_GROUP2ADD', 'LDAP_KAMINO_INTERNAL_GROUP',
      'LDAP_KAMINO_EXTERNAL_GROUP', 'LDAP_GROUPSEARCH',
    ]) {
      delete process.env[name];
    }

    expect(() => validateEnvironment()).not.toThrow();
  });
});

describe('validateEnvironment OIDC base URL contract', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('accepts oidc mode with an explicit browser-facing base URL', () => {
    setValidBaseEnvironment();
    process.env.AUTH_MODE = 'oidc';
    process.env.AUTH_ISSUER = 'https://auth.example.test';
    process.env.AUTH_CLIENT_SECRET = 'auth-secret';

    expect(() => validateEnvironment()).not.toThrow();
  });

  it('fails loud when oidc mode has no explicit browser-facing base URL', () => {
    setValidBaseEnvironment();
    delete process.env.NEXT_PUBLIC_APP_URL;
    delete process.env.OIDC_BROWSER_BASE_URL;
    process.env.AUTH_MODE = 'oidc';
    process.env.AUTH_ISSUER = 'https://auth.example.test';
    process.env.AUTH_CLIENT_SECRET = 'auth-secret';

    // Startup refuses to boot rather than falling back to request hosts;
    // the global required-variable gate reports the missing base URL.
    expect(() => validateEnvironment()).toThrow(/NEXT_PUBLIC_APP_URL/);
  });

  it('does not let OIDC_BROWSER_BASE_URL replace the required application URL', () => {
    setValidBaseEnvironment();
    delete process.env.NEXT_PUBLIC_APP_URL;
    process.env.OIDC_BROWSER_BASE_URL = 'http://localhost:3002';
    process.env.AUTH_MODE = 'native';

    expect(() => validateEnvironment()).toThrow(/NEXT_PUBLIC_APP_URL/);
  });
});

describe('validateEnvironment scheduler toggle contract', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
    vi.restoreAllMocks();
  });

  it.each(['LIFECYCLE_QUEUE_SCHEDULER_ENABLED', 'DIRECTORY_PROBE_ENABLED', 'WORKFLOW_TICK_ENABLED'])(
    'accepts %s=true with CRON_SECRET present',
    (toggle) => {
      setValidBaseEnvironment();
      process.env.CRON_SECRET = 'c'.repeat(32);
      process.env[toggle] = 'true';

      expect(() => validateEnvironment()).not.toThrow();
    }
  );

  it('requires a dedicated monitor-probe secret and fixed internal URL', () => {
    setValidBaseEnvironment();
    delete process.env.MONITOR_PROBE_SHARED_SECRET;
    expect(() => validateEnvironment()).toThrow(/MONITOR_PROBE_SHARED_SECRET/);

    setValidBaseEnvironment();
    process.env.MONITOR_PROBE_URL = 'https://example.test/probe';
    expect(() => validateEnvironment()).toThrow(/http:\/\/monitor-probe:8091/);
  });

  it.each(['LIFECYCLE_QUEUE_SCHEDULER_ENABLED', 'DIRECTORY_PROBE_ENABLED', 'WORKFLOW_TICK_ENABLED'])(
    'rejects %s=true without CRON_SECRET',
    (toggle) => {
      setValidBaseEnvironment();
      delete process.env.CRON_SECRET;
      process.env[toggle] = 'true';

      expect(() => validateEnvironment()).toThrow(/CRON_SECRET is required/);
    }
  );

  it.each(['LIFECYCLE_QUEUE_SCHEDULER_ENABLED', 'DIRECTORY_PROBE_ENABLED', 'WORKFLOW_TICK_ENABLED'])(
    'rejects non-boolean %s values',
    (toggle) => {
      setValidBaseEnvironment();
      process.env.CRON_SECRET = 'c'.repeat(32);
      process.env[toggle] = 'yes';

      expect(() => validateEnvironment()).toThrow(/must be either true or false/);
    }
  );

  it('accepts the documented lifecycle scheduler cadence defaults', () => {
    setValidBaseEnvironment();
    process.env.CRON_SECRET = 'c'.repeat(32);
    process.env.LIFECYCLE_QUEUE_SCHEDULER_INTERVAL_SECONDS = '300';
    process.env.LIFECYCLE_QUEUE_SCHEDULER_INITIAL_DELAY_SECONDS = '30';
    process.env.LIFECYCLE_QUEUE_SCHEDULER_HEALTH_MAX_AGE_SECONDS = '1200';

    expect(() => validateEnvironment()).not.toThrow();
  });

  it('validates the operational detector sidecar contract', () => {
    setValidBaseEnvironment();
    process.env.CRON_SECRET = 'c'.repeat(32);
    process.env.OPERATIONAL_DETECTOR_SCHEDULER_ENABLED = 'true';
    process.env.OPERATIONAL_DETECTOR_INTERVAL_SECONDS = '60';
    process.env.OPERATIONAL_DETECTOR_HEALTH_MAX_AGE_SECONDS = '300';
    expect(() => validateEnvironment()).not.toThrow();

    process.env.OPERATIONAL_DETECTOR_INTERVAL_SECONDS = '3e2';
    expect(() => validateEnvironment()).toThrow(
      /OPERATIONAL_DETECTOR_INTERVAL_SECONDS must be between 30 and 3600/
    );
  });

  it('rejects a lifecycle queue interval outside the supported range', () => {
    setValidBaseEnvironment();
    process.env.LIFECYCLE_QUEUE_SCHEDULER_INTERVAL_SECONDS = '10';

    expect(() => validateEnvironment()).toThrow(
      /LIFECYCLE_QUEUE_SCHEDULER_INTERVAL_SECONDS must be between 300 and 86400/
    );
  });

  it('rejects a lifecycle queue health max age below the floor', () => {
    setValidBaseEnvironment();
    process.env.LIFECYCLE_QUEUE_SCHEDULER_HEALTH_MAX_AGE_SECONDS = '599';

    expect(() => validateEnvironment()).toThrow(
      /LIFECYCLE_QUEUE_SCHEDULER_HEALTH_MAX_AGE_SECONDS must be between 600 and 604800/
    );
  });

  it('rejects a lifecycle queue initial delay above one hour', () => {
    setValidBaseEnvironment();
    process.env.LIFECYCLE_QUEUE_SCHEDULER_INITIAL_DELAY_SECONDS = '3601';

    expect(() => validateEnvironment()).toThrow(/between 0 and 3600/);
  });
});

describe('validateEnvironment OIDC and auth-service knob contract', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
    vi.restoreAllMocks();
  });

  it('accepts AUTH_ALLOW_INSECURE_OIDC=true but warns', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    setValidBaseEnvironment();
    process.env.AUTH_ALLOW_INSECURE_OIDC = 'true';

    expect(() => validateEnvironment()).not.toThrow();
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('AUTH_ALLOW_INSECURE_OIDC=true'));
  });

  it('rejects non-boolean AUTH_ALLOW_INSECURE_OIDC values', () => {
    setValidBaseEnvironment();
    process.env.AUTH_ALLOW_INSECURE_OIDC = '1';

    expect(() => validateEnvironment()).toThrow(
      /AUTH_ALLOW_INSECURE_OIDC must be either true or false/
    );
  });

  it.each(['300', '28800', '1209600'])('accepts OIDC session max age %s', (value) => {
    setValidBaseEnvironment();
    process.env.AUTH_OIDC_SESSION_MAX_AGE = value;

    expect(() => validateEnvironment()).not.toThrow();
  });

  it.each(['299', '1209601', 'not-a-number'])(
    'rejects OIDC session max age %s',
    (value) => {
      setValidBaseEnvironment();
      process.env.AUTH_OIDC_SESSION_MAX_AGE = value;

      expect(() => validateEnvironment()).toThrow(/AUTH_OIDC_SESSION_MAX_AGE/);
    },
  );

  it('rejects an OIDC_INTERNAL_ISSUER_URL without an http(s) scheme', () => {
    setValidBaseEnvironment();
    process.env.OIDC_INTERNAL_ISSUER_URL = 'auth-service:3003';

    expect(() => validateEnvironment()).toThrow(
      /OIDC_INTERNAL_ISSUER_URL must start with http:\/\/ or https:\/\//
    );
  });

  it('accepts the compose-default internal issuer mirror', () => {
    setValidBaseEnvironment();
    process.env.OIDC_INTERNAL_ISSUER_URL = 'http://auth-service:3003';

    expect(() => validateEnvironment()).not.toThrow();
  });

  it('accepts in-range auth login rate limit knobs', () => {
    setValidBaseEnvironment();
    process.env.AUTH_LOGIN_WINDOW_MS = '60000';
    process.env.AUTH_LOGIN_MAX_ATTEMPTS = '10';

    expect(() => validateEnvironment()).not.toThrow();
  });

  it('rejects AUTH_LOGIN_WINDOW_MS below one second', () => {
    setValidBaseEnvironment();
    process.env.AUTH_LOGIN_WINDOW_MS = '999';

    expect(() => validateEnvironment()).toThrow(/AUTH_LOGIN_WINDOW_MS must be between 1000 and 3600000/);
  });

  it('rejects a non-integer AUTH_LOGIN_MAX_ATTEMPTS', () => {
    setValidBaseEnvironment();
    process.env.AUTH_LOGIN_MAX_ATTEMPTS = '20.5';

    expect(() => validateEnvironment()).toThrow(/AUTH_LOGIN_MAX_ATTEMPTS must be between 1 and 1000/);
  });

  it('rejects AUTH_LOGIN_MAX_ATTEMPTS of zero', () => {
    setValidBaseEnvironment();
    process.env.AUTH_LOGIN_MAX_ATTEMPTS = '0';

    expect(() => validateEnvironment()).toThrow(/AUTH_LOGIN_MAX_ATTEMPTS must be between 1 and 1000/);
  });

  it('accepts the shared account lock and guarded OIDC outage policy', () => {
    setValidBaseEnvironment();
    process.env.AUTH_MODE = 'oidc';
    process.env.AUTH_ISSUER = 'https://auth.example.test';
    process.env.AUTH_CLIENT_SECRET = 'c'.repeat(32);
    process.env.OIDC_BROWSER_BASE_URL = 'https://auth.example.test';
    process.env.AUTH_OIDC_OUTAGE_FALLBACK = 'native_and_local';
    process.env.OIDC_INTERNAL_ISSUER_URL = 'http://auth-service:3003';
    process.env.AUTH_ACCOUNT_LOCK_WINDOW_MS = '900000';
    process.env.AUTH_ACCOUNT_LOCK_MAX_ATTEMPTS = '5';

    expect(() => validateEnvironment()).not.toThrow();
  });

  it.each(['off', 'native', 'local', 'native_and_local'])(
    'accepts AUTH_OIDC_ALTERNATE_SIGNIN=%s',
    (policy) => {
      setValidBaseEnvironment();
      process.env.AUTH_OIDC_ALTERNATE_SIGNIN = policy;

      expect(() => validateEnvironment()).not.toThrow();
    }
  );

  it('rejects an unknown healthy-state alternate sign-in policy', () => {
    setValidBaseEnvironment();
    process.env.AUTH_OIDC_ALTERNATE_SIGNIN = 'always';

    expect(() => validateEnvironment()).toThrow(/AUTH_OIDC_ALTERNATE_SIGNIN/);
  });

  it('rejects outage fallback without an internal issuer mirror', () => {
    setValidBaseEnvironment();
    process.env.AUTH_MODE = 'oidc';
    process.env.AUTH_ISSUER = 'https://auth.example.test';
    process.env.AUTH_CLIENT_SECRET = 'c'.repeat(32);
    process.env.OIDC_BROWSER_BASE_URL = 'https://auth.example.test';
    process.env.AUTH_OIDC_OUTAGE_FALLBACK = 'native_and_local';
    delete process.env.OIDC_INTERNAL_ISSUER_URL;

    expect(() => validateEnvironment()).toThrow(/OIDC_INTERNAL_ISSUER_URL is required/);
  });

  it('rejects invalid outage fallback and account-lock settings', () => {
    setValidBaseEnvironment();
    process.env.AUTH_OIDC_OUTAGE_FALLBACK = 'always';
    expect(() => validateEnvironment()).toThrow(/AUTH_OIDC_OUTAGE_FALLBACK must be off or native_and_local/);

    process.env.AUTH_OIDC_OUTAGE_FALLBACK = 'off';
    process.env.AUTH_ACCOUNT_LOCK_MAX_ATTEMPTS = '0';
    expect(() => validateEnvironment()).toThrow(/AUTH_ACCOUNT_LOCK_MAX_ATTEMPTS must be between 1 and 100/);
  });
});

describe('validateEnvironment asset shared secret contract', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
    vi.restoreAllMocks();
  });

  it('accepts exactly 64 lowercase hex characters and stays empty-optional', () => {
    setValidBaseEnvironment();
    process.env.ASSET_SHARED_SECRET = 'a'.repeat(64);
    expect(() => validateEnvironment()).not.toThrow();

    delete process.env.ASSET_SHARED_SECRET;
    expect(() => validateEnvironment()).not.toThrow();
  });

  it('rejects uppercase hex, short secrets, and sed-hostile characters', () => {
    setValidBaseEnvironment();

    process.env.ASSET_SHARED_SECRET = 'A'.repeat(64);
    expect(() => validateEnvironment()).toThrow(/64 lowercase hex characters/);

    process.env.ASSET_SHARED_SECRET = 'a'.repeat(63);
    expect(() => validateEnvironment()).toThrow(/64 lowercase hex characters/);

    process.env.ASSET_SHARED_SECRET = `${'a'.repeat(63)}&`;
    expect(() => validateEnvironment()).toThrow(/64 lowercase hex characters/);

    process.env.ASSET_SHARED_SECRET =
      'replace_with_a_random_asset_store_shared_secret_at_least_32_characters';
    expect(() => validateEnvironment()).toThrow(/64 lowercase hex characters/);
  });
});

describe('validateEnvironment auth client-secret encryption key contract', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
    vi.restoreAllMocks();
  });

  it('accepts exactly 64 lowercase hex characters and stays empty-optional', () => {
    setValidBaseEnvironment();
    process.env.AUTH_CLIENT_SECRET_ENC_KEY = 'f'.repeat(64);
    expect(() => validateEnvironment()).not.toThrow();

    delete process.env.AUTH_CLIENT_SECRET_ENC_KEY;
    expect(() => validateEnvironment()).not.toThrow();
  });

  it('rejects malformed keys following the ASSET_SHARED_SECRET convention', () => {
    setValidBaseEnvironment();

    process.env.AUTH_CLIENT_SECRET_ENC_KEY = 'F'.repeat(64);
    expect(() => validateEnvironment()).toThrow(
      /AUTH_CLIENT_SECRET_ENC_KEY must be exactly 64 lowercase hex characters/
    );

    process.env.AUTH_CLIENT_SECRET_ENC_KEY = 'f'.repeat(63);
    expect(() => validateEnvironment()).toThrow(
      /AUTH_CLIENT_SECRET_ENC_KEY must be exactly 64 lowercase hex characters/
    );

    process.env.AUTH_CLIENT_SECRET_ENC_KEY = 'not-a-key';
    expect(() => validateEnvironment()).toThrow(
      /AUTH_CLIENT_SECRET_ENC_KEY must be exactly 64 lowercase hex characters/
    );
  });
});

describe('validateEnvironment portal OIDC chooser copy', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
    vi.restoreAllMocks();
  });

  it('accepts bounded plain-text display copy', () => {
    setValidBaseEnvironment();
    process.env.AUTH_OIDC_DISPLAY_NAME = 'Campus Auth';
    process.env.AUTH_OIDC_DISPLAY_DESCRIPTION = 'Continue to the campus identity service.';
    expect(() => validateEnvironment()).not.toThrow();
  });

  it('rejects overlong or control-bearing display copy', () => {
    setValidBaseEnvironment();
    process.env.AUTH_OIDC_DISPLAY_NAME = 'x'.repeat(81);
    expect(() => validateEnvironment()).toThrow(/AUTH_OIDC_DISPLAY_NAME/);

    process.env.AUTH_OIDC_DISPLAY_NAME = 'Campus Auth';
    process.env.AUTH_OIDC_DISPLAY_DESCRIPTION = 'unsafe\ncopy';
    expect(() => validateEnvironment()).toThrow(/AUTH_OIDC_DISPLAY_DESCRIPTION/);
  });
});
