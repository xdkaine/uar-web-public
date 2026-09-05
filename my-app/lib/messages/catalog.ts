/**
 * Registered message templates. A template key exists only if defined here;
 * runtime content lives in the MessageTemplate table seeded by migration with
 * the exact pre-configuration text, so rendered output is unchanged on first
 * deployment (ADR-0004).
 *
 * Full templates own subject AND body. Senders pass their inline HTML as a
 * zero-drift fallback, so the catalog default only takes over once an
 * operator customizes the stored row.
 */
export type MessageTemplateCategory =
  | 'requests'
  | 'tickets'
  | 'accounts'
  | 'lifecycle'
  | 'system'
  | 'notifications';

export interface MessageTemplateDefinition {
  key: string;
  label: string;
  category: MessageTemplateCategory;
  /** Exact current hard-coded content; also the migration seed value. */
  defaultBody?: string;
  /** Current hard-coded subject line; undefined means code owns the subject. */
  defaultSubject?: string;
  /** True when only the subject is operator-editable (HTML body is code). */
  subjectOnly?: boolean;
  /** Placeholder documentation for the configuration UI. */
  variables: Array<{ name: string; description: string }>;
}

/** Shared variables across the ticket email family. */
const TICKET_VARS = [
  { name: 'ticketSubject', description: 'Ticket title written by the creator (plain text, for subject lines)' },
  { name: 'ticketId', description: 'Ticket identifier (plain text, for subject lines)' },
  { name: 'ticketSubjectHtml', description: 'Ticket title (pre-escaped HTML)' },
  { name: 'ticketIdHtml', description: 'Ticket identifier (pre-escaped HTML)' },
];

export const MESSAGE_TEMPLATE_CATALOG: Record<string, MessageTemplateDefinition> = {
  'faculty.handoff_message': {
    key: 'faculty.handoff_message',
    label: 'Faculty Handoff Message',
    category: 'requests',
    defaultBody: [
      'Hello!',
      '',
      'Please {{actionPhrase}} using the following details:',
      '',
      'Name: {{name}}',
      'Email: {{email}}',
      '{{vpnUsernameLine}}',
      'Password: {{password}}{{accountDisableDate}}',
      '',
      '{{completionRequest}}',
      '',
      'Thank you!',
    ].join('\n'),
    variables: [
      { name: 'actionPhrase', description: '"verify the requester’s access" or "create the requester’s VPN account" depending on account type' },
      { name: 'name', description: 'Requester full name' },
      { name: 'email', description: 'Requester email address' },
      { name: 'vpnUsernameLine', description: 'Full "VPN Username: ..." line for external users, otherwise empty' },
      { name: 'password', description: 'Account password (external) or N/A (internal)' },
      { name: 'accountDisableDate', description: 'Formatted account disable date line for external users, otherwise empty' },
      { name: 'completionRequest', description: 'Action-appropriate request to confirm verification or account creation' },
    ],
  },

  'request.rejection_notice': {
    key: 'request.rejection_notice',
    label: 'Access Request Rejection Notice',
    category: 'requests',
    defaultSubject: 'Access Request Update - Cal Poly Pomona Student SOC',
    defaultBody: [
      '<div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">',
      '  <h2>Access Request Status Update</h2>',
      '  <p>Hello {{name}},</p>',
      '  <p>Thank you for your interest in accessing the Cal Poly Pomona Student SOC systems.</p>',
      '  <p>After review, your access request has been declined for the following reason:</p>',
      '  <div style="background-color: #fee; padding: 16px; border-left: 4px solid #c33; border-radius: 4px; margin: 16px 0;">',
      '    <p style="margin: 0; color: #c33; font-weight: bold;">Reason:</p>',
      '    <p style="margin: 8px 0 0 0; color: #333;">{{reason}}</p>',
      '  </div>',
      '  <p>If you believe this decision was made in error or if you have any questions, please contact us to discuss your request further.</p>',
      '  <hr style="margin: 24px 0; border: none; border-top: 1px solid #ddd;">',
      '  <p style="color: #666; font-size: 12px;">',
      '    If you have questions, <a href="{{supportUrl}}">submit a support ticket</a>.',
      '  </p>',
      '</div>',
    ].join('\n'),
    variables: [
      { name: 'name', description: 'Requester first name (pre-escaped HTML)' },
      { name: 'reason', description: 'Decline reason written by the reviewer (pre-escaped HTML)' },
      { name: 'supportUrl', description: 'UAR Portal support-ticket creation link' },
    ],
  },

  // ------------------------- System -------------------------
  'system.relay_test': {
    key: 'system.relay_test',
    label: 'SMTP Relay Test',
    category: 'system',
    defaultSubject: 'UAR Portal - SMTP Relay Test',
    defaultBody: [
      '<div style="font-family: Arial, sans-serif; max-width: 600px;">',
      '  <h2>SMTP Relay Test</h2>',
      '  <p>This is a test message sent from the UAR Portal System Configuration at <code>{{timestamp}}</code>.</p>',
      '  <p>If you received it, the configured relay settings work.</p>',
      '</div>',
    ].join('\n'),
    variables: [
      { name: 'timestamp', description: 'ISO timestamp of the test send' },
    ],
  },

  // ------------------------- Access request family -------------------------
  'request.verification': {
    key: 'request.verification',
    label: 'Access Request Email Verification',
    category: 'requests',
    defaultSubject: 'Verify Your Access Request - Cal Poly Pomona Student SOC',
    defaultBody: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2>Hello {{name}}!</h2>
        <p>Thank you for submitting your user access request to the Cal Poly Pomona Student SOC.</p>
        <p>Please click the link below to verify your request which is tied to this email address:</p>
        <a href="{{verificationUrl}}" style="display: inline-block; padding: 12px 24px; background-color: #059669; color: #ffffff; text-decoration: none; border-radius: 4px; margin: 16px 0; font-weight: bold;">
          Verify Email Address
        </a>
        <p>Or copy and paste this link into your browser:</p>
        <p style="word-break: break-all; color: #666;">{{verificationUrl}}</p>
        <p>This link will expire in 24 hours.</p>
        <hr style="margin: 24px 0; border: none; border-top: 1px solid #ddd;">
        <p style="color: #666; font-size: 12px;">
          If you did not request access, please ignore this email.
        </p>
      </div>
    `,
    variables: [
      { name: 'name', description: 'Requester full name (pre-escaped HTML)' },
      { name: 'verificationUrl', description: 'One-time email verification link' },
    ],
  },

  'request.admin_notification': {
    key: 'request.admin_notification',
    label: 'New Verified Request — Staff Notice',
    category: 'requests',
    defaultSubject: 'A New {{accountTypeShort}} User Access Request - {{name}}',
    defaultBody: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2>New Access Request Verified</h2>
        <p>A user has verified their email and is requesting access:</p>
        <table style="width: 100%; border-collapse: collapse; margin: 16px 0;">
          <tr>
            <td style="padding: 8px; border: 1px solid #ddd; font-weight: bold;">Name:</td>
            <td style="padding: 8px; border: 1px solid #ddd;">{{name}}</td>
          </tr>
          <tr>
            <td style="padding: 8px; border: 1px solid #ddd; font-weight: bold;">Email:</td>
            <td style="padding: 8px; border: 1px solid #ddd;">{{email}}</td>
          </tr>
          <tr>
            <td style="padding: 8px; border: 1px solid #ddd; font-weight: bold;">Type:</td>
            <td style="padding: 8px; border: 1px solid #ddd;">{{studentType}}</td>
          </tr>
          <tr>
            <td style="padding: 8px; border: 1px solid #ddd; font-weight: bold;">Domain Account:</td>
            <td style="padding: 8px; border: 1px solid #ddd;">{{domainAccountNeeded}}</td>
          </tr>
          {{eventReasonRowBlock}}
        </table>
        <a href="{{adminUrl}}" style="display: inline-block; padding: 12px 24px; background-color: #059669; color: #ffffff; text-decoration: none; border-radius: 4px; margin: 16px 0; font-weight: bold;">
          Review Request
        </a>
      </div>
    `,
    variables: [
      { name: 'accountTypeShort', description: '"Internal" or "External"' },
      { name: 'name', description: 'Requester full name (pre-escaped HTML)' },
      { name: 'email', description: 'Requester email address (pre-escaped HTML)' },
      { name: 'studentType', description: '"Internal Student (@cpp.edu)" or "External Student"' },
      { name: 'domainAccountNeeded', description: '"Yes" or "No"' },
      { name: 'eventReasonRowBlock', description: 'Event/Reason table row when provided, otherwise empty' },
      { name: 'adminUrl', description: 'Link to review the request in the admin panel' },
    ],
  },

  'request.account_ready': {
    key: 'request.account_ready',
    label: 'Account Ready & Credentials',
    category: 'requests',
    defaultSubject: 'Your Account is Ready - Cal Poly Pomona Student SOC',
    defaultBody: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2>Account Created Successfully</h2>
        <p>Hello {{name}},</p>
        <p>Your access request has been approved and your account in Active Directory is now ready.</p>
        {{approvalMessageBlock}}
        <div style="background-color: #f0fdf4; padding: 16px; border-left: 4px solid #059669; border-radius: 4px; margin: 16px 0;">
          <h3 style="margin-top: 0; color: #059669;">Your Login Credentials</h3>
          <table style="width: 100%; border-collapse: collapse;">
            <tr>
              <td style="padding: 8px; font-weight: bold;">Directory username:</td>
              <td style="padding: 8px; font-family: monospace; background-color: #fff; border-radius: 3px;">{{adUsername}}</td>
            </tr>
            <tr>
              <td style="padding: 8px; font-weight: bold;">Password:</td>
              <td style="padding: 8px; font-family: monospace; background-color: #fff; border-radius: 3px;">{{password}}</td>
            </tr>
          </table>
          <p style="margin-bottom: 0; color: #c33; font-size: 14px;"><strong>⚠️ Important:</strong> Please save these credentials securely and change your password upon first login.</p>
        </div>
        <table style="width: 100%; border-collapse: collapse; margin: 16px 0;">
          <tr>
            <td style="padding: 8px; border: 1px solid #ddd; font-weight: bold;">Account Type:</td>
            <td style="padding: 8px; border: 1px solid #ddd;">{{accountType}}</td>
          </tr>
        </table>
        <div style="background-color: #f5f5f5; padding: 16px; border-radius: 4px; margin: 16px 0;">
          <h3>Set up your access</h3>
          <p style="margin: 8px 0;">Use the UAR Portal instructions for current VPN and service setup steps.</p>
          <p style="margin: 8px 0;"><a href="{{instructionsUrl}}" style="color: #059669; font-weight: bold; font-size: 16px;">View setup instructions</a></p>
        </div>
        <a href="{{loginUrl}}" style="display: inline-block; padding: 12px 24px; background-color: #059669; color: #ffffff; text-decoration: none; border-radius: 4px; margin: 16px 0; font-weight: bold;">
          Get Started
        </a>
        <hr style="margin: 24px 0; border: none; border-top: 1px solid #ddd;">
        <p style="color: #666; font-size: 12px;">
          Need help? <a href="{{supportUrl}}" style="color: #059669;">Submit a support ticket</a> through the UAR Portal.
        </p>
      </div>
    `,
    variables: [
      { name: 'name', description: 'Recipient full name (pre-escaped HTML)' },
      { name: 'approvalMessageBlock', description: 'Administrator approval message box when provided, otherwise empty' },
      { name: 'adUsername', description: 'Active Directory username (pre-escaped HTML)' },
      { name: 'password', description: 'Initial account password (pre-escaped HTML)' },
      { name: 'accountType', description: '"External (VPN)" or "Internal"' },
      { name: 'instructionsUrl', description: 'UAR Portal setup-instructions link' },
      { name: 'supportUrl', description: 'UAR Portal support-ticket creation link' },
      { name: 'loginUrl', description: 'Portal login link' },
    ],
  },

  'request.manual_assignment_linked': {
    key: 'request.manual_assignment_linked',
    label: 'Existing Account Linked Notice',
    category: 'requests',
    defaultSubject: 'Your Account Has Been Linked - Cal Poly Pomona Student SOC',
    defaultBody: `
      <div style="font-family: Arial, sans-serif; max-width: 640px; margin: 0 auto;">
        <h2 style="margin-bottom: 8px;">Existing Account Linked Successfully</h2>
        <p style="margin: 0 0 16px 0;">Hello {{name}},</p>
        <p style="margin: 0 0 16px 0;">
          We've confirmed that an existing account in Active Directory already belongs to you and connected this directory account to your recent access request.
          You can continue signing in with your current credentials—no password reset was required.
        </p>
        <div style="background-color: #f0fdf4; padding: 16px; border-left: 4px solid #059669; border-radius: 6px; margin-bottom: 20px;">
          <h3 style="margin: 0 0 12px 0; color: #047857;">Account Details</h3>
          <table style="width: 100%; border-collapse: collapse;">
            <tr>
              <td style="padding: 8px; font-weight: bold; width: 35%;">Directory username</td>
              <td style="padding: 8px; font-family: monospace; background-color: #fff; border-radius: 4px;">{{adUsername}}</td>
            </tr>
            <tr>
              <td style="padding: 8px; font-weight: bold;">Password</td>
              <td style="padding: 8px;">Use your <strong>existing</strong> SDC/Kamino/Proxmox password associated with this username.</td>
            </tr>
            <tr>
              <td style="padding: 8px; font-weight: bold;">Linked By</td>
              <td style="padding: 8px;">{{linkedBy}}</td>
            </tr>
            <tr>
              <td style="padding: 8px; font-weight: bold;">Link Type</td>
              <td style="padding: 8px;">{{linkTypeDescription}}</td>
            </tr>
          </table>
        </div>
        <div style="background-color: #eef2ff; padding: 16px; border-left: 4px solid #6366f1; border-radius: 6px; margin-bottom: 20px;">
          <h3 style="margin: 0 0 12px 0; color: #4338ca;">Next Steps</h3>
          <ol style="margin: 0; padding-left: 20px; color: #312e81;">
            <li style="margin-bottom: 8px;"><a href="{{instructionsUrl}}" style="color: #4338ca; font-weight: bold;">Review current setup instructions</a>.</li>
            <li style="margin-bottom: 8px;"><a href="{{loginUrl}}" style="color: #4338ca; font-weight: bold;">Sign in to the UAR Portal</a>.</li>
          </ol>
        </div>
        {{notesBlock}}
        <p style="margin: 0 0 16px 0;">
          Need anything else? You can create a ticket through the UAR Portal and Staff will be notified.
        </p>
        <a href="{{supportUrl}}" style="display: inline-block; padding: 12px 24px; background-color: #059669; color: #ffffff; text-decoration: none; border-radius: 6px; font-weight: bold;">Open Support Ticket</a>
        <p style="margin: 24px 0 0 0; color: #6b7280; font-size: 12px;">
          This notification confirms the successful linkage of your existing Student Data Center account to your current access request.
        </p>
      </div>
    `,
    variables: [
      { name: 'name', description: 'Recipient full name (pre-escaped HTML)' },
      { name: 'adUsername', description: 'Linked Active Directory username (pre-escaped HTML)' },
      { name: 'linkedBy', description: 'Administrator who performed the linkage (pre-escaped HTML)' },
      { name: 'linkTypeDescription', description: '"Grandfathered account (existing AD user without email)" or "Manual assignment to existing AD account"' },
      { name: 'instructionsUrl', description: 'UAR Portal setup-instructions link' },
      { name: 'loginUrl', description: 'UAR Portal login link' },
      { name: 'notesBlock', description: 'Notes-from-the-team box when notes were provided, otherwise empty' },
      { name: 'supportUrl', description: 'Support ticket creation link' },
    ],
  },

  'request.faculty_notification': {
    key: 'request.faculty_notification',
    label: 'Faculty Approval Request',
    category: 'requests',
    defaultSubject: 'Faculty Approval Requested - {{name}} Access Request',
    defaultBody: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2 style="color: #059669;">Faculty Approval Requested</h2>
        <p>A student access request has been reviewed by the Student Directors and is now awaiting faculty approval.</p>

        {{customMessageBlock}}

        <table style="width: 100%; border-collapse: collapse; margin: 16px 0;">
          <tr>
            <td style="padding: 8px; border: 1px solid #ddd; font-weight: bold; background-color: #f5f5f5;">Name:</td>
            <td style="padding: 8px; border: 1px solid #ddd;">{{name}}</td>
          </tr>
          <tr>
            <td style="padding: 8px; border: 1px solid #ddd; font-weight: bold; background-color: #f5f5f5;">Email:</td>
            <td style="padding: 8px; border: 1px solid #ddd;">{{email}}</td>
          </tr>
          <tr>
            <td style="padding: 8px; border: 1px solid #ddd; font-weight: bold; background-color: #f5f5f5;">Type:</td>
            <td style="padding: 8px; border: 1px solid #ddd;">{{studentType}}</td>
          </tr>
          <tr>
            <td style="padding: 8px; border: 1px solid #ddd; font-weight: bold; background-color: #f5f5f5;">Domain Account:</td>
            <td style="padding: 8px; border: 1px solid #ddd;">{{domainAccountNeeded}}</td>
          </tr>
          {{eventNameRowBlock}}
          {{eventReasonRowBlock}}
        </table>

        <div style="background-color: #ecfdf5; padding: 16px; border-left: 4px solid #10b981; border-radius: 4px; margin: 16px 0;">
          <h3 style="margin-top: 0; color: #059669;">Next Steps</h3>
          <p style="margin: 0;">Please review this request in the admin dashboard. You can approve or provide additional guidance to the Student Directors.</p>
        </div>

        <a href="{{adminUrl}}" style="display: inline-block; padding: 12px 24px; background-color: #059669; color: #ffffff; text-decoration: none; border-radius: 4px; margin: 16px 0; font-weight: bold;">
          Review Request
        </a>

        <hr style="margin: 24px 0; border: none; border-top: 1px solid #ddd;">
        <p style="color: #666; font-size: 12px;">
          This is an automated notification from the Cal Poly Pomona Student SOC User Access Request system.<br>
          If you have questions, please contact the Student SOC directors.
        </p>
      </div>
    `,
    variables: [
      { name: 'name', description: 'Requester full name (pre-escaped HTML)' },
      { name: 'customMessageBlock', description: 'Student Director message box when provided, otherwise empty' },
      { name: 'email', description: 'Requester email address (pre-escaped HTML)' },
      { name: 'studentType', description: '"Internal Student (@cpp.edu)" or "External Student"' },
      { name: 'domainAccountNeeded', description: '"Required" or "Not Required"' },
      { name: 'eventNameRowBlock', description: 'Event table row when provided, otherwise empty' },
      { name: 'eventReasonRowBlock', description: 'Reason table row when provided, otherwise empty' },
      { name: 'adminUrl', description: 'Link to review the request in the admin dashboard' },
    ],
  },

  // ------------------------- Accounts -------------------------
  'account.activation': {
    key: 'account.activation',
    label: 'Account Activation (Set Password)',
    category: 'accounts',
    defaultSubject: 'Set Up Your Account Password - Cal Poly Pomona Student SOC',
    defaultBody: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2>Account Created - Set Your Password</h2>
        <p>Hello {{name}},</p>
        <p>Your access request has been approved and your Active Directory account has been created!</p>

        <div style="background-color: #f0fdf4; padding: 16px; border-left: 4px solid #059669; border-radius: 4px; margin: 16px 0;">
          <h3 style="margin-top: 0; color: #059669;">Your Account Details</h3>
          <table style="width: 100%; border-collapse: collapse;">
            <tr>
              <td style="padding: 8px; font-weight: bold;">Directory username:</td>
              <td style="padding: 8px; font-family: monospace; background-color: #fff; border-radius: 3px;">{{adUsername}}</td>
            </tr>
          </table>
        </div>

        <div style="background-color: #fef3c7; padding: 16px; border-left: 4px solid #f59e0b; border-radius: 4px; margin: 16px 0;">
          <h3 style="margin-top: 0; color: #d97706;">Action Required</h3>
          <p style="margin: 8px 0;">You must set your password before you can access your account.</p>
          <p style="margin: 8px 0;">Click the button below to securely set your password:</p>
        </div>

        <a href="{{activationUrl}}" style="display: inline-block; padding: 12px 24px; background-color: #059669; color: #ffffff; text-decoration: none; border-radius: 4px; margin: 16px 0; font-weight: bold;">
          Set My Password
        </a>

        <div style="background-color: #f5f5f5; padding: 16px; border-radius: 4px; margin: 16px 0;">
          <h4 style="margin-top: 0;">Important Information:</h4>
          <ul style="margin: 8px 0; padding-left: 20px;">
            <li>This activation link expires on <strong>{{expiryDate}}</strong> (7 days)</li>
            <li>You will need to confirm your directory username when setting your password</li>
            <li>Choose a strong password that meets our security requirements</li>
            <li>If the link expires, you can use the "Forgot Password" feature to set your password</li>
          </ul>
        </div>

        <div style="background-color: #eff6ff; padding: 16px; border-left: 4px solid #3b82f6; border-radius: 4px; margin: 16px 0;">
          <h4 style="margin-top: 0; color: #1e40af;">After Setting Your Password:</h4>
          <p style="margin: 8px 0;">Use the UAR Portal instructions for current VPN and service setup steps:</p>
          <p style="margin: 8px 0;"><a href="{{instructionsUrl}}" style="color: #059669; font-weight: bold;">View setup instructions</a></p>
        </div>

        <hr style="margin: 24px 0; border: none; border-top: 1px solid #ddd;">
        <p style="color: #666; font-size: 12px;">
          If you did not request this account, <a href="{{supportUrl}}" style="color: #059669;">submit a support ticket</a> immediately.
        </p>
        <p style="color: #666; font-size: 12px;">
          This is an automated email. Please do not reply to this message.
        </p>
      </div>
    `,
    variables: [
      { name: 'name', description: 'Recipient full name (pre-escaped HTML)' },
      { name: 'adUsername', description: 'Active Directory username (pre-escaped HTML)' },
      { name: 'activationUrl', description: 'One-time account activation link' },
      { name: 'expiryDate', description: 'Formatted activation link expiry date/time' },
      { name: 'instructionsUrl', description: 'UAR Portal setup-instructions link' },
      { name: 'supportUrl', description: 'UAR Portal support-ticket creation link' },
    ],
  },

  'account.activation_success': {
    key: 'account.activation_success',
    label: 'Activation Success Confirmation',
    category: 'accounts',
    defaultSubject: 'Password Set Successfully - Cal Poly Pomona Student SOC',
    defaultBody: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2>Password Set Successfully</h2>
        <p>Hello {{name}},</p>
        <p>Your password has been set successfully! Your account is now fully activated and ready to use.</p>

        <div style="background-color: #f0fdf4; padding: 16px; border-left: 4px solid #059669; border-radius: 4px; margin: 16px 0;">
          <h3 style="margin-top: 0; color: #059669;">Your Login Information</h3>
          <table style="width: 100%; border-collapse: collapse;">
            <tr>
              <td style="padding: 8px; font-weight: bold;">Directory username:</td>
              <td style="padding: 8px; font-family: monospace; background-color: #fff; border-radius: 3px;">{{adUsername}}</td>
            </tr>
            <tr>
              <td style="padding: 8px; font-weight: bold;">Password:</td>
              <td style="padding: 8px; color: #666;">The password you just set</td>
            </tr>
          </table>
        </div>

        <div style="background-color: #eff6ff; padding: 16px; border-left: 4px solid #3b82f6; border-radius: 4px; margin: 16px 0;">
          <h3 style="margin-top: 0; color: #1e40af;">Access our Portal</h3>
          <p style="margin: 8px 0;">Use the UAR Portal instructions for current VPN and service setup steps:</p>
          <p style="margin: 8px 0;"><a href="{{instructionsUrl}}" style="color: #059669; font-weight: bold; font-size: 16px;">View setup instructions</a></p>
        </div>

        <a href="{{loginUrl}}" style="display: inline-block; padding: 12px 24px; background-color: #059669; color: #ffffff; text-decoration: none; border-radius: 4px; margin: 16px 0; font-weight: bold;">
          Log In Now
        </a>

        <div style="background-color: #f5f5f5; padding: 16px; border-radius: 4px; margin: 16px 0;">
          <h4 style="margin-top: 0;">Security Reminders:</h4>
          <ul style="margin: 8px 0; padding-left: 20px;">
            <li>Never share your password with anyone</li>
            <li>Use the "Forgot Password" feature if you need to reset your password</li>
            <li>Submit a support ticket if you notice suspicious account activity</li>
          </ul>
        </div>

        <hr style="margin: 24px 0; border: none; border-top: 1px solid #ddd;">
        <p style="color: #666; font-size: 12px;">
          Need help? <a href="{{supportUrl}}" style="color: #059669;">Submit a support ticket</a> through the UAR Portal.
        </p>
      </div>
    `,
    variables: [
      { name: 'name', description: 'Recipient full name (pre-escaped HTML)' },
      { name: 'adUsername', description: 'Active Directory username (pre-escaped HTML)' },
      { name: 'loginUrl', description: 'Portal login link' },
      { name: 'instructionsUrl', description: 'UAR Portal setup-instructions link' },
      { name: 'supportUrl', description: 'UAR Portal support-ticket creation link' },
    ],
  },

  'account.credentials': {
    key: 'account.credentials',
    label: 'Directory Account Credentials',
    category: 'accounts',
    defaultSubject: 'Your Directory Account Credentials - Cal Poly Pomona Student SOC',
    defaultBody: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2>Directory Account Created</h2>
        <p>Hello {{name}},</p>
        <p>Your Active Directory account is ready. Use these credentials for authorized SOC services, including VPN access.</p>
        <div style="background-color: #f0fdf4; padding: 16px; border-left: 4px solid #059669; border-radius: 4px; margin: 16px 0;">
          <h3 style="margin-top: 0; color: #059669;">Your Login Credentials</h3>
          <table style="width: 100%; border-collapse: collapse;">
            <tr>
              <td style="padding: 8px; font-weight: bold;">Directory username:</td>
              <td style="padding: 8px; font-family: monospace; background-color: #fff; border-radius: 3px;">{{adUsername}}</td>
            </tr>
            <tr>
              <td style="padding: 8px; font-weight: bold;">Password:</td>
              <td style="padding: 8px; font-family: monospace; background-color: #fff; border-radius: 3px;">{{password}}</td>
            </tr>
            <tr>
              <td style="padding: 8px; font-weight: bold;">Expires:</td>
              <td style="padding: 8px; font-family: monospace; background-color: #fff; border-radius: 3px;">{{expiryDate}}</td>
            </tr>
          </table>
          <p style="margin-bottom: 0; color: #c33; font-size: 14px;"><strong>⚠️ Important:</strong> Please save these credentials securely.</p>
        </div>
        <div style="background-color: #f5f5f5; padding: 16px; border-radius: 4px; margin: 16px 0;">
          <h3>Set up your access</h3>
          <p style="margin: 8px 0;"><a href="{{instructionsUrl}}" style="color: #059669; font-weight: bold; font-size: 16px;">View setup instructions</a></p>
          <h4 style="margin-top: 16px;">Next Steps:</h4>
          <ol style="margin: 8px 0;">
            <li>Review the current VPN and service setup instructions</li>
            <li>Use your directory credentials when the instructions direct you to sign in</li>
          </ol>
        </div>
        <hr style="margin: 24px 0; border: none; border-top: 1px solid #ddd;">
        <p style="color: #666; font-size: 12px;">
          Need help? <a href="{{supportUrl}}" style="color: #059669;">Submit a support ticket</a> through the UAR Portal.
        </p>
      </div>
    `,
    variables: [
      { name: 'name', description: 'Recipient full name (pre-escaped HTML)' },
      { name: 'adUsername', description: 'Active Directory username (pre-escaped HTML)' },
      { name: 'password', description: 'Account password (pre-escaped HTML)' },
      { name: 'expiryDate', description: 'Account expiry date (pre-escaped HTML)' },
      { name: 'instructionsUrl', description: 'UAR Portal setup-instructions link' },
      { name: 'supportUrl', description: 'UAR Portal support-ticket creation link' },
    ],
  },

  'account.password_reset_user': {
    key: 'account.password_reset_user',
    label: 'Password Reset — Self-Service',
    category: 'accounts',
    defaultSubject: 'Password Reset Request - Cal Poly Pomona Student SOC',
    defaultBody: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2>{{heading}}</h2>
        <p>{{intro}}</p>
        <p>Click the one-time link below to reset your password:</p>
        <a href="{{resetUrl}}" style="display: inline-block; padding: 12px 24px; background-color: #059669; color: #ffffff; text-decoration: none; border-radius: 4px; margin: 16px 0; font-weight: bold;">
          Reset Password
        </a>
        <p>Or copy and paste this link into your browser:</p>
        <p style="word-break: break-all; color: #666;">{{resetUrl}}</p>
        <p><strong>This one-time link will expire in 1 hour.</strong></p>
        <div style="background-color: #fff3cd; padding: 16px; border-left: 4px solid #ffc107; border-radius: 4px; margin: 16px 0;">
          <p style="margin: 0; color: #856404;">
            <strong>Security Notice:</strong> {{notice}}
          </p>
        </div>
        <hr style="margin: 24px 0; border: none; border-top: 1px solid #ddd;">
        <p style="color: #666; font-size: 12px;">
          If you have questions, <a href="{{supportUrl}}">submit a support ticket</a>.
        </p>
      </div>
    `,
    variables: [
      { name: 'heading', description: 'Heading text ("Password Reset Request")' },
      { name: 'intro', description: 'Introductory sentence' },
      { name: 'resetUrl', description: 'One-time password reset link' },
      { name: 'notice', description: 'Security notice sentence' },
      { name: 'supportUrl', description: 'UAR Portal support-ticket creation link' },
    ],
  },

  'account.password_reset_admin': {
    key: 'account.password_reset_admin',
    label: 'Password Reset — Administrator Issued',
    category: 'accounts',
    defaultSubject: 'Administrator Password Reset Link - Cal Poly Pomona Student SOC',
    defaultBody: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2>{{heading}}</h2>
        <p>{{intro}}</p>
        <p>Click the one-time link below to reset your password:</p>
        <a href="{{resetUrl}}" style="display: inline-block; padding: 12px 24px; background-color: #059669; color: #ffffff; text-decoration: none; border-radius: 4px; margin: 16px 0; font-weight: bold;">
          Reset Password
        </a>
        <p>Or copy and paste this link into your browser:</p>
        <p style="word-break: break-all; color: #666;">{{resetUrl}}</p>
        <p><strong>This one-time link will expire in 1 hour.</strong></p>
        <div style="background-color: #fff3cd; padding: 16px; border-left: 4px solid #ffc107; border-radius: 4px; margin: 16px 0;">
          <p style="margin: 0; color: #856404;">
            <strong>Security Notice:</strong> {{notice}}
          </p>
        </div>
        <hr style="margin: 24px 0; border: none; border-top: 1px solid #ddd;">
        <p style="color: #666; font-size: 12px;">
          If you have questions, <a href="{{supportUrl}}">submit a support ticket</a>.
        </p>
      </div>
    `,
    variables: [
      { name: 'heading', description: 'Heading text ("Administrator Password Reset Link")' },
      { name: 'intro', description: 'Introductory sentence' },
      { name: 'resetUrl', description: 'One-time password reset link' },
      { name: 'notice', description: 'Security notice sentence' },
      { name: 'supportUrl', description: 'UAR Portal support-ticket creation link' },
    ],
  },

  'profile.email_verification': {
    key: 'profile.email_verification',
    label: 'Profile Email Change Verification',
    category: 'accounts',
    defaultSubject: 'Verify Your Email Address - Cal Poly Pomona Student SOC',
    defaultBody: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2>Hello {{name}}!</h2>
        <p>You have requested to add this email address to your Student SOC account.</p>
        <p>Please click the link below to verify your email address:</p>
        <a href="{{verificationUrl}}" style="display: inline-block; padding: 12px 24px; background-color: #059669; color: #ffffff; text-decoration: none; border-radius: 4px; margin: 16px 0; font-weight: bold;">
          Verify Email Address
        </a>
        <p>Or copy and paste this link into your browser:</p>
        <p style="word-break: break-all; color: #666;">{{verificationUrl}}</p>
        <p>This link will expire in 24 hours.</p>
        <div style="background-color: #ecfdf5; padding: 16px; border-left: 4px solid #10b981; border-radius: 4px; margin: 16px 0;">
          <p style="margin: 0; color: #333;">
            <strong>Why are we asking for this?</strong><br>
            We're updating our records to ensure we have accurate contact information for all accounts.
            Once verified, your email will be added to your Active Directory account for better communication.
          </p>
        </div>
        <hr style="margin: 24px 0; border: none; border-top: 1px solid #ddd;">
        <p style="color: #666; font-size: 12px;">
          If you did not request this verification, please ignore this email or contact support if you have concerns.
        </p>
      </div>
    `,
    variables: [
      { name: 'name', description: 'Recipient full name (pre-escaped HTML)' },
      { name: 'verificationUrl', description: 'One-time email verification link' },
    ],
  },

  'password.expiration_reminder': {
    key: 'password.expiration_reminder',
    label: 'Password Expiration Reminder',
    category: 'accounts',
    defaultSubject: '{{subjectLine}}',
    defaultBody: `
      <div style="font-family: Arial, sans-serif; max-width: 640px; margin: 0 auto;">
        <h2>{{heading}}</h2>
        <p>Hello {{recipientName}},</p>
        <p>{{urgencyMessage}}</p>
        <table style="width: 100%; border-collapse: collapse; margin: 16px 0;">
          <tr>
            <td style="padding: 8px; border: 1px solid #ddd; font-weight: bold; background-color: #f5f5f5;">AD Username</td>
            <td style="padding: 8px; border: 1px solid #ddd; font-family: monospace;">{{username}}</td>
          </tr>
          <tr>
            <td style="padding: 8px; border: 1px solid #ddd; font-weight: bold; background-color: #f5f5f5;">Status</td>
            <td style="padding: 8px; border: 1px solid #ddd;">{{statusLabel}}</td>
          </tr>
          {{expiryDateRowBlock}}
        </table>
        <p>
          Go to the portal sign-in page and sign in with your current password. If Active Directory requires a change,
          the portal will show the password update form before completing sign-in.
        </p>
        <a href="{{loginUrl}}" style="display: inline-block; padding: 12px 24px; background-color: #111827; color: #ffffff; text-decoration: none; border-radius: 4px; margin: 16px 0; font-weight: bold;">
          Sign In and Update Password
        </a>
        <p style="margin-top: 16px;">
          If you do not know your current password, use the forgot password flow instead:
          <a href="{{forgotPasswordUrl}}" style="color: #2563eb; font-weight: bold;">{{forgotPasswordUrl}}</a>
        </p>
        <hr style="margin: 24px 0; border: none; border-top: 1px solid #ddd;">
        <p style="color: #666; font-size: 12px;">
          This message was sent by the Student SOC User Access Request portal. Never share your password with anyone.
        </p>
      </div>
    `,
    variables: [
      { name: 'subjectLine', description: 'Full subject line: "Action Required: Your SDC Account Password Must Be Changed" (expired) or "Reminder: Your SDC Account Password Expires Soon"' },
      { name: 'heading', description: '"Password Change Required" or "Password Expiration Reminder"' },
      { name: 'recipientName', description: 'Display name or username (pre-escaped HTML)' },
      { name: 'urgencyMessage', description: 'Expiration urgency sentence (pre-escaped HTML)' },
      { name: 'username', description: 'AD username (pre-escaped HTML)' },
      { name: 'statusLabel', description: 'Password status with underscores replaced by spaces (pre-escaped HTML)' },
      { name: 'expiryDateRowBlock', description: 'Password-expires table row when the expiry date is known, otherwise empty' },
      { name: 'loginUrl', description: 'Portal sign-in link' },
      { name: 'forgotPasswordUrl', description: 'Forgot-password flow link' },
    ],
  },

  // ------------------------- Notifications -------------------------
  'vpn.pending_faculty': {
    key: 'vpn.pending_faculty',
    label: 'VPN Account Pending Faculty Approval',
    category: 'notifications',
    defaultSubject: 'VPN Account Pending Faculty Approval - {{accountName}}',
    defaultBody: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2>VPN Account Awaiting Faculty Approval</h2>
        <p>A new VPN account has been created and is pending faculty approval:</p>
        <table style="width: 100%; border-collapse: collapse; margin: 16px 0;">
          <tr>
            <td style="padding: 8px; border: 1px solid #ddd; font-weight: bold;">Username:</td>
            <td style="padding: 8px; border: 1px solid #ddd; font-family: monospace;">{{accountUsername}}</td>
          </tr>
          <tr>
            <td style="padding: 8px; border: 1px solid #ddd; font-weight: bold;">Name:</td>
            <td style="padding: 8px; border: 1px solid #ddd;">{{accountName}}</td>
          </tr>
          <tr>
            <td style="padding: 8px; border: 1px solid #ddd; font-weight: bold;">Email:</td>
            <td style="padding: 8px; border: 1px solid #ddd;">{{accountEmail}}</td>
          </tr>
          <tr>
            <td style="padding: 8px; border: 1px solid #ddd; font-weight: bold;">Portal Type:</td>
            <td style="padding: 8px; border: 1px solid #ddd;">{{portalType}}</td>
          </tr>
          <tr>
            <td style="padding: 8px; border: 1px solid #ddd; font-weight: bold;">Created By:</td>
            <td style="padding: 8px; border: 1px solid #ddd;">{{createdBy}}</td>
          </tr>
        </table>
        <div style="background-color: #fef3c7; padding: 16px; border-left: 4px solid #f59e0b; border-radius: 4px; margin: 16px 0;">
          <p style="margin: 0; color: #333;">
            <strong>Action Required:</strong><br>
            Please review this account and approve or modify its status in the admin panel.
          </p>
        </div>
        <a href="{{adminUrl}}" style="display: inline-block; padding: 12px 24px; background-color: #059669; color: #ffffff; text-decoration: none; border-radius: 4px; margin: 16px 0; font-weight: bold;">
          Review in Admin Panel
        </a>
      </div>
    `,
    variables: [
      { name: 'accountName', description: 'Account holder full name (pre-escaped HTML)' },
      { name: 'accountUsername', description: 'VPN account username (pre-escaped HTML)' },
      { name: 'accountEmail', description: 'Account holder email address (pre-escaped HTML)' },
      { name: 'portalType', description: 'Portal type the account targets (pre-escaped HTML)' },
      { name: 'createdBy', description: 'Who created the account (pre-escaped HTML)' },
      { name: 'adminUrl', description: 'Admin panel link' },
    ],
  },

  'notifications.student_director': {
    key: 'notifications.student_director',
    label: 'Student Director Notification',
    category: 'notifications',
    defaultSubject: '[Student Directors] {{notificationTitle}}',
    defaultBody: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2>Student Director Notification</h2>
        <div style="background-color: #ecfdf5; padding: 16px; border-left: 4px solid #10b981; border-radius: 4px; margin: 16px 0;">
          <p style="margin: 0; color: #333; white-space: pre-wrap;">{{message}}</p>
        </div>
        {{detailsTableBlock}}
        <a href="{{adminUrl}}" style="display: inline-block; padding: 12px 24px; background-color: #059669; color: #ffffff; text-decoration: none; border-radius: 4px; margin: 16px 0; font-weight: bold;">
          View Admin Dashboard
        </a>
        <hr style="margin: 24px 0; border: none; border-top: 1px solid #ddd;">
        <p style="color: #666; font-size: 12px;">
          This is an automated notification for student directors of Cal Poly Pomona Student SOC.
        </p>
      </div>
    `,
    variables: [
      { name: 'notificationTitle', description: 'Short notification title appended after the "[Student Directors]" prefix' },
      { name: 'message', description: 'Notification body message (pre-escaped HTML)' },
      { name: 'detailsTableBlock', description: 'Details key/value table when details were provided, otherwise empty' },
      { name: 'adminUrl', description: 'Admin dashboard link' },
    ],
  },

  // ------------------------- Ticket email family -------------------------
  'ticket.created_admin': {
    key: 'ticket.created_admin',
    label: 'New Ticket — Staff Queue Notice',
    category: 'tickets',
    defaultSubject: 'New Support Ticket: {{ticketSubject}}',
    defaultBody: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2 style="color: #dc2626;">New Support Ticket Created</h2>
        <p>A user has submitted a new support ticket that requires your attention.</p>

        <table style="width: 100%; border-collapse: collapse; margin: 16px 0;">
          <tr>
            <td style="padding: 8px; border: 1px solid #ddd; font-weight: bold; background-color: #f5f5f5;">Ticket ID:</td>
            <td style="padding: 8px; border: 1px solid #ddd;">{{ticketIdHtml}}</td>
          </tr>
          <tr>
            <td style="padding: 8px; border: 1px solid #ddd; font-weight: bold; background-color: #f5f5f5;">Subject:</td>
            <td style="padding: 8px; border: 1px solid #ddd;">{{ticketSubjectHtml}}</td>
          </tr>
          <tr>
            <td style="padding: 8px; border: 1px solid #ddd; font-weight: bold; background-color: #f5f5f5;">Username:</td>
            <td style="padding: 8px; border: 1px solid #ddd;">{{username}}</td>
          </tr>
          {{userEmailRowBlock}}
          {{categoryRowBlock}}
          {{severityRowBlock}}
        </table>

        <div style="background-color: #f9fafb; padding: 16px; border-radius: 4px; margin: 16px 0;">
          <h3 style="margin-top: 0;">Message Preview:</h3>
          <p style="margin: 0; white-space: pre-wrap; color: #374151;">{{bodyPreview}}</p>
        </div>

        <a href="{{ticketUrl}}" style="display: inline-block; padding: 12px 24px; background-color: #dc2626; color: #ffffff; text-decoration: none; border-radius: 4px; margin: 16px 0; font-weight: bold;">
          View Ticket in Admin Dashboard
        </a>

        <hr style="margin: 24px 0; border: none; border-top: 1px solid #ddd;">
        <p style="color: #666; font-size: 12px;">
          This is an automated notification from the Cal Poly Pomona Student SOC User Access Request system.
        </p>
      </div>
    `,
    variables: [
      ...TICKET_VARS,
      { name: 'username', description: 'Creator username (pre-escaped HTML)' },
      { name: 'userEmailRowBlock', description: 'User-email table row when available, otherwise empty' },
      { name: 'categoryRowBlock', description: 'Category table row when set, otherwise empty' },
      { name: 'severityRowBlock', description: 'Severity badge table row when set, otherwise empty' },
      { name: 'bodyPreview', description: 'First 200 characters of the ticket body (pre-escaped HTML)' },
      { name: 'ticketUrl', description: 'Admin dashboard link' },
    ],
  },

  'ticket.receipt': {
    key: 'ticket.receipt',
    label: 'New Ticket — Creator Receipt',
    category: 'tickets',
    defaultSubject: 'We Received Your Support Ticket: {{ticketSubject}}',
    defaultBody: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2 style="color: #2563eb;">Support Ticket Received</h2>
        {{greetingBlock}}
        <p>We have received your support ticket and will send you updates as it is worked on.</p>

        <table style="width: 100%; border-collapse: collapse; margin: 16px 0;">
          <tr>
            <td style="padding: 8px; border: 1px solid #ddd; font-weight: bold; background-color: #f5f5f5;">Ticket ID:</td>
            <td style="padding: 8px; border: 1px solid #ddd;">{{ticketIdHtml}}</td>
          </tr>
          <tr>
            <td style="padding: 8px; border: 1px solid #ddd; font-weight: bold; background-color: #f5f5f5;">Subject:</td>
            <td style="padding: 8px; border: 1px solid #ddd;">{{ticketSubjectHtml}}</td>
          </tr>
          {{categoryRowBlock}}
          {{severityRowBlock}}
        </table>

        <a href="{{ticketUrl}}" style="display: inline-block; padding: 12px 24px; background-color: #2563eb; color: #ffffff; text-decoration: none; border-radius: 4px; margin: 16px 0; font-weight: bold;">
          View Your Ticket
        </a>

        <hr style="margin: 24px 0; border: none; border-top: 1px solid #ddd;">
        <p style="color: #666; font-size: 12px;">
          No action is needed from you right now. You will receive an email when your ticket is updated.
        </p>
      </div>
    `,
    variables: [
      ...TICKET_VARS,
      { name: 'greetingBlock', description: '"Hello <name>," paragraph when the name is known, otherwise "Hello,"' },
      { name: 'categoryRowBlock', description: 'Category table row when set, otherwise empty' },
      { name: 'severityRowBlock', description: 'Severity table row when set, otherwise empty' },
      { name: 'ticketUrl', description: 'Link to view the ticket' },
    ],
  },

  'ticket.assigned': {
    key: 'ticket.assigned',
    label: 'Ticket Assignment Change',
    category: 'tickets',
    defaultSubject: '{{assignmentTag}} Support Ticket: {{ticketSubject}}',
    defaultBody: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2 style="color: {{accentColor}};">{{heading}}</h2>
        <p>{{actionLine}}</p>

        <table style="width: 100%; border-collapse: collapse; margin: 16px 0;">
          <tr>
            <td style="padding: 8px; border: 1px solid #ddd; font-weight: bold; background-color: #f5f5f5;">Ticket ID:</td>
            <td style="padding: 8px; border: 1px solid #ddd;">{{ticketIdHtml}}</td>
          </tr>
          <tr>
            <td style="padding: 8px; border: 1px solid #ddd; font-weight: bold; background-color: #f5f5f5;">Subject:</td>
            <td style="padding: 8px; border: 1px solid #ddd;">{{ticketSubjectHtml}}</td>
          </tr>
          <tr>
            <td style="padding: 8px; border: 1px solid #ddd; font-weight: bold; background-color: #f5f5f5;">Assignment:</td>
            <td style="padding: 8px; border: 1px solid #ddd;">{{assignmentTargets}}</td>
          </tr>
          <tr>
            <td style="padding: 8px; border: 1px solid #ddd; font-weight: bold; background-color: #f5f5f5;">Changed By:</td>
            <td style="padding: 8px; border: 1px solid #ddd;">{{changedBy}}</td>
          </tr>
        </table>

        <a href="{{adminUrl}}" style="display: inline-block; padding: 12px 24px; background-color: {{accentColor}}; color: #ffffff; text-decoration: none; border-radius: 4px; margin: 16px 0; font-weight: bold;">
          Open Support Dashboard
        </a>

        <hr style="margin: 24px 0; border: none; border-top: 1px solid #ddd;">
        <p style="color: #666; font-size: 12px;">
          This is an automated notification from the Cal Poly Pomona Student SOC User Access Request system.
        </p>
      </div>
    `,
    variables: [
      ...TICKET_VARS,
      { name: 'assignmentTag', description: '"[Assigned]" or "[Unassigned]" (subject line)' },
      { name: 'accentColor', description: '"#2563eb" when assigned, "#6b7280" when unassigned' },
      { name: 'heading', description: '"Support Ticket Assigned" or "Support Ticket Assignment Removed"' },
      { name: 'actionLine', description: 'Explanation sentence for the change (pre-escaped HTML)' },
      { name: 'assignmentTargets', description: 'Comma-separated assignee/group labels (pre-escaped HTML)' },
      { name: 'changedBy', description: 'Who made the assignment change (pre-escaped HTML)' },
      { name: 'adminUrl', description: 'Support dashboard link' },
    ],
  },

  'ticket.staff_response': {
    key: 'ticket.staff_response',
    label: 'Staff Reply to Creator',
    category: 'tickets',
    defaultSubject: 'Response to Your Support Ticket: {{ticketSubject}}',
    defaultBody: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2 style="color: #059669;">{{heading}}</h2>
        {{greetingBlock}}
        <p>{{introLine}}</p>

        <table style="width: 100%; border-collapse: collapse; margin: 16px 0;">
          <tr>
            <td style="padding: 8px; border: 1px solid #ddd; font-weight: bold; background-color: #f5f5f5;">Ticket Subject:</td>
            <td style="padding: 8px; border: 1px solid #ddd;">{{ticketSubjectHtml}}</td>
          </tr>
          <tr>
            <td style="padding: 8px; border: 1px solid #ddd; font-weight: bold; background-color: #f5f5f5;">Responded By:</td>
            <td style="padding: 8px; border: 1px solid #ddd;">{{respondedBy}}</td>
          </tr>
        </table>

        <div style="background-color: #ecfdf5; padding: 16px; border-left: 4px solid #10b981; border-radius: 4px; margin: 16px 0;">
          <h3 style="margin-top: 0; color: #059669;">Response:</h3>
          <p style="margin: 0; white-space: pre-wrap; color: #374151;">{{responseMessage}}</p>
        </div>

        <a href="{{ticketUrl}}" style="display: inline-block; padding: 12px 24px; background-color: #059669; color: #ffffff; text-decoration: none; border-radius: 4px; margin: 16px 0; font-weight: bold;">
          View Full Ticket
        </a>

        <hr style="margin: 24px 0; border: none; border-top: 1px solid #ddd;">
        <p style="color: #666; font-size: 12px;">
          You can reply to this ticket by logging into the support portal.<br>
          If you did not submit this ticket, <a href="{{supportUrl}}">report it through the support portal</a>.
        </p>
      </div>
    `,
    variables: [
      ...TICKET_VARS,
      { name: 'heading', description: '"Staff Response to Your Support Ticket" or "New Response on Your Support Ticket"' },
      { name: 'greetingBlock', description: '"Hello <name>," paragraph when the name is known, otherwise "Hello,"' },
      { name: 'introLine', description: 'Introductory sentence describing who replied' },
      { name: 'respondedBy', description: 'Responder username (pre-escaped HTML)' },
      { name: 'responseMessage', description: 'Response body text (pre-escaped HTML)' },
      { name: 'ticketUrl', description: 'Link to view the ticket' },
      { name: 'supportUrl', description: 'Link to create a support ticket' },
    ],
  },

  'ticket.user_reply_admin': {
    key: 'ticket.user_reply_admin',
    label: 'Creator Reply — Staff Queue Notice',
    category: 'tickets',
    defaultSubject: 'User Response on Ticket: {{ticketSubject}}',
    defaultBody: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2 style="color: #2563eb;">User Response on Support Ticket</h2>
        <p>A user has replied to an existing support ticket.</p>

        <table style="width: 100%; border-collapse: collapse; margin: 16px 0;">
          <tr>
            <td style="padding: 8px; border: 1px solid #ddd; font-weight: bold; background-color: #f5f5f5;">Ticket ID:</td>
            <td style="padding: 8px; border: 1px solid #ddd;">{{ticketIdHtml}}</td>
          </tr>
          <tr>
            <td style="padding: 8px; border: 1px solid #ddd; font-weight: bold; background-color: #f5f5f5;">Subject:</td>
            <td style="padding: 8px; border: 1px solid #ddd;">{{ticketSubjectHtml}}</td>
          </tr>
          <tr>
            <td style="padding: 8px; border: 1px solid #ddd; font-weight: bold; background-color: #f5f5f5;">Username:</td>
            <td style="padding: 8px; border: 1px solid #ddd;">{{username}}</td>
          </tr>
          {{userEmailRowBlock}}
        </table>

        <div style="background-color: #eff6ff; padding: 16px; border-left: 4px solid #3b82f6; border-radius: 4px; margin: 16px 0;">
          <h3 style="margin-top: 0; color: #1e40af;">Response Preview:</h3>
          <p style="margin: 0; white-space: pre-wrap; color: #374151;">{{responsePreview}}</p>
        </div>

        <a href="{{ticketUrl}}" style="display: inline-block; padding: 12px 24px; background-color: #2563eb; color: #ffffff; text-decoration: none; border-radius: 4px; margin: 16px 0; font-weight: bold;">
          View Ticket in Admin Dashboard
        </a>

        <hr style="margin: 24px 0; border: none; border-top: 1px solid #ddd;">
        <p style="color: #666; font-size: 12px;">
          This is an automated notification from the Cal Poly Pomona Student SOC User Access Request system.
        </p>
      </div>
    `,
    variables: [
      ...TICKET_VARS,
      { name: 'username', description: 'Creator username (pre-escaped HTML)' },
      { name: 'userEmailRowBlock', description: 'User-email table row when available, otherwise empty' },
      { name: 'responsePreview', description: 'First 200 characters of the reply (pre-escaped HTML)' },
      { name: 'ticketUrl', description: 'Admin dashboard link' },
    ],
  },

  'ticket.user_reply_assignees': {
    key: 'ticket.user_reply_assignees',
    label: 'Creator Reply — Assignee Notice',
    category: 'tickets',
    defaultSubject: 'User Response on Assigned Ticket: {{ticketSubject}}',
    defaultBody: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2 style="color: #2563eb;">User Response on Your Assigned Ticket</h2>
        <p>The creator of a ticket assigned to you has replied.</p>

        <table style="width: 100%; border-collapse: collapse; margin: 16px 0;">
          <tr>
            <td style="padding: 8px; border: 1px solid #ddd; font-weight: bold; background-color: #f5f5f5;">Ticket ID:</td>
            <td style="padding: 8px; border: 1px solid #ddd;">{{ticketIdHtml}}</td>
          </tr>
          <tr>
            <td style="padding: 8px; border: 1px solid #ddd; font-weight: bold; background-color: #f5f5f5;">Subject:</td>
            <td style="padding: 8px; border: 1px solid #ddd;">{{ticketSubjectHtml}}</td>
          </tr>
          <tr>
            <td style="padding: 8px; border: 1px solid #ddd; font-weight: bold; background-color: #f5f5f5;">Username:</td>
            <td style="padding: 8px; border: 1px solid #ddd;">{{username}}</td>
          </tr>
          {{userEmailRowBlock}}
        </table>

        <div style="background-color: #eff6ff; padding: 16px; border-left: 4px solid #3b82f6; border-radius: 4px; margin: 16px 0;">
          <h3 style="margin-top: 0; color: #1e40af;">Response Preview:</h3>
          <p style="margin: 0; white-space: pre-wrap; color: #374151;">{{responsePreview}}</p>
        </div>

        <a href="{{adminUrl}}" style="display: inline-block; padding: 12px 24px; background-color: #2563eb; color: #ffffff; text-decoration: none; border-radius: 4px; margin: 16px 0; font-weight: bold;">
          Open Support Dashboard
        </a>

        <hr style="margin: 24px 0; border: none; border-top: 1px solid #ddd;">
        <p style="color: #666; font-size: 12px;">
          This is an automated notification from the Cal Poly Pomona Student SOC User Access Request system.
        </p>
      </div>
    `,
    variables: [
      ...TICKET_VARS,
      { name: 'username', description: 'Creator username (pre-escaped HTML)' },
      { name: 'userEmailRowBlock', description: 'User-email table row when available, otherwise empty' },
      { name: 'responsePreview', description: 'First 200 characters of the reply (pre-escaped HTML)' },
      { name: 'adminUrl', description: 'Support dashboard link' },
    ],
  },

  'ticket.status_change': {
    key: 'ticket.status_change',
    label: 'Ticket Status Change',
    category: 'tickets',
    defaultSubject: 'Ticket {{statusWord}}: {{ticketSubject}}',
    defaultBody: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2 style="color: {{statusAccentColor}};">Support Ticket {{statusHeading}}</h2>
        {{greetingBlock}}
        <p>The status of your support ticket has been updated.</p>

        <table style="width: 100%; border-collapse: collapse; margin: 16px 0;">
          <tr>
            <td style="padding: 8px; border: 1px solid #ddd; font-weight: bold; background-color: #f5f5f5;">Ticket Subject:</td>
            <td style="padding: 8px; border: 1px solid #ddd;">{{ticketSubjectHtml}}</td>
          </tr>
          <tr>
            <td style="padding: 8px; border: 1px solid #ddd; font-weight: bold; background-color: #f5f5f5;">Previous Status:</td>
            <td style="padding: 8px; border: 1px solid #ddd;">{{oldStatusLabel}}</td>
          </tr>
          <tr>
            <td style="padding: 8px; border: 1px solid #ddd; font-weight: bold; background-color: #f5f5f5;">New Status:</td>
            <td style="padding: 8px; border: 1px solid #ddd;">
              <strong style="color: {{newStatusColor}};">
                {{newStatusLabel}}
              </strong>
            </td>
          </tr>
          <tr>
            <td style="padding: 8px; border: 1px solid #ddd; font-weight: bold; background-color: #f5f5f5;">Updated By:</td>
            <td style="padding: 8px; border: 1px solid #ddd;">{{changedBy}}</td>
          </tr>
        </table>

        {{statusNoticeBlock}}

        <a href="{{ticketUrl}}" style="display: inline-block; padding: 12px 24px; background-color: {{statusAccentColor}}; color: #ffffff; text-decoration: none; border-radius: 4px; margin: 16px 0; font-weight: bold;">
          View Ticket
        </a>

        <hr style="margin: 24px 0; border: none; border-top: 1px solid #ddd;">
        <p style="color: #666; font-size: 12px;">
          This is an automated notification from the Cal Poly Pomona Student SOC User Access Request system.
        </p>
      </div>
    `,
    variables: [
      ...TICKET_VARS,
      { name: 'statusWord', description: '"Closed" when closed, otherwise "Status Updated" (subject line)' },
      { name: 'statusAccentColor', description: '"#dc2626" when closed, "#2563eb" otherwise' },
      { name: 'statusHeading', description: '"Closed" or "Status Updated" heading suffix' },
      { name: 'greetingBlock', description: '"Hello <name>," paragraph when the name is known, otherwise "Hello,"' },
      { name: 'oldStatusLabel', description: 'Previous status, uppercased with spaces (pre-escaped HTML)' },
      { name: 'newStatusLabel', description: 'New status, uppercased with spaces (pre-escaped HTML)' },
      { name: 'newStatusColor', description: '"#dc2626" when closed, "#059669" otherwise' },
      { name: 'changedBy', description: 'Who changed the status (pre-escaped HTML)' },
      { name: 'statusNoticeBlock', description: 'Closed or status-updated explanation box' },
      { name: 'ticketUrl', description: 'Link to view the ticket' },
    ],
  },

  // ------------------------- Lifecycle & offboarding -------------------------
  'offboard.initial': {
    key: 'offboard.initial',
    label: 'Offboarding — Initial Confirmation Request',
    category: 'lifecycle',
    defaultSubject: 'Action Required: Confirm Continued Account Access',
    defaultBody: `
      <div style="font-family: Arial, sans-serif; max-width: 640px; margin: 0 auto;">
        <h2>Confirm Continued Access</h2>
        <p>Hello {{name}},</p>
        <p>We are reviewing active Student SOC accounts. Please confirm that you still need access for the account below and update your AD password as part of the confirmation.</p>
        <table style="width: 100%; border-collapse: collapse; margin: 16px 0;">
          <tr>
            <td style="padding: 8px; border: 1px solid #ddd; font-weight: bold; background-color: #f5f5f5;">AD Username</td>
            <td style="padding: 8px; border: 1px solid #ddd; font-family: monospace;">{{adUsername}}</td>
          </tr>
          {{vpnUsernameRowBlock}}
          <tr>
            <td style="padding: 8px; border: 1px solid #ddd; font-weight: bold; background-color: #f5f5f5;">Deadline</td>
            <td style="padding: 8px; border: 1px solid #ddd;">{{deadlineText}}</td>
          </tr>
        </table>
        <p>If you do not confirm and successfully update your password by the deadline, your AD account and any linked VPN access may be disabled.</p>
        <a href="{{verificationUrl}}" style="display: inline-block; padding: 12px 24px; background-color: #059669; color: #ffffff; text-decoration: none; border-radius: 4px; margin: 16px 0; font-weight: bold;">
          Confirm Continued Access
        </a>
        <p>Or copy and paste this link into your browser:</p>
        <p style="word-break: break-all; color: #666;">{{verificationUrl}}</p>
        <hr style="margin: 24px 0; border: none; border-top: 1px solid #ddd;">
        <p style="color: #666; font-size: 12px;">
          This link opens a confirmation page first. Your access is only confirmed after you enter your current AD password, choose a new AD password, and Active Directory accepts the change.
        </p>
      </div>
    `,
    variables: [
      { name: 'name', description: 'Recipient full name (pre-escaped HTML)' },
      { name: 'adUsername', description: 'Active Directory username (pre-escaped HTML)' },
      { name: 'vpnUsernameRowBlock', description: 'VPN-username table row when present, otherwise empty' },
      { name: 'deadlineText', description: 'Formatted confirmation deadline (pre-escaped HTML)' },
      { name: 'verificationUrl', description: 'One-time confirmation link' },
    ],
  },

  'offboard.reminder': {
    key: 'offboard.reminder',
    label: 'Offboarding — Confirmation Reminder',
    category: 'lifecycle',
    defaultSubject: 'Reminder: Confirm Continued Account Access by {{deadlineDate}}',
    defaultBody: `
      <div style="font-family: Arial, sans-serif; max-width: 640px; margin: 0 auto;">
        <h2>Access Confirmation Reminder</h2>
        <p>Hello {{name}},</p>
        <p>This is your day {{reminderDay}} reminder to confirm that you still need Student SOC account access and update your AD password.</p>
        <table style="width: 100%; border-collapse: collapse; margin: 16px 0;">
          <tr>
            <td style="padding: 8px; border: 1px solid #ddd; font-weight: bold; background-color: #f5f5f5;">AD Username</td>
            <td style="padding: 8px; border: 1px solid #ddd; font-family: monospace;">{{adUsername}}</td>
          </tr>
          {{vpnUsernameRowBlock}}
          <tr>
            <td style="padding: 8px; border: 1px solid #ddd; font-weight: bold; background-color: #f5f5f5;">Deadline</td>
            <td style="padding: 8px; border: 1px solid #ddd;">{{deadlineText}}</td>
          </tr>
        </table>
        <p>Accounts that are not confirmed with a successful AD password update by the deadline are automatically queued for disable/revoke actions.</p>
        <a href="{{verificationUrl}}" style="display: inline-block; padding: 12px 24px; background-color: #059669; color: #ffffff; text-decoration: none; border-radius: 4px; margin: 16px 0; font-weight: bold;">
          Confirm Continued Access
        </a>
        <p>Or copy and paste this link into your browser:</p>
        <p style="word-break: break-all; color: #666;">{{verificationUrl}}</p>
      </div>
    `,
    variables: [
      { name: 'name', description: 'Recipient full name (pre-escaped HTML)' },
      { name: 'reminderDay', description: 'Campaign day number of this reminder (3 or 6)' },
      { name: 'adUsername', description: 'Active Directory username (pre-escaped HTML)' },
      { name: 'vpnUsernameRowBlock', description: 'VPN-username table row when present, otherwise empty' },
      { name: 'deadlineText', description: 'Formatted confirmation deadline (pre-escaped HTML)' },
      { name: 'deadlineDate', description: 'Confirmation deadline date (short format)' },
      { name: 'verificationUrl', description: 'One-time confirmation link' },
    ],
  },

  'offboard.extension': {
    key: 'offboard.extension',
    label: 'Offboarding — Deadline Extended',
    category: 'lifecycle',
    defaultSubject: 'Your Account Confirmation Deadline Has Been Extended',
    defaultBody: `
      <div style="font-family: Arial, sans-serif; max-width: 640px; margin: 0 auto;">
        <h2>{{heading}}</h2>
        <p>Hello {{name}},</p>
        <p>
          {{introSentence}}
        </p>
        <table style="width: 100%; border-collapse: collapse; margin: 16px 0;">
          <tr>
            <td style="padding: 8px; border: 1px solid #ddd; font-weight: bold; background-color: #f5f5f5;">AD Username</td>
            <td style="padding: 8px; border: 1px solid #ddd; font-family: monospace;">{{adUsername}}</td>
          </tr>
          {{vpnUsernameRowBlock}}
          {{previousDeadlineRowBlock}}
          <tr>
            <td style="padding: 8px; border: 1px solid #ddd; font-weight: bold; background-color: #f5f5f5;">New Deadline</td>
            <td style="padding: 8px; border: 1px solid #ddd;">{{deadlineText}}</td>
          </tr>
        </table>
        {{noteBlock}}
        <p>You must confirm continued access and successfully update your AD password before the new deadline.</p>
        <a href="{{verificationUrl}}" style="display: inline-block; padding: 12px 24px; background-color: #059669; color: #ffffff; text-decoration: none; border-radius: 4px; margin: 16px 0; font-weight: bold;">
          Confirm Continued Access
        </a>
        <p>Or copy and paste this link into your browser:</p>
        <p style="word-break: break-all; color: #666;">{{verificationUrl}}</p>
      </div>
    `,
    variables: [
      { name: 'heading', description: '"Account Confirmation Deadline Extended" (extension) or "Extended Deadline Reminder" (reminder)' },
      { name: 'introSentence', description: 'Intro sentence for the extension or reminder variant' },
      { name: 'name', description: 'Recipient full name (pre-escaped HTML)' },
      { name: 'adUsername', description: 'Active Directory username (pre-escaped HTML)' },
      { name: 'vpnUsernameRowBlock', description: 'VPN-username table row when present, otherwise empty' },
      { name: 'previousDeadlineRowBlock', description: 'Previous-deadline table row (extension only), otherwise empty' },
      { name: 'deadlineText', description: 'Formatted new deadline (pre-escaped HTML)' },
      { name: 'deadlineDate', description: 'New deadline date (short format, reminder subject)' },
      { name: 'noteBlock', description: 'Administrator-note paragraph (extension only), otherwise empty' },
      { name: 'verificationUrl', description: 'One-time confirmation link' },
    ],
  },

  'offboard.extension_reminder': {
    key: 'offboard.extension_reminder',
    label: 'Offboarding — Extended Deadline Reminder',
    category: 'lifecycle',
    defaultSubject: 'Reminder: Extended Account Confirmation Deadline {{deadlineDate}}',
    defaultBody: `
      <div style="font-family: Arial, sans-serif; max-width: 640px; margin: 0 auto;">
        <h2>{{heading}}</h2>
        <p>Hello {{name}},</p>
        <p>
          {{introSentence}}
        </p>
        <table style="width: 100%; border-collapse: collapse; margin: 16px 0;">
          <tr>
            <td style="padding: 8px; border: 1px solid #ddd; font-weight: bold; background-color: #f5f5f5;">AD Username</td>
            <td style="padding: 8px; border: 1px solid #ddd; font-family: monospace;">{{adUsername}}</td>
          </tr>
          {{vpnUsernameRowBlock}}
          {{previousDeadlineRowBlock}}
          <tr>
            <td style="padding: 8px; border: 1px solid #ddd; font-weight: bold; background-color: #f5f5f5;">New Deadline</td>
            <td style="padding: 8px; border: 1px solid #ddd;">{{deadlineText}}</td>
          </tr>
        </table>
        {{noteBlock}}
        <p>You must confirm continued access and successfully update your AD password before the new deadline.</p>
        <a href="{{verificationUrl}}" style="display: inline-block; padding: 12px 24px; background-color: #059669; color: #ffffff; text-decoration: none; border-radius: 4px; margin: 16px 0; font-weight: bold;">
          Confirm Continued Access
        </a>
        <p>Or copy and paste this link into your browser:</p>
        <p style="word-break: break-all; color: #666;">{{verificationUrl}}</p>
      </div>
    `,
    variables: [
      { name: 'heading', description: '"Extended Deadline Reminder" for this template' },
      { name: 'introSentence', description: 'Reminder intro sentence' },
      { name: 'name', description: 'Recipient full name (pre-escaped HTML)' },
      { name: 'adUsername', description: 'Active Directory username (pre-escaped HTML)' },
      { name: 'vpnUsernameRowBlock', description: 'VPN-username table row when present, otherwise empty' },
      { name: 'previousDeadlineRowBlock', description: 'Always empty for reminders (extension-only detail)' },
      { name: 'deadlineText', description: 'Formatted new deadline (pre-escaped HTML)' },
      { name: 'deadlineDate', description: 'New deadline date (short format)' },
      { name: 'noteBlock', description: 'Always empty for reminders (extension-only detail)' },
      { name: 'verificationUrl', description: 'One-time confirmation link' },
    ],
  },

  'offboard.direct_completed': {
    key: 'offboard.direct_completed',
    label: 'Offboarding — Direct Completion Notice',
    category: 'lifecycle',
    defaultSubject: 'Your Student SOC Access Has Been Offboarded',
    defaultBody: `
      <div style="font-family: Arial, sans-serif; max-width: 640px; margin: 0 auto;">
        <h2>Your Student SOC Access Has Been Offboarded</h2>
        <p>Hello {{name}},</p>
        <p>Your Student SOC access has been removed. Your Active Directory account has been disabled.</p>
        <table style="width: 100%; border-collapse: collapse; margin: 16px 0;">
          <tr>
            <td style="padding: 8px; border: 1px solid #ddd; font-weight: bold; background-color: #f5f5f5;">AD Username</td>
            <td style="padding: 8px; border: 1px solid #ddd; font-family: monospace;">{{adUsername}}</td>
          </tr>
          {{vpnUsernameRowBlock}}
        </table>
        {{vpnRevokedNoticeBlock}}
        <p>If you need access again in the future, submit a new account request. A new request is required; this offboarded account cannot be reactivated through this notice.</p>
        <a href="{{requestUrl}}" style="display: inline-block; padding: 12px 24px; background-color: #059669; color: #ffffff; text-decoration: none; border-radius: 4px; margin: 16px 0; font-weight: bold;">
          Submit a New Account Request
        </a>
        <p>If you have questions, <a href="{{supportUrl}}">submit a support ticket</a>.</p>
      </div>
    `,
    variables: [
      { name: 'name', description: 'Recipient full name (pre-escaped HTML)' },
      { name: 'adUsername', description: 'Disabled Active Directory username (pre-escaped HTML)' },
      { name: 'vpnUsernameRowBlock', description: 'VPN-username table row when a linked VPN record was revoked, otherwise empty' },
      { name: 'vpnRevokedNoticeBlock', description: 'Linked VPN-revocation confirmation when applicable, otherwise empty' },
      { name: 'requestUrl', description: 'UAR Portal link to submit a new account request' },
      { name: 'supportUrl', description: 'UAR Portal support-ticket creation link' },
    ],
  },
};

export const ALL_MESSAGE_TEMPLATE_KEYS = Object.keys(MESSAGE_TEMPLATE_CATALOG);

/** Catalog keys are strings validated against the registry at runtime. */
export type MessageTemplateKey = string;

export function isKnownMessageTemplateKey(key: string): key is MessageTemplateKey {
  return Object.prototype.hasOwnProperty.call(MESSAGE_TEMPLATE_CATALOG, key);
}
