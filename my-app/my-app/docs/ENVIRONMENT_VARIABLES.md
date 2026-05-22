# Environment Variables

This document outlines the environment variables required to run the UAR Portal.

## Authentication

| Variable | Description | Required |
| :--- | :--- | :--- |
| `NEXTAUTH_SECRET` | A 64-character hex string used to sign session cookies. Generate with `openssl rand -hex 32`. | Yes |

## Encryption

Used for encrypting sensitive data at rest (e.g., stored passwords).

| Variable | Description | Required |
| :--- | :--- | :--- |
| `ENCRYPTION_SECRET` | A 64-character hex string. | Yes |
| `ENCRYPTION_SALT` | A 64-character hex string. | Yes |
 
 ## Cloudflare Turnstile
 
 Required for protecting public forms.
 
 | Variable | Description | Required |
 | :--- | :--- | :--- |
 | `NEXT_PUBLIC_TURNSTILE_SITE_KEY` | The Site Key from Cloudflare Turnstile dashboard. | Yes |
 | `TURNSTILE_SECRET_KEY` | The Secret Key from Cloudflare Turnstile dashboard. | Yes |

## Database & Cache

| Variable | Description | Required |
| :--- | :--- | :--- |
| `DATABASE_URL` | PostgreSQL connection string. Must include `sslmode=require`. Example: `postgresql://user:pass@localhost:5432/uar?sslmode=require` | Yes |
| `REDIS_URL` | Redis connection string. Example: `redis://localhost:6379`. If omitted, falls back to in-memory (not for prod). | No |
| `REDIS_TOKEN` | Upstash Redis token (if using Upstash). | No |

## Proxy Headers

| Variable | Description | Required |
| :--- | :--- | :--- |
| `TRUST_PROXY_HEADERS` | Set to `true` only in production deployments behind a trusted reverse proxy that strips inbound `X-Forwarded-For`/`X-Real-IP` headers and sets canonical forwarding headers. Leave `false` when the app port is exposed directly. | No |

## Session Cookies

| Variable | Description | Required |
| :--- | :--- | :--- |
| `SESSION_COOKIE_ALLOW_INSECURE` | Set to `true` only when intentionally serving the production app over plain HTTP. This removes the `Secure` flag from session and CSRF cookies so browsers will send them back over HTTP. Keep `false` for HTTPS deployments. | No |

## LDAP Configuration

Required for Active Directory integration.

| Variable | Description | Required |
| :--- | :--- | :--- |
| `LDAP_HOST` | URL of the LDAP server (e.g., `ldap://ad.example.com` or `ldaps://...`). | Yes |
| `LDAP_BASE_DN` | Base DN for searches (e.g., `dc=example,dc=com`). | Yes |
| `LDAP_BIND_DN` | DN of the service account used to bind/query LDAP. | Yes |
| `LDAP_BIND_PASSWORD` | Password for the bind account. | Yes |
| `LDAP_USER_BASE` | OU where users are located (e.g., `ou=users,dc=example,dc=com`). | Yes |
| `LDAP_ADMIN_GROUP` | DN of the group that grants admin access to the portal. | Yes |
| `LDAP_TIMEOUT` | Timeout in milliseconds (default: `30000`). | No |
| `LDAP_MAX_RETRIES` | Number of retries for failed operations (default: `3`). | No |

## Email (SMTP)

Used for sending notifications.

| Variable | Description | Required |
| :--- | :--- | :--- |
| `SMTP_HOST` | Hostname of the SMTP server. | Yes |
| `SMTP_PORT` | Port for the SMTP server (e.g., `587`). | Yes |
| `SMTP_USER` | Username for SMTP authentication. | Yes |
| `SMTP_PASSWORD` | Password for SMTP authentication. | Yes |
| `EMAIL_FROM` | Email address to send from (e.g., `noreply@example.com`). | Yes |
| `ADMIN_EMAIL` | Email address to receive admin notifications. | Yes |

## Application Settings

| Variable | Description | Required |
| :--- | :--- | :--- |
| `NEXT_PUBLIC_APP_URL` | The public URL of the application (e.g., `https://portal.example.com`). | Yes |
| `CRON_SECRET` | Bearer token required by cron processing endpoints, including lifecycle and mass email queues. | Yes for scheduled processing |
| `NODE_ENV` | `development` or `production`. | Yes |
