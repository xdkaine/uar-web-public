# UAR Web Application - Complete System Overview

> **UAR (User Access Request)** is a comprehensive account provisioning and management system for handling LDAP/Active Directory accounts, VPN access, support tickets, and administrative workflows.

---

## High-Level Architecture

```mermaid
flowchart TB
    subgraph Client["Client Layer"]
        Browser["Web Browser"]
    end
    
    subgraph NextJS["Next.js Application"]
        Pages["Pages (App Router)"]
        Components["React Components"]
        Middleware["Middleware (Auth/CSRF)"]
        API["API Routes"]
        Hooks["Custom Hooks"]
    end
    
    subgraph External["External Services"]
        LDAP["LDAP/Active Directory"]
        SMTP["SMTP Server"]
        Turnstile["Cloudflare Turnstile"]
    end
    
    subgraph Data["Data Layer"]
        Prisma["Prisma ORM"]
        PostgreSQL["PostgreSQL Database"]
    end
    
    Browser --> Pages
    Pages --> Components
    Pages --> API
    Middleware --> API
    API --> Prisma
    Prisma --> PostgreSQL
    API --> LDAP
    API --> SMTP
    Pages --> Turnstile
```

---

## Technology Stack

| Layer | Technology |
|-------|------------|
| Frontend | Next.js 14+, React, TypeScript, Tailwind CSS |
| UI Components | Shadcn UI |
| Backend | Next.js API Routes |
| Database | PostgreSQL with Prisma ORM |
| Authentication | Session-based with LDAP integration |
| Security | CSRF protection, Rate limiting, Audit logging |
| Email | Nodemailer with SMTP |
| Captcha | Cloudflare Turnstile |

---

## User Flow Diagrams

### Access Request Flow (Public Users)

```mermaid
flowchart LR
    A["Home Page"] --> B{"User Type?"}
    B -->|Internal| C["Internal Request Form"]
    B -->|External| D["External Request Form"]
    C --> E["Submit with Turnstile"]
    D --> E
    E --> F["Email Verification"]
    F --> G["Verify Token"]
    G --> H{"Verified?"}
    H -->|Yes| I["Director Review"]
    H -->|No| J["Error Page"]
    I --> K{"Approved?"}
    K -->|Yes| L["Account Creation"]
    K -->|No| M["Rejection Email"]
    L --> N["Credentials Email"]
    N --> O["Account Activation"]
```

### Admin Workflow

```mermaid
flowchart TB
    Login["Admin Login"] --> Dashboard["Dashboard"]
    Dashboard --> Tabs["12 Management Tabs"]
    
    Tabs --> T1["Access Requests"]
    Tabs --> T2["Event Management"]
    Tabs --> T3["User Management"]
    Tabs --> T4["Support Tickets"]
    Tabs --> T5["Batch Accounts"]
    Tabs --> T6["VPN Management"]
    Tabs --> T7["Blocklist"]
    Tabs --> T8["Sessions"]
    Tabs --> T9["Account Lifecycle"]
    Tabs --> T10["Sync Status"]
    Tabs --> T11["System Settings"]
    Tabs --> T12["Audit Logs"]
    
    T1 --> Actions1["Approve/Reject/Assign"]
    T2 --> Actions2["Create/Edit Events"]
    T3 --> Actions3["Enable/Disable/Reset"]
    T6 --> Actions6["Import/Match/Manage"]
```

---

## Database Schema (28 Models)

```mermaid
erDiagram
    AccessRequest ||--o{ RequestComment : has
    AccessRequest ||--o{ SupportTicket : related_to
    AccessRequest ||--o| AccountActivationToken : has
    AccessRequest }o--o| Event : belongs_to
    
    SupportTicket ||--o{ TicketResponse : has
    SupportTicket ||--o{ TicketStatusLog : has
    
    BatchAccountCreation ||--o{ BatchAccountItem : contains
    BatchAccountCreation ||--o{ BatchAuditLog : logs
    
    VPNAccount ||--o{ VPNAccountStatusLog : has
    VPNAccount ||--o{ VPNAccountComment : has
    
    VPNImport ||--o{ VPNImportRecord : contains
    
    AccountLifecycleAction ||--o{ AccountLifecycleHistory : tracks
    AccountLifecycleAction ||--o{ ADAccountActivityLog : logs
    AccountLifecycleAction ||--o{ VPNAccountActivityLog : logs
    AccountLifecycleBatch ||--o{ AccountLifecycleAction : contains
    
    ADAccountSync ||--o{ ADAccountMatch : records
```

### Core Models

| Model | Purpose |
|-------|---------|
| [AccessRequest](../app/admin/page.tsx#32-48) | Main access request with full lifecycle tracking |
| [Event](../app/admin/page.tsx#49-58) | Events that trigger access requests |
| `RequestComment` | Comments on access requests |
| `AccountActivationToken` | Tokens for account activation |
| `PasswordResetToken` | Password reset tokens |

### Support System

| Model | Purpose |
|-------|---------|
| [SupportTicket](../app/admin/page.tsx#88-103) | User support tickets |
| [TicketResponse](../app/admin/page.tsx#71-78) | Responses on tickets |
| [TicketStatusLog](../app/admin/page.tsx#79-87) | Ticket status change history |

#### Support Ticket Process

```mermaid
flowchart TB
    User["Authenticated User"] --> Create["Create Support Ticket"]
    Create --> Open["Status: open"]
    Open --> Review["Admin Reviews Ticket"]
    Review --> Respond["Staff Response"]
    Respond --> Notify["User Notification Email"]
    Review --> Update{"Status change"}
    Update -->|in_progress| Working["Investigation / Work in Progress"]
    Update -->|closed| Closed["Closed"]
    Working --> Respond
    Working --> Resolve["Issue resolved"]
    Resolve --> Closed
    User --> Reply["User Reply"]
    Reply --> Open
    Reply --> Working
```

### VPN Management

| Model | Purpose |
|-------|---------|
| [VPNAccount](../app/admin/page.tsx#132-151) | VPN account records |
| `VPNAccountStatusLog` | VPN status changes |
| `VPNAccountComment` | Comments on VPN accounts |
| `VPNImport` | Bulk VPN import batches |
| `VPNImportRecord` | Individual VPN import records |
| `VPNRoleChange` | VPN role change tracking |

#### VPN Provisioning and Import Process

```mermaid
flowchart TB
    Admin["Admin"] --> Choice{"VPN workflow"}
    Choice -->|Manual| Manual["Create or edit VPN account"]
    Choice -->|Import| Import["Upload CSV import"]
    Import --> ImportBatch["Create VPNImport batch"]
    ImportBatch --> Records["Store VPNImportRecord rows"]
    Records --> Match["Match imported users to AD"]
    Match --> Review["Review matched and unmatched results"]
    Review --> Process["Process approved records"]
    Process --> Accounts["Create or update VPNAccount"]
    Manual --> Accounts
    Accounts --> Logs["Write status logs and comments"]
    Logs --> Lifecycle["Revoke, restore, or change portal type later"]
```

### Batch Operations

| Model | Purpose |
|-------|---------|
| `BatchAccountCreation` | Batch account creation jobs |
| `BatchAccountItem` | Individual accounts in batch |
| `BatchAuditLog` | Batch operation logs |

#### Batch Account Creation Process

```mermaid
flowchart TB
    Admin["Admin"] --> Payload["Submit batch account payload"]
    Payload --> Validate["Validate accounts and expiration date"]
    Validate --> BatchId["Generate batch ID"]
    BatchId --> Loop["Process each requested account"]
    Loop --> Duplicate{"Existing active request?"}
    Duplicate -->|Yes| Skip["Mark duplicate / failed"]
    Duplicate -->|No| Username["Generate unique username"]
    Username --> Password["Generate strong password"]
    Password --> Request["Create approved AccessRequest"]
    Request --> LDAP["Create LDAP user and set expiration"]
    LDAP --> Email["Send credentials email"]
    Email --> Comment["Write system comment"]
    Skip --> Summary["Aggregate results"]
    Comment --> Summary
    Summary --> BatchRecord["Create BatchAccountCreation summary record"]
```

### Account Lifecycle

| Model | Purpose |
|-------|---------|
| `AccountLifecycleAction` | Disable/enable/revoke actions |
| `AccountLifecycleBatch` | Batch lifecycle operations |
| `AccountLifecycleHistory` | Lifecycle action history |
| `ADAccountActivityLog` | AD account activity |
| `VPNAccountActivityLog` | VPN account activity |
| `ADAccountComment` | Comments on AD accounts |

#### Lifecycle Processing Pipeline

```mermaid
flowchart LR
    Admin["Admin"] --> Action["Create lifecycle action"]
    Action --> Queue["Queue action in database"]
    Queue --> Cron["Cron or manual processor trigger"]
    Cron --> Processor["Lifecycle processor"]
    Processor --> Target{"Target type"}
    Target -->|AD| AD["Enable or disable AD account"]
    Target -->|VPN| VPN["Revoke or restore VPN account"]
    Target -->|Role| Role["Promote or demote VPN role"]
    AD --> History["Update history and activity logs"]
    VPN --> History
    Role --> History
    History --> Audit["Write audit log"]
    Audit --> Dashboard["Surface new state in admin dashboard"]
```

### System Management

| Model | Purpose |
|-------|---------|
| `Session` | User sessions |
| `BlockedEmail` | Blocked email addresses |
| `SystemSettings` | System configuration |
| `NotificationBanner` | System notification banners |
| `AuditLog` | Admin action audit trail |

#### System Controls and Oversight Flow

```mermaid
flowchart TB
    Admin["Admin"] --> Settings["System settings"]
    Admin --> Notifications["Notification banners"]
    Admin --> Blocklist["Email blocklist"]
    Admin --> Sessions["Session management"]
    Admin --> Logs["Audit logs"]

    Settings --> Toggles["Login and registration toggles"]
    Settings --> EmailCfg["Email sender and recipients"]
    Notifications --> BannerTable["NotificationBanner records"]
    Blocklist --> BlockedTable["BlockedEmail records"]
    Sessions --> SessionTable["Session records"]
    Sessions --> Revoke["Revoke selected sessions"]
    Logs --> AuditTable["AuditLog records"]

    Toggles --> PublicRoutes["Affect public request and login routes"]
    EmailCfg --> EmailSystem["Feeds outbound email configuration"]
    BannerTable --> UI["Banner displayed in portal UI"]
    BlockedTable --> RequestApi["Checked during request submission"]
    Revoke --> SessionTable
    AuditTable --> Oversight["Operational review and traceability"]
```

### Account Sync

| Model | Purpose |
|-------|---------|
| `ADAccountSync` | AD/VPN sync jobs |
| `ADAccountMatch` | Matched AD accounts |

#### Account Sync Reconciliation Flow

```mermaid
flowchart TB
    Admin["Admin"] --> Run{"Dry run or live sync"}
    Run --> Scan["List AD users with @cpp.edu emails"]
    Scan --> Compare["Compare AD users with AccessRequest and VPNAccount"]
    Compare --> Decision{"Existing records?"}
    Decision -->|Both exist| Skip["Skip duplicate"]
    Decision -->|Missing request| CreateReq["Create approved AccessRequest"]
    Decision -->|Missing VPN| CreateVpn["Create VPNAccount"]
    CreateReq --> Tag["Update formatted AD description"]
    CreateVpn --> Match["Create ADAccountMatch record"]
    Tag --> Match
    Skip --> Stats["Update sync stats and final status"]
    Match --> Stats
    Stats --> History["Latest sync and history visible in admin UI"]
```

---

## Page Structure

### Public Pages

| Route | Description |
|-------|-------------|
| `/` | Home page with request workflow |
| `/login` | Admin login with Turnstile |
| `/request/internal` | Internal user request form |
| `/request/external` | External user request form |
| `/request/success` | Request submission success |
| `/verify/confirm` | Email verification confirmation |
| `/verify/success` | Verification success |
| `/verify/error` | Verification error |
| `/verify/already-verified` | Already verified notice |
| `/forgot-password` | Password reset request |
| `/reset-password` | Password reset form |
| `/instructions` | User instructions |

### Authenticated Pages

| Route | Description |
|-------|-------------|
| `/profile` | User profile management |
| `/support/create` | Create support ticket |
| `/support/tickets` | View tickets |
| `/support/tickets/[id]` | Ticket detail |
| `/account/activate` | Account activation flow |
| `/account/reset-password` | Account password reset |

### Admin Pages

| Route | Description |
|-------|-------------|
| `/admin` | Admin dashboard with 12 tabs |
| `/admin/logout` | Admin logout |

---

## Admin Dashboard Tabs

```mermaid
mindmap
  root["Admin Dashboard"]
    Access["Access Requests"]
      View pending requests
      Approve/Reject
      Assign usernames
      Send to faculty
    Events["Event Management"]
      Create events
      Edit events
      View request counts
    Users["User Management"]
      Search LDAP users
      Enable/Disable accounts
      Reset passwords
      View groups
    Support["Support Tickets"]
      View all tickets
      Respond to tickets
      Change status
    Batch["Batch Accounts"]
      Create batch
      Monitor progress
      View audit logs
    VPN["VPN Management"]
      Import from CSV
      Match to AD
      Create accounts
      Manage access
    Blocklist["Email Blocklist"]
      Block emails
      Manage blocked
    Sessions["Session Management"]
      View active sessions
      Revoke sessions
    Lifecycle["Account Lifecycle"]
      Disable accounts
      Enable accounts
      Revoke VPN
      Restore VPN
    Sync["Sync Status"]
      View sync status
      Run sync
    Settings["System Settings"]
      Email config
      Registration toggles
      Notification banners
    Logs["Audit Logs"]
      View all actions
      Filter by type
      Export logs
```

---

## API Routes Structure

### Authentication (`/api/auth/`)

| Route | Method | Purpose |
|-------|--------|---------|
| `login` | POST | Admin LDAP login |
| `logout` | POST | Session logout |
| `session` | GET | Get session info |
| `check-admin` | GET | Verify admin status |
| `request-password-reset` | POST | Request password reset |
| `reset-password` | POST | Reset password |

### Admin APIs (`/api/admin/`)

```mermaid
flowchart LR
    subgraph Requests["Access Requests"]
        R1["GET /requests"]
        R2["POST /requests/approve"]
        R3["POST /requests/reject"]
        R4["POST /requests/assign-username"]
        R5["POST /requests/send-to-faculty"]
        R6["POST /requests/manual-assign"]
        R7["GET /requests/[id]"]
    end
    
    subgraph Events["Events"]
        E1["GET /events"]
        E2["POST /events"]
        E3["PUT /events/[id]"]
    end
    
    subgraph Users["User Management"]
        U1["GET /users"]
        U2["POST /users/disable"]
        U3["POST /users/enable"]
        U4["POST /users/reset-password"]
        U5["GET /groups"]
    end
    
    subgraph VPN_API["VPN"]
        V1["GET /vpn-accounts"]
        V2["POST /vpn-accounts"]
        V3["POST /vpn-import"]
        V4["GET /vpn-import/records"]
        V5["POST /vpn-import/match"]
    end
```

#### Complete Admin API List

| Category | Routes |
|----------|--------|
| Access Requests | `requests`, `requests/[id]/*`, `search` |
| Events | `events`, `events/[id]` |
| Users | `users`, `groups`, `ad-search`, `ad-comments` |
| VPN | `vpn-accounts`, `vpn-import/*` |
| Batch | `batch-accounts/*` |
| Blocklist | `blocklist/*` |
| Sessions | `sessions` |
| Lifecycle | `account-lifecycle/*` |
| Sync | `sync-status` |
| Settings | `settings/*`, `notifications/*` |
| Logs | `logs` |
| Utilities | `generate-password`, `check-username`, `cleanup-passwords` |

### Public APIs

| Route | Purpose |
|-------|---------|
| `/api/request` | Submit access request |
| `/api/verify/*` | Email verification |
| `/api/events` | Get active events |
| `/api/support/*` | Support ticket operations |
| `/api/profile/*` | User profile operations |
| `/api/csrf-token` | Get CSRF token |

---

## Components Architecture

### Admin Components (23)

```mermaid
flowchart TB
    AdminDashboard["AdminDashboard (page.tsx)"]
    
    subgraph Tabs["Tab Components"]
        AccessRequestsTab
        EventManagementTab
        UserManagementTab
        SupportTicketsTab
        BatchAccountsTab
        VPNManagementTab
        BlocklistTab
        SessionManagementTab
        AccountLifecycleTab
        AccountSyncStatusTab
        SystemSettingsTab
        LogsTab
    end
    
    subgraph Modals["Modal Components"]
        RequestDetailModal
        EventModal
        UserDetailModal
        TicketDetailModal
        BatchDetailModal
        VPNAccountDetailModal
        VPNImportModal
        VPNADMatchModal
        GroupManagementModal
        NotificationModal
        InfrastructureSyncPanel
    end
    
    AdminDashboard --> Tabs
    Tabs --> Modals
```

### UI Components (Shadcn)

| Component | Usage |
|-----------|-------|
| `Button` | Actions and CTAs |
| `Card` | Content containers |
| `Dialog` | Modal dialogs |
| `Input` | Text inputs |
| `Label` | Form labels |
| `Select` | Dropdowns |
| `Table` | Data tables |
| `Tabs` | Tab navigation |
| `Checkbox` | Boolean inputs |
| `Badge` | Status indicators |

---

## Library Modules

### LDAP Integration (`lib/ldap/`)

```mermaid
flowchart LR
    Client["client.ts"]
    UserSearch["user-search.ts"]
    UserCRUD["user-crud.ts"]
    Password["password.ts"]
    Attributes["attributes.ts"]
    Groups["groups.ts"]
    Utils["utils.ts"]
    
    Client --> UserSearch
    Client --> UserCRUD
    Client --> Password
    Client --> Attributes
    Client --> Groups
    UserCRUD --> Utils
```

| Module | Purpose |
|--------|---------|
| [client.ts](../lib/ldap/client.ts) | LDAP connection management |
| [user-search.ts](../lib/ldap/user-search.ts) | Search users in AD |
| [user-crud.ts](../lib/ldap/user-crud.ts) | Create/Read/Update/Delete users |
| [password.ts](../lib/password.ts) | Password operations |
| [attributes.ts](../lib/ldap/attributes.ts) | User attribute management |
| [groups.ts](../lib/ldap/groups.ts) | Group membership operations |
| [utils.ts](../lib/utils.ts) | LDAP utilities |

### Email System ([lib/email.ts](../lib/email.ts))

20 email functions covering:
- Verification emails
- Admin notifications
- Account ready/activation emails
- Rejection emails
- Password reset emails
- VPN notifications
- Faculty notifications
- Ticket notifications

#### Email Delivery Pipeline

```mermaid
flowchart LR
    Event["Application event"] --> Kind{"Email type"}
    Kind --> Verify["Verification"]
    Kind --> Approval["Approval or credentials"]
    Kind --> Reset["Activation or password reset"]
    Kind --> Support["Support notifications"]
    Verify --> Config["Resolve email config"]
    Approval --> Config
    Reset --> Config
    Support --> Config
    Config --> Template["Build HTML template"]
    Template --> SMTP["Send through Nodemailer / SMTP"]
    SMTP --> Recipient["User, faculty, student director, or admin recipient"]
```

### Security Modules

| Module | Purpose |
|--------|---------|
| [session.ts](../lib/session.ts) | Session management |
| [csrf.ts](../lib/csrf.ts) | CSRF token handling |
| [ratelimit.ts](../lib/ratelimit.ts) | Rate limiting |
| [encryption.ts](../lib/encryption.ts) | Data encryption |
| [password.ts](../lib/password.ts) | Password generation/validation |
| [validation.ts](../lib/validation.ts) | Input validation |
| [audit-log.ts](../lib/audit-log.ts) | Audit logging |

### Core Utilities

| Module | Purpose |
|--------|---------|
| [prisma.ts](../lib/prisma.ts) | Database client |
| [adminAuth.ts](../lib/adminAuth.ts) | Admin authentication |
| [apiResponse.ts](../lib/apiResponse.ts) | Standardized API responses |
| [standardErrors.ts](../lib/standardErrors.ts) | Error handling |
| [env-validator.ts](../lib/env-validator.ts) | Environment validation |
| [lifecycle-processor.ts](../lib/lifecycle-processor.ts) | Account lifecycle processing |
| [infrastructure-sync.ts](../lib/infrastructure-sync.ts) | AD/VPN synchronization |

---

## Security Architecture

```mermaid
flowchart TB
    Request["Incoming Request"]
    
    Request --> Middleware["Middleware"]
    Middleware --> CSRF["CSRF Validation"]
    Middleware --> Session["Session Check"]
    Middleware --> Headers["Security Headers"]
    
    CSRF --> API["API Route"]
    Session --> API
    
    API --> RateLimit["Rate Limiting"]
    RateLimit --> Auth["Authentication Check"]
    Auth --> AdminAuth["Admin Auth (if /admin)"]
    
    AdminAuth --> Handler["Request Handler"]
    Handler --> AuditLog["Audit Logging"]
    Handler --> Response["Response"]
```

### Security Features

| Feature | Implementation |
|---------|----------------|
| **CSRF Protection** | Double-submit cookie pattern |
| **Session Management** | PostgreSQL-backed sessions with expiry |
| **Rate Limiting** | Per-IP and per-user limits |
| **Input Validation** | Zod schemas + sanitization |
| **Audit Logging** | All admin actions logged |
| **Password Security** | Strong generation, secure storage |
| **Security Headers** | HSTS, X-Frame-Options, CSP |
| **Turnstile Captcha** | Bot protection on forms |

---

## Deployment Architecture

```mermaid
flowchart TB
    subgraph Docker["Docker Environment"]
        App["Next.js Application"]
        DB["PostgreSQL Database"]
    end
    
    subgraph External["External Services"]
        LDAP["LDAP/AD Server"]
        SMTP["SMTP Server"]
        CF["Cloudflare Turnstile"]
    end
    
    subgraph CI_CD["CI/CD"]
        Jenkins["Jenkinsfile"]
        DockerCompose["docker-compose.yml"]
        Dockerfile["Dockerfile"]
    end
    
    GitHub --> Jenkins
    Jenkins --> DockerCompose
    DockerCompose --> App
    DockerCompose --> DB
    App --> LDAP
    App --> SMTP
    App --> CF
```

---

## Custom Hooks

| Hook | Purpose |
|------|---------|
| `usePolling` | Real-time data refresh |
| `useToast` | Toast notifications |
| `useAdminPageTracking` | Admin page view tracking |

---

## Environment Configuration

Key configuration areas:
- **Database**: PostgreSQL connection
- **LDAP**: AD server connection, base DN, credentials
- **SMTP**: Email server configuration
- **Security**: Session secrets, CSRF secrets
- **Turnstile**: Captcha site/secret keys
- **URLs**: Base URL, app URL

### Configuration Resolution Flow

```mermaid
flowchart TB
    Env["Environment variables"] --> Validator["env-validator.ts"]
    Validator --> Build["next.config.ts startup validation"]
    Validator --> Runtime["Runtime libraries"]
    Runtime --> Prisma["Database client"]
    Runtime --> LDAP["LDAP client"]
    Runtime --> Security["Session, CSRF, Turnstile"]
    Runtime --> Email["Email service"]
    DbSettings["SystemSettings table"] --> EmailConfig["Email config cache and fallback"]
    Env --> EmailConfig
    EmailConfig --> Email
```

---

## Summary

The UAR Web Application is a **full-featured account management system** with:

- ✅ **28 database models** covering all aspects of account management
- ✅ **12 admin tabs** for comprehensive administration
- ✅ **23+ admin components** with modals for detailed operations
- ✅ **20+ email templates** for all user communications
- ✅ **8 LDAP modules** for Active Directory integration
- ✅ **Full security stack** with CSRF, sessions, rate limiting, audit logs
- ✅ **VPN management** with import, matching, and lifecycle tracking
- ✅ **Batch operations** for bulk account creation
- ✅ **Support ticket system** with full workflow
- ✅ **Account lifecycle management** for enable/disable/revoke operations
- ✅ **Real-time polling** for live dashboard updates
- ✅ **Docker deployment** with CI/CD pipeline
