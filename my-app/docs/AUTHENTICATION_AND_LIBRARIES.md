# Authentication & Libraries

This document details the authentication mechanisms and key libraries used in the UAR Portal.

## 🔐 Authentication System

The application uses a **custom session-based authentication system** designed for security and strict control over administrative access.

### Session Management

Sessions are managed server-side using the database and client-side using secure HTTP-only cookies.

*   **Storage**: Session data is stored in the PostgreSQL database (`Session` model).
*   **Cookies**: A secure, HTTP-only cookie (`session_token`) stores the session token.
*   **Timeouts**:
    *   **Native AD and local admin sessions**: 30 minutes absolute timeout by default.
    *   **OIDC/SSO portal sessions**: bounded by the signed upstream provider-session expiry and an independent portal cap (`AUTH_OIDC_SESSION_MAX_AGE`, 8 hours by default). Their idle window follows that effective expiry, and provider logout can end them sooner.
    *   **User Sessions**: 60 minutes absolute timeout.
    *   **Idle Timeout**: 15 minutes for native AD, local break-glass, and ordinary user sessions; OIDC/SSO uses its effective provider-bounded expiry.
*   **Security Flags**:
    *   `httpOnly`: Prevents JavaScript access to the cookie (mitigates XSS).
    *   `secure`: Requires HTTPS (in production).
    *   `sameSite: strict`: Prevents CSRF attacks.

### Admin Authentication Flow

1.  **Login**: Admin submits credentials to `/api/auth/login`.
2.  **LDAP Verification**: The system authenticates the user against Active Directory using `ldapts`.
3.  **Group Check**: It verifies if the user is a member of the configured Admin Group (`LDAP_ADMIN_GROUP`).
4.  **Session Creation**: If valid, a session record is created in the DB, and a cookie is set.
5.  **Route Protection**: Admin routes use `checkAdminAuthWithRateLimit()` to verify the session and admin status on every request.

### Required Password Change Flow

Some Active Directory accounts can have a valid current password but still be blocked from logon until a new password is set. The login route detects AD bind diagnostic subcodes for this state, especially `data 773` (must change password) and `data 532` (password expired), and returns a structured password-change challenge instead of creating a session.

The browser stays on `/login` and posts the current temporary password plus the new password to `/api/auth/complete-required-password-change`. That endpoint validates a short-lived HTTP-only `password_change_challenge` cookie, applies the standard password policy, re-checks the current password against AD, changes the LDAP password, clears `pwdLastSet` with `-1`, and only then creates the normal portal session. Invalid credentials, disabled accounts (`533`), and locked accounts (`775`) do not receive this branch.

This supplements the existing onboarding and reset systems. New internal users still use `/account/activate`; token-based password reset still uses `/reset-password`.

### Rate Limiting

To protect against brute-force and DoS attacks, the system implements rate limiting using Redis (or in-memory fallback).

*   **Login Endpoints**: Strict limits (e.g., 5 attempts per minute).
*   **Admin Operations**: Higher limits (e.g., 100 requests per minute) to allow normal usage while preventing abuse.
*   **Public Forms**: Limits on request submission (e.g., 3 per hour) to prevent spam.

---

## 📚 Key Libraries & Tools

### Core Infrastructure

*   **[Next.js 16](https://nextjs.org/)**: The React framework for the application. Uses the App Router for modern routing and server components.
*   **[Prisma](https://www.prisma.io/)**: Next-generation ORM for PostgreSQL. It provides type-safe database access and schema management.
*   **[Tailwind CSS 4](https://tailwindcss.com/)**: Utility-first CSS framework for styling.

### Security & Identity

*   **[ldapts](https://github.com/ldapts/ldapts)**: A modern TypeScript LDAP client used for communicating with Active Directory.
*   **[bcryptjs](https://www.npmjs.com/package/bcryptjs)**: Used for hashing passwords before storage (for local accounts, if any) or verification.
*   **[react-turnstile](https://www.npmjs.com/package/react-turnstile)**: Cloudflare Turnstile integration for protecting public forms (Login, Request, Forgot Password) from bots without CAPTCHA puzzles.
*   **Timing Safe Compare**: Custom implementation (`lib/timing-safe.ts`) for constant-time string comparison, compatible with Edge Runtime.
*   **Node.js Crypto**: Built-in `crypto` module is used for AES-256-GCM encryption of sensitive data (like stored passwords) and generating secure tokens.

### Utilities

*   **[Nodemailer](https://nodemailer.com/)**: The module for sending emails (verification, notifications).
*   **[Winston](https://github.com/winstonjs/winston)**: A versatile logging library used for application logging.
*   **[Upstash Redis](https://upstash.com/)**: Used for serverless-friendly Redis connections (caching and rate limiting).

### Validation

*   **Custom Validation**: The project uses a custom validation suite (`lib/validation.ts`) instead of a heavy library like Zod. This includes:
    *   Request body size limits.
    *   String length and format validation.
    *   Input sanitization.
