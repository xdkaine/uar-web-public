# Developer Guide

This guide provides an in-depth look at the UAR Portal's architecture, database schema, and key implementation details. It is intended for developers who need to understand the inner workings of the system.

## 🗄️ Database Schema (Prisma)

The application uses **PostgreSQL** with **Prisma ORM**. The connection requires SSL (`sslmode=require`) to ensure secure communication with the database. Below is a detailed breakdown of the core models.

### Core Models

#### `AccessRequest`
The central model tracking a user's request for access.
*   **Status Workflow**: `pending_verification` -> `pending_student_directors` -> `pending_faculty` -> `approved`.
*   **Key Fields**:
    *   `isInternal`: Boolean distinguishing CPP students from external visitors.
    *   `verificationToken`: Unique token for email verification.
    *   `ldapUsername`: The AD username (populated after creation/linking).
    *   `vpnUsername`: The VPN username (populated after provisioning).
    *   `isGrandfatheredAccount`: Flag for existing AD accounts being linked to a new request.

#### `Event`
Represents workshops or events that external users can request access for.
*   **Fields**: `name`, `description`, `endDate`, `isActive`.
*   **Relation**: One-to-Many with `AccessRequest`.

#### `Session`
Manages custom server-side sessions for admins and users.
*   **Fields**: `tokenHash` (SHA-256), `username`, `isAdmin`, `expiresAt`.
*   **Security**: Tokens are hashed before storage; raw tokens are only held in the user's cookie.

#### `AuditLog`
Immutable record of administrative actions.
*   **Fields**: `action`, `category`, `username`, `targetId`, `details` (JSON), `ipAddress`.
*   **Usage**: All write operations in the admin dashboard generate an audit log entry.

### Account Lifecycle Models

#### `VPNAccount`
Represents a standalone VPN account (independent of a specific request in some cases).
*   **Fields**: `username`, `portalType` (Management/Limited/External), `status`.
*   **History**: Tracks revocation and restoration via `VPNAccountStatusLog`.

#### `AccountLifecycleAction`
Tracks asynchronous operations like disabling/enabling accounts.
*   **Purpose**: Allows long-running tasks (like batch disabling) to be tracked and audited.
*   **Fields**: `actionType`, `status`, `scheduledFor`, `rollbackData`.

---

## 🔐 LDAP Integration (`lib/ldap.ts`)

The application interacts with Active Directory using the `ldapts` library.

### Connection Handling
*   **Client Creation**: A new `Client` is instantiated for each operation to ensure fresh connections.
*   **Binding**: The app binds using a service account (`LDAP_BIND_DN`) for all operations.
*   **Security**: Enforces `ldaps://` (SSL) for secure communication.

### Key Operations
1.  **Authentication**:
    *   Binds as the specific user to verify credentials.
    *   Checks `memberOf` attribute to verify Admin Group membership.
2.  **User Search**:
    *   Uses `sAMAccountName` filter.
    *   Retrieves the attributes required by each operation, including immutable `objectGUID` evidence for governed mutations.
3.  **Account Creation**:
    *   Creates user in the specified `LDAP_USER_BASE`.
    *   Sets `userAccountControl` to `514` (Disabled) initially, then enables it.
    *   Enabled accounts use `userAccountControl` `512`, allowing the Active Directory domain password-expiration policy to apply.
    *   Adds user to the default group (`LDAP_GROUP2ADD`).
4.  **Password Management**:
    *   Uses `unicodePwd` attribute (requires active SSL connection).
    *   Passwords are quoted and UTF-16LE encoded before sending to AD.

### Safety Mechanisms
*   **Input Sanitization**: `escapeLDAPFilter()` prevents LDAP injection attacks.
*   **Timeouts**: All operations are wrapped in a `withTimeout` helper.
*   **Retries**: Transient failures trigger a retry with exponential backoff.

---

## 📧 Email System (`lib/email.ts`)

Emails are sent using `nodemailer` with SMTP.

### Architecture
*   **Transporter**: A singleton SMTP transporter is created.
*   **Templates**: HTML strings are generated dynamically based on input data.
*   **Configuration**: Uses `SystemSettings` from the DB to determine `from` address and admin recipients.

### Key Email Types
*   **Verification**: Contains a link with a unique token.
*   **Admin Notification**: Alerts student directors of new verified requests.
*   **Faculty Notification**: Asks faculty to approve a request.
*   **Approval/Rejection**: Notifies the user of the final decision.

---

## 🖥️ Frontend Architecture

### Admin Dashboard Pattern
The admin dashboard (`/admin`) is built using a **Tab Pattern**.
*   **Parent Page**: `app/admin/page.tsx` manages the active tab state.
*   **Tab Components**: Each feature (Requests, Users, Logs) is a separate component in `components/admin/`.
*   **Data Fetching**: Tabs fetch their own data via `useEffect` on mount.
*   **State Management**: Local state (`useState`) handles filters, sorting, and pagination within the tab.

### Hooks
*   **`useToast`**: Provides a global toast notification system.
*   **`useAdminPageTracking`**: Logs admin navigation events for audit purposes.

### Security on Frontend
*   **CSRF**: Custom `fetchWithCsrf` utility automatically handles CSRF tokens for non-GET requests.
*   **Role Checks**: UI elements are conditionally rendered based on admin status (though the real security is on the API).

---

## ⚙️ Backend Architecture

### API Route Structure
*   **Standardized Responses**: JSON responses with consistent error formats.
*   **Middleware**: `middleware.ts` handles CSRF token generation and validation globally.

### Request Processing Flow (`/api/request`)
1.  **Validation**: Zod/Custom validation checks input length and format.
2.  **Rate Limiting**: Redis-based rate limiter checks IP/Email limits.
3.  **Turnstile**: Verifies the Cloudflare Turnstile token.
4.  **Business Logic**: Checks for duplicate requests or blocked emails.
5.  **Persistence**: Creates `AccessRequest` in DB with `pending_verification` status.
6.  **Notification**: Sends verification email.

### Error Handling
*   **Global Catch**: API routes wrap logic in `try/catch` blocks.
*   **Logging**: Errors are logged via `winston` (`lib/logger.ts`) before returning a generic error message to the client.
