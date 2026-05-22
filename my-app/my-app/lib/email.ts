import nodemailer from 'nodemailer';
import { getRequiredEnv } from './env-validator';
import { appLogger } from '@/lib/logger';

/**
 * Escape HTML characters in user-provided content for email templates
 * Prevents HTML injection in email clients
 * 
 * @param text - Text to escape
 * @returns Escaped text safe for HTML emails
 */
function escapeHtml(text: string): string {
  if (!text || typeof text !== 'string') {
    return '';
  }

  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

const smtpPort = parseInt(getRequiredEnv('SMTP_PORT'));
const transporter = nodemailer.createTransport({
  host: getRequiredEnv('SMTP_HOST'),
  port: smtpPort,
  secure: smtpPort === 465,
  requireTLS: smtpPort !== 465,
  tls: {
    rejectUnauthorized: true,
  },
  auth: {
    user: getRequiredEnv('SMTP_USER'),
    pass: getRequiredEnv('SMTP_PASSWORD'),
  },
  logger: true,
  debug: true,
});

export async function sendVerificationEmail(
  email: string,
  name: string,
  verificationToken: string
) {
  appLogger.info('sendVerificationEmail called', {
    to: email,
    name,
    hasToken: !!verificationToken
  });

  const { getEmailConfig } = await import('./email-config');
  const emailConfig = await getEmailConfig();

  const verificationUrl = `${getRequiredEnv('NEXT_PUBLIC_APP_URL')}/api/verify?token=${verificationToken}`;

  const mailOptions = {
    from: emailConfig.emailFrom || getRequiredEnv('EMAIL_FROM'),
    to: email,
    subject: 'Verify Your Access Request - Cal Poly Pomona Student SOC',
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2>Hello ${escapeHtml(name)}!</h2>
        <p>Thank you for submitting your user access request to the Cal Poly Pomona Student SOC.</p>
        <p>Please click the link below to verify your request which is tied to this email address:</p>
        <a href="${verificationUrl}" style="display: inline-block; padding: 12px 24px; background-color: #059669; color: #ffffff; text-decoration: none; border-radius: 4px; margin: 16px 0; font-weight: bold;">
          Verify Email Address
        </a>
        <p>Or copy and paste this link into your browser:</p>
        <p style="word-break: break-all; color: #666;">${verificationUrl}</p>
        <p>This link will expire in 24 hours.</p>
        <hr style="margin: 24px 0; border: none; border-top: 1px solid #ddd;">
        <p style="color: #666; font-size: 12px;">
          If you did not request access, please ignore this email.
        </p>
      </div>
    `,
  };

  try {
    appLogger.info('Attempting to send verification email via SMTP...');
    const info = await transporter.sendMail(mailOptions);
    appLogger.info('✅ Verification email sent successfully', {
      messageId: info.messageId,
      to: email,
      accepted: info.accepted,
      rejected: info.rejected
    });

    if (info.rejected && info.rejected.length > 0) {
      appLogger.error('⚠️ Verification email was rejected by server', { rejected: info.rejected });
      throw new Error(`Email rejected by server for recipients: ${info.rejected.join(', ')}`);
    }

    return info;
  } catch (error) {
    appLogger.error('❌ Failed to send verification email', error);
    throw error;
  }
}

export async function sendAdminNotification(
  requestId: string,
  name: string,
  email: string,
  isInternal: boolean,
  needsDomainAccount: boolean,
  eventReason?: string
) {
  const { getEmailConfig } = await import('./email-config');
  const emailConfig = await getEmailConfig();

  const adminUrl = `${getRequiredEnv('NEXT_PUBLIC_APP_URL')}/admin/requests/${requestId}`;

  const mailOptions = {
    from: emailConfig.emailFrom || getRequiredEnv('EMAIL_FROM'),
    to: emailConfig.adminEmail || getRequiredEnv('ADMIN_EMAIL'),
    subject: `A New ${isInternal ? 'Internal' : 'External'} User Access Request - ${escapeHtml(name)}`,
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2>New Access Request Verified</h2>
        <p>A user has verified their email and is requesting access:</p>
        <table style="width: 100%; border-collapse: collapse; margin: 16px 0;">
          <tr>
            <td style="padding: 8px; border: 1px solid #ddd; font-weight: bold;">Name:</td>
            <td style="padding: 8px; border: 1px solid #ddd;">${escapeHtml(name)}</td>
          </tr>
          <tr>
            <td style="padding: 8px; border: 1px solid #ddd; font-weight: bold;">Email:</td>
            <td style="padding: 8px; border: 1px solid #ddd;">${escapeHtml(email)}</td>
          </tr>
          <tr>
            <td style="padding: 8px; border: 1px solid #ddd; font-weight: bold;">Type:</td>
            <td style="padding: 8px; border: 1px solid #ddd;">${isInternal ? 'Internal Student (@cpp.edu)' : 'External Student'}</td>
          </tr>
          <tr>
            <td style="padding: 8px; border: 1px solid #ddd; font-weight: bold;">Domain Account:</td>
            <td style="padding: 8px; border: 1px solid #ddd;">${needsDomainAccount ? 'Yes' : 'No'}</td>
          </tr>
          ${eventReason ? `
          <tr>
            <td style="padding: 8px; border: 1px solid #ddd; font-weight: bold;">Event/Reason:</td>
            <td style="padding: 8px; border: 1px solid #ddd;">${escapeHtml(eventReason)}</td>
          </tr>
          ` : ''}
        </table>
        <a href="${adminUrl}" style="display: inline-block; padding: 12px 24px; background-color: #059669; color: #ffffff; text-decoration: none; border-radius: 4px; margin: 16px 0; font-weight: bold;">
          Review Request
        </a>
      </div>
    `,
  };

  await transporter.sendMail(mailOptions);
}

export async function sendAccountReadyEmail(
  email: string,
  name: string,
  ldapUsername: string,
  password: string,
  isExternal: boolean,
  approvalMessage?: string
) {
  appLogger.info('sendAccountReadyEmail called', {
    to: email,
    name,
    ldapUsername,
    isExternal,
    hasApprovalMessage: !!approvalMessage
  });

  const { getEmailConfig } = await import('./email-config');
  const emailConfig = await getEmailConfig();

  const loginUrl = `${getRequiredEnv('NEXT_PUBLIC_APP_URL')}/login`;

  const mailOptions = {
    from: emailConfig.emailFrom || getRequiredEnv('EMAIL_FROM'),
    to: email,
    subject: 'Your Account is Ready - Cal Poly Pomona Student SOC',
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2>Account Created Successfully</h2>
        <p>Hello ${escapeHtml(name)},</p>
        <p>Your access request has been approved and your account is now ready!</p>
        ${approvalMessage ? `
        <div style="background-color: #ecfdf5; padding: 16px; border-left: 4px solid #10b981; border-radius: 4px; margin: 16px 0;">
          <h3 style="margin-top: 0; color: #059669;">Message from Administrator</h3>
          <p style="margin: 0; color: #333; white-space: pre-wrap;">${escapeHtml(approvalMessage)}</p>
        </div>
        ` : ''}
        <div style="background-color: #f0fdf4; padding: 16px; border-left: 4px solid #059669; border-radius: 4px; margin: 16px 0;">
          <h3 style="margin-top: 0; color: #059669;">Your Login Credentials</h3>
          <table style="width: 100%; border-collapse: collapse;">
            <tr>
              <td style="padding: 8px; font-weight: bold;">AD Username:</td>
              <td style="padding: 8px; font-family: monospace; background-color: #fff; border-radius: 3px;">${escapeHtml(ldapUsername)}</td>
            </tr>
            <tr>
              <td style="padding: 8px; font-weight: bold;">Password:</td>
              <td style="padding: 8px; font-family: monospace; background-color: #fff; border-radius: 3px;">${escapeHtml(password)}</td>
            </tr>
          </table>
          <p style="margin-bottom: 0; color: #c33; font-size: 14px;"><strong>⚠️ Important:</strong> Please save these credentials securely and change your password upon first login.</p>
        </div>
        <table style="width: 100%; border-collapse: collapse; margin: 16px 0;">
          <tr>
            <td style="padding: 8px; border: 1px solid #ddd; font-weight: bold;">Account Type:</td>
            <td style="padding: 8px; border: 1px solid #ddd;">${isExternal ? 'External (VPN)' : 'Internal'}</td>
          </tr>
        </table>
        <div style="background-color: #f5f5f5; padding: 16px; border-radius: 4px; margin: 16px 0;">
          <h3>Access Your Portal:</h3>
          <p style="margin: 8px 0;">
            ${isExternal
        ? 'As an external user, you can access the VPN portal at:'
        : 'As an internal user, you can access the management portal at:'}
          </p>
          <p style="margin: 8px 0;">
            <a href="${isExternal ? 'https://vpn.sdc.cpp.edu' : 'https://mgmt.sdc.cpp.edu'}" 
               style="color: #059669; font-weight: bold; font-size: 16px;">
              ${isExternal ? 'vpn.sdc.cpp.edu' : 'mgmt.sdc.cpp.edu'}
            </a>
          </p>
          ${isExternal ? `
            <h4 style="margin-top: 16px;">Next Steps for External Users:</h4>
            <ol style="margin: 8px 0;">
              <li>Visit the VPN portal above</li>
              <li>Download and configure the VPN client</li>
              <li>Use your credentials to connect</li>
            </ol>
          ` : ''}
        </div>
        <a href="${loginUrl}" style="display: inline-block; padding: 12px 24px; background-color: #059669; color: #ffffff; text-decoration: none; border-radius: 4px; margin: 16px 0; font-weight: bold;">
          Get Started
        </a>
        <hr style="margin: 24px 0; border: none; border-top: 1px solid #ddd;">
        <p style="color: #666; font-size: 12px;">
          If you have any questions, please contact the IT department.
        </p>
      </div>
    `,
  };

  try {
    appLogger.info('Attempting to send email via SMTP...');
    appLogger.info('Mail options', {
      from: mailOptions.from,
      to: mailOptions.to,
      subject: mailOptions.subject,
      htmlLength: mailOptions.html.length
    });
    const info = await transporter.sendMail(mailOptions);
    appLogger.info('✅ Email sent successfully', {
      messageId: info.messageId,
      to: email,
      accepted: info.accepted,
      rejected: info.rejected,
      response: info.response,
      envelope: info.envelope
    });

    // Check if email was actually accepted by the server
    if (info.rejected && info.rejected.length > 0) {
      appLogger.error('⚠️ Email was rejected by server', { rejected: info.rejected });
      throw new Error(`Email rejected by server for recipients: ${info.rejected.join(', ')}`);
    }

    return info;
  } catch (error) {
    appLogger.error('❌ Failed to send email', error);
    throw error;
  }
}

export async function sendAccountActivationEmail(
  email: string,
  name: string,
  ldapUsername: string,
  activationToken: string,
  expiresAt: Date
) {
  appLogger.info('sendAccountActivationEmail called', {
    to: email,
    name,
    ldapUsername,
    expiresAt
  });

  const activationUrl = `${getRequiredEnv('NEXT_PUBLIC_APP_URL')}/account/activate?token=${activationToken}`;
  const { getEmailConfig } = await import('./email-config');
  const emailConfig = await getEmailConfig();
  const expiryDate = expiresAt.toLocaleDateString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZoneName: 'short'
  });

  const mailOptions = {
    from: emailConfig.emailFrom || getRequiredEnv('EMAIL_FROM'),
    to: email,
    subject: 'Set Up Your Account Password - Cal Poly Pomona Student SOC',
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2>Account Created - Set Your Password</h2>
        <p>Hello ${escapeHtml(name)},</p>
        <p>Your access request has been approved and your Active Directory account has been created!</p>
        
        <div style="background-color: #f0fdf4; padding: 16px; border-left: 4px solid #059669; border-radius: 4px; margin: 16px 0;">
          <h3 style="margin-top: 0; color: #059669;">Your Account Details</h3>
          <table style="width: 100%; border-collapse: collapse;">
            <tr>
              <td style="padding: 8px; font-weight: bold;">AD Username:</td>
              <td style="padding: 8px; font-family: monospace; background-color: #fff; border-radius: 3px;">${escapeHtml(ldapUsername)}</td>
            </tr>
          </table>
        </div>

        <div style="background-color: #fef3c7; padding: 16px; border-left: 4px solid #f59e0b; border-radius: 4px; margin: 16px 0;">
          <h3 style="margin-top: 0; color: #d97706;">Action Required</h3>
          <p style="margin: 8px 0;">You must set your password before you can access your account.</p>
          <p style="margin: 8px 0;">Click the button below to securely set your password:</p>
        </div>

        <a href="${activationUrl}" style="display: inline-block; padding: 12px 24px; background-color: #059669; color: #ffffff; text-decoration: none; border-radius: 4px; margin: 16px 0; font-weight: bold;">
          Set My Password
        </a>

        <div style="background-color: #f5f5f5; padding: 16px; border-radius: 4px; margin: 16px 0;">
          <h4 style="margin-top: 0;">Important Information:</h4>
          <ul style="margin: 8px 0; padding-left: 20px;">
            <li>This activation link expires on <strong>${expiryDate}</strong> (7 days)</li>
            <li>You will need to confirm your AD username when setting your password</li>
            <li>Choose a strong password that meets our security requirements</li>
            <li>If the link expires, you can use the "Forgot Password" feature to set your password</li>
          </ul>
        </div>

        <div style="background-color: #eff6ff; padding: 16px; border-left: 4px solid #3b82f6; border-radius: 4px; margin: 16px 0;">
          <h4 style="margin-top: 0; color: #1e40af;">After Setting Your Password:</h4>
          <p style="margin: 8px 0;">You can access the SOC User Access Request Portal at:</p>
          <p style="margin: 8px 0;">
            <a href="https://portal.sdc.cpp" style="color: #059669; font-weight: bold;">portal.sdc.cpp</a>
          </p>
        </div>

        <hr style="margin: 24px 0; border: none; border-top: 1px solid #ddd;">
        <p style="color: #666; font-size: 12px;">
          If you did not request this account, please contact the IT department immediately.
        </p>
        <p style="color: #666; font-size: 12px;">
          This is an automated email. Please do not reply to this message.
        </p>
      </div>
    `,
  };

  try {
    appLogger.info('Attempting to send activation email via SMTP...');
    const info = await transporter.sendMail(mailOptions);
    appLogger.info('✅ Activation email sent successfully', {
      messageId: info.messageId,
      to: email,
      accepted: info.accepted,
      rejected: info.rejected
    });

    if (info.rejected && info.rejected.length > 0) {
      appLogger.error('⚠️ Activation email was rejected by server', { rejected: info.rejected });
      throw new Error(`Email rejected by server for recipients: ${info.rejected.join(', ')}`);
    }

    return info;
  } catch (error) {
    appLogger.error('❌ Failed to send activation email', error);
    throw error;
  }
}

export async function sendAccountActivationSuccessEmail(
  email: string,
  name: string,
  ldapUsername: string
) {
  appLogger.info('sendAccountActivationSuccessEmail called', {
    to: email,
    name,
    ldapUsername
  });

  const loginUrl = `${getRequiredEnv('NEXT_PUBLIC_APP_URL')}/login`;
  const { getEmailConfig } = await import('./email-config');
  const emailConfig = await getEmailConfig();

  const mailOptions = {
    from: emailConfig.emailFrom || getRequiredEnv('EMAIL_FROM'),
    to: email,
    subject: 'Password Set Successfully - Cal Poly Pomona Student SOC',
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2>Password Set Successfully</h2>
        <p>Hello ${escapeHtml(name)},</p>
        <p>Your password has been set successfully! Your account is now fully activated and ready to use.</p>
        
        <div style="background-color: #f0fdf4; padding: 16px; border-left: 4px solid #059669; border-radius: 4px; margin: 16px 0;">
          <h3 style="margin-top: 0; color: #059669;">Your Login Information</h3>
          <table style="width: 100%; border-collapse: collapse;">
            <tr>
              <td style="padding: 8px; font-weight: bold;">AD Username:</td>
              <td style="padding: 8px; font-family: monospace; background-color: #fff; border-radius: 3px;">${escapeHtml(ldapUsername)}</td>
            </tr>
            <tr>
              <td style="padding: 8px; font-weight: bold;">Password:</td>
              <td style="padding: 8px; color: #666;">The password you just set</td>
            </tr>
          </table>
        </div>

        <div style="background-color: #eff6ff; padding: 16px; border-left: 4px solid #3b82f6; border-radius: 4px; margin: 16px 0;">
          <h3 style="margin-top: 0; color: #1e40af;">Access our Portal</h3>
          <p style="margin: 8px 0;">While connected to the VPN, you can now log in to the SOC User Access Request Portal: </p>
          <p style="margin: 8px 0;">
            <a href="https://portal.sdc.cpp" style="color: #059669; font-weight: bold; font-size: 16px;">portal.sdc.cpp</a>
          </p>
        </div>

        <a href="${loginUrl}" style="display: inline-block; padding: 12px 24px; background-color: #059669; color: #ffffff; text-decoration: none; border-radius: 4px; margin: 16px 0; font-weight: bold;">
          Log In Now
        </a>

        <div style="background-color: #f5f5f5; padding: 16px; border-radius: 4px; margin: 16px 0;">
          <h4 style="margin-top: 0;">Security Reminders:</h4>
          <ul style="margin: 8px 0; padding-left: 20px;">
            <li>Never share your password with anyone</li>
            <li>Use the "Forgot Password" feature if you need to reset your password</li>
            <li>Contact IT if you notice any suspicious activity on your account</li>
          </ul>
        </div>

        <hr style="margin: 24px 0; border: none; border-top: 1px solid #ddd;">
        <p style="color: #666; font-size: 12px;">
          If you have any questions, please contact the IT department.
        </p>
      </div>
    `,
  };

  try {
    appLogger.info('Attempting to send activation success email via SMTP...');
    const info = await transporter.sendMail(mailOptions);
    appLogger.info('✅ Activation success email sent', {
      messageId: info.messageId,
      to: email
    });

    if (info.rejected && info.rejected.length > 0) {
      appLogger.error('⚠️ Email was rejected by server', { rejected: info.rejected });
      throw new Error(`Email rejected by server for recipients: ${info.rejected.join(', ')}`);
    }

    return info;
  } catch (error) {
    appLogger.error('❌ Failed to send activation success email', error);
    throw error;
  }
}

export async function sendManualAssignmentLinkedEmail(params: {
  email: string;
  name: string;
  ldapUsername: string;
  linkedBy: string;
  notes?: string | null;
  isGrandfathered?: boolean;
}) {
  const { email, name, ldapUsername, linkedBy, notes, isGrandfathered } = params;

  const { getEmailConfig } = await import('./email-config');
  const emailConfig = await getEmailConfig();

  const portalUrl = 'https://mgmt.sdc.cpp.edu';
  const supportUrl = `${getRequiredEnv('NEXT_PUBLIC_APP_URL')}/support/create`;

  const mailOptions = {
    from: emailConfig.emailFrom || getRequiredEnv('EMAIL_FROM'),
    to: email,
    subject: 'Your Account Has Been Linked - Cal Poly Pomona Student SOC',
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 640px; margin: 0 auto;">
        <h2 style="margin-bottom: 8px;">Existing Account Linked Successfully</h2>
        <p style="margin: 0 0 16px 0;">Hello ${escapeHtml(name)},</p>
        <p style="margin: 0 0 16px 0;">
          We've confirmed that an existing SDC Domain account already belongs to you and have connected it to your recent access request.
          You can continue signing in with your current credentials—no password reset was required.
        </p>
        <div style="background-color: #f0fdf4; padding: 16px; border-left: 4px solid #059669; border-radius: 6px; margin-bottom: 20px;">
          <h3 style="margin: 0 0 12px 0; color: #047857;">Account Details</h3>
          <table style="width: 100%; border-collapse: collapse;">
            <tr>
              <td style="padding: 8px; font-weight: bold; width: 35%;">AD Username</td>
              <td style="padding: 8px; font-family: monospace; background-color: #fff; border-radius: 4px;">${escapeHtml(ldapUsername)}</td>
            </tr>
            <tr>
              <td style="padding: 8px; font-weight: bold;">Password</td>
              <td style="padding: 8px;">Use your <strong>existing</strong> SDC/Kamino/Proxmox password associated with this username.</td>
            </tr>
            <tr>
              <td style="padding: 8px; font-weight: bold;">Linked By</td>
              <td style="padding: 8px;">${escapeHtml(linkedBy)}</td>
            </tr>
            <tr>
              <td style="padding: 8px; font-weight: bold;">Link Type</td>
              <td style="padding: 8px;">${isGrandfathered ? 'Grandfathered account (existing AD user without email)' : 'Manual assignment to existing AD account'}</td>
            </tr>
          </table>
        </div>
        <div style="background-color: #eef2ff; padding: 16px; border-left: 4px solid #6366f1; border-radius: 6px; margin-bottom: 20px;">
          <h3 style="margin: 0 0 12px 0; color: #4338ca;">Next Steps</h3>
          <ol style="margin: 0; padding-left: 20px; color: #312e81;">
            <li style="margin-bottom: 8px;">Use <a href="${portalUrl}" style="color: #4338ca; font-weight: bold;">${portalUrl.replace('https://', '')}</a> as the gateway address to get on the VPN.</li>
            <li style="margin-bottom: 8px;">Login to <a href="https://portal.sdc.cpp" style="color: #4338ca; font-weight: bold;">portal.sdc.cpp</a>.</li>
          </ol>
        </div>
        ${notes ? `
          <div style=\"background-color: #fef3c7; padding: 16px; border-left: 4px solid #f59e0b; border-radius: 6px; margin-bottom: 20px;\">
            <h3 style=\"margin: 0 0 12px 0; color: #d97706;\">Notes from the Team</h3>
            <p style=\"margin: 0; white-space: pre-wrap;\">${escapeHtml(notes)}</p>
          </div>
        ` : ''}
        <p style="margin: 0 0 16px 0;">
          Need anything else? You can create a ticket through the UAR Portal and Staff will be notified.
        </p>
        <a href="${supportUrl}" style="display: inline-block; padding: 12px 24px; background-color: #059669; color: #ffffff; text-decoration: none; border-radius: 6px; font-weight: bold;">Open Support Ticket</a>
        <p style="margin: 24px 0 0 0; color: #6b7280; font-size: 12px;">
          This notification confirms the successful linkage of your existing Student Data Center account to your current access request.
        </p>
      </div>
    `,
  };

  await transporter.sendMail(mailOptions);
}

export async function sendCredentialsEmail(
  email: string,
  name: string,
  ldapUsername: string,
  password: string,
  expiresAt: Date
) {
  appLogger.info('sendCredentialsEmail called', {
    to: email,
    name,
    ldapUsername,
    expiresAt
  });

  const { getEmailConfig } = await import('./email-config');
  const emailConfig = await getEmailConfig();

  const mailOptions = {
    from: emailConfig.emailFrom || getRequiredEnv('EMAIL_FROM'),
    to: email,
    subject: 'Your VPN Account Credentials - Cal Poly Pomona Student SOC',
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2>VPN Account Created</h2>
        <p>Hello ${escapeHtml(name)},</p>
        <p>Your VPN account has been created successfully. Below are your login credentials:</p>
        <div style="background-color: #f0fdf4; padding: 16px; border-left: 4px solid #059669; border-radius: 4px; margin: 16px 0;">
          <h3 style="margin-top: 0; color: #059669;">Your Login Credentials</h3>
          <table style="width: 100%; border-collapse: collapse;">
            <tr>
              <td style="padding: 8px; font-weight: bold;">AD Username:</td>
              <td style="padding: 8px; font-family: monospace; background-color: #fff; border-radius: 3px;">${escapeHtml(ldapUsername)}</td>
            </tr>
            <tr>
              <td style="padding: 8px; font-weight: bold;">Password:</td>
              <td style="padding: 8px; font-family: monospace; background-color: #fff; border-radius: 3px;">${escapeHtml(password)}</td>
            </tr>
            <tr>
              <td style="padding: 8px; font-weight: bold;">Expires:</td>
              <td style="padding: 8px; font-family: monospace; background-color: #fff; border-radius: 3px;">${escapeHtml(expiresAt.toLocaleDateString())}</td>
            </tr>
          </table>
          <p style="margin-bottom: 0; color: #c33; font-size: 14px;"><strong>⚠️ Important:</strong> Please save these credentials securely.</p>
        </div>
        <div style="background-color: #f5f5f5; padding: 16px; border-radius: 4px; margin: 16px 0;">
          <h3>Access Your VPN Portal:</h3>
          <p style="margin: 8px 0;">
            <a href="https://vpn.sdc.cpp.edu" 
               style="color: #059669; font-weight: bold; font-size: 16px;">
              vpn.sdc.cpp.edu
            </a>
          </p>
          <h4 style="margin-top: 16px;">Next Steps:</h4>
          <ol style="margin: 8px 0;">
            <li>Visit the VPN portal above</li>
            <li>Download and configure the VPN client</li>
            <li>Use your credentials to connect</li>
          </ol>
        </div>
        <hr style="margin: 24px 0; border: none; border-top: 1px solid #ddd;">
        <p style="color: #666; font-size: 12px;">
          If you have any questions, please contact the IT department.
        </p>
      </div>
    `,
  };

  try {
    appLogger.info('Attempting to send credentials email via SMTP...');
    const info = await transporter.sendMail(mailOptions);
    appLogger.info('✅ Credentials email sent successfully', {
      messageId: info.messageId,
      to: email
    });

    if (info.rejected && info.rejected.length > 0) {
      appLogger.error('⚠️ Email was rejected by server', { rejected: info.rejected });
      throw new Error(`Email rejected by server for recipients: ${info.rejected.join(', ')}`);
    }

    return info;
  } catch (error) {
    appLogger.error('❌ Failed to send credentials email', error);
    throw error;
  }
}

export async function sendRejectionEmail(
  email: string,
  name: string,
  reason: string
) {
  const { getEmailConfig } = await import('./email-config');
  const emailConfig = await getEmailConfig();

  const mailOptions = {
    from: emailConfig.emailFrom || getRequiredEnv('EMAIL_FROM'),
    to: email,
    subject: 'Access Request Update - Cal Poly Pomona Student SOC',
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2>Access Request Status Update</h2>
        <p>Hello ${escapeHtml(name)},</p>
        <p>Thank you for your interest in accessing the Cal Poly Pomona Student SOC systems.</p>
        <p>After review, your access request has been declined for the following reason:</p>
        <div style="background-color: #fee; padding: 16px; border-left: 4px solid #c33; border-radius: 4px; margin: 16px 0;">
          <p style="margin: 0; color: #c33; font-weight: bold;">Reason:</p>
          <p style="margin: 8px 0 0 0; color: #333;">${escapeHtml(reason)}</p>
        </div>
        <p>If you believe this decision was made in error or if you have any questions, please contact us to discuss your request further.</p>
        <hr style="margin: 24px 0; border: none; border-top: 1px solid #ddd;">
        <p style="color: #666; font-size: 12px;">
          If you have any questions, please contact the IT department or Student SOC administrators.
        </p>
      </div>
    `,
  };

  await transporter.sendMail(mailOptions);
}

export async function sendPasswordResetEmail(
  email: string,
  resetToken: string,
  options: { initiatedByAdmin?: boolean } = {}
) {
  appLogger.info('sendPasswordResetEmail called', {
    to: email,
    hasToken: !!resetToken,
    initiatedByAdmin: Boolean(options.initiatedByAdmin),
  });

  const { getEmailConfig } = await import('./email-config');
  const emailConfig = await getEmailConfig();

  const resetUrl = `${getRequiredEnv('NEXT_PUBLIC_APP_URL')}/reset-password?token=${resetToken}`;
  const subject = options.initiatedByAdmin
    ? 'Administrator Password Reset Link - Cal Poly Pomona Student SOC'
    : 'Password Reset Request - Cal Poly Pomona Student SOC';
  const heading = options.initiatedByAdmin
    ? 'Administrator Password Reset Link'
    : 'Password Reset Request';
  const intro = options.initiatedByAdmin
    ? 'A Student SOC administrator has issued a one-time link for you to reset your Active Directory account password.'
    : 'You have requested to reset your Active Directory account password.';
  const notice = options.initiatedByAdmin
    ? 'If you were not expecting this administrator-issued reset link, contact Student SOC support before using it. Your password will remain unchanged unless you complete the reset form.'
    : 'If you did not request a password reset, please ignore this email. Your password will remain unchanged.';

  const mailOptions = {
    from: emailConfig.emailFrom || getRequiredEnv('EMAIL_FROM'),
    to: email,
    subject,
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2>${heading}</h2>
        <p>${intro}</p>
        <p>Click the one-time link below to reset your password:</p>
        <a href="${resetUrl}" style="display: inline-block; padding: 12px 24px; background-color: #059669; color: #ffffff; text-decoration: none; border-radius: 4px; margin: 16px 0; font-weight: bold;">
          Reset Password
        </a>
        <p>Or copy and paste this link into your browser:</p>
        <p style="word-break: break-all; color: #666;">${resetUrl}</p>
        <p><strong>This one-time link will expire in 1 hour.</strong></p>
        <div style="background-color: #fff3cd; padding: 16px; border-left: 4px solid #ffc107; border-radius: 4px; margin: 16px 0;">
          <p style="margin: 0; color: #856404;">
            <strong>Security Notice:</strong> ${notice}
          </p>
        </div>
        <hr style="margin: 24px 0; border: none; border-top: 1px solid #ddd;">
        <p style="color: #666; font-size: 12px;">
          If you have any questions, please contact the IT department.
        </p>
      </div>
    `,
  };

  try {
    appLogger.info('Attempting to send password reset email via SMTP...');
    const info = await transporter.sendMail(mailOptions);
    appLogger.info('✅ Password reset email sent successfully', {
      messageId: info.messageId,
      to: email,
      accepted: info.accepted,
      rejected: info.rejected
    });

    if (info.rejected && info.rejected.length > 0) {
      appLogger.error('⚠️ Password reset email was rejected by server', { rejected: info.rejected });
      throw new Error(`Email rejected by server for recipients: ${info.rejected.join(', ')}`);
    }

    return info;
  } catch (error) {
    appLogger.error('❌ Failed to send password reset email', error);
    throw error;
  }
}

export async function sendProfileEmailVerification(
  email: string,
  name: string,
  verificationToken: string
) {
  const { getEmailConfig } = await import('./email-config');
  const emailConfig = await getEmailConfig();

  const verificationUrl = `${getRequiredEnv('NEXT_PUBLIC_APP_URL')}/api/profile/verify-email/confirm?token=${verificationToken}`;

  const mailOptions = {
    from: emailConfig.emailFrom || getRequiredEnv('EMAIL_FROM'),
    to: email,
    subject: 'Verify Your Email Address - Cal Poly Pomona Student SOC',
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2>Hello ${escapeHtml(name)}!</h2>
        <p>You have requested to add this email address to your Student SOC account.</p>
        <p>Please click the link below to verify your email address:</p>
        <a href="${verificationUrl}" style="display: inline-block; padding: 12px 24px; background-color: #059669; color: #ffffff; text-decoration: none; border-radius: 4px; margin: 16px 0; font-weight: bold;">
          Verify Email Address
        </a>
        <p>Or copy and paste this link into your browser:</p>
        <p style="word-break: break-all; color: #666;">${verificationUrl}</p>
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
  };

  await transporter.sendMail(mailOptions);
}

/**
 * Send email notification when VPN account is created and waiting for faculty approval
 */
export async function sendVPNPendingFacultyNotification(
  facultyEmail: string,
  accountUsername: string,
  accountName: string,
  accountEmail: string,
  portalType: string,
  createdBy: string
) {
  const { getEmailConfig } = await import('./email-config');
  const emailConfig = await getEmailConfig();

  appLogger.info('sendVPNPendingFacultyNotification called', {
    to: facultyEmail,
    accountUsername,
    accountName,
    portalType,
    createdBy
  });

  const adminUrl = `${getRequiredEnv('NEXT_PUBLIC_APP_URL')}/admin`;

  const mailOptions = {
    from: emailConfig.emailFrom || getRequiredEnv('EMAIL_FROM'),
    to: facultyEmail,
    subject: `VPN Account Pending Faculty Approval - ${escapeHtml(accountName)}`,
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2>VPN Account Awaiting Faculty Approval</h2>
        <p>A new VPN account has been created and is pending faculty approval:</p>
        <table style="width: 100%; border-collapse: collapse; margin: 16px 0;">
          <tr>
            <td style="padding: 8px; border: 1px solid #ddd; font-weight: bold;">Username:</td>
            <td style="padding: 8px; border: 1px solid #ddd; font-family: monospace;">${escapeHtml(accountUsername)}</td>
          </tr>
          <tr>
            <td style="padding: 8px; border: 1px solid #ddd; font-weight: bold;">Name:</td>
            <td style="padding: 8px; border: 1px solid #ddd;">${escapeHtml(accountName)}</td>
          </tr>
          <tr>
            <td style="padding: 8px; border: 1px solid #ddd; font-weight: bold;">Email:</td>
            <td style="padding: 8px; border: 1px solid #ddd;">${escapeHtml(accountEmail)}</td>
          </tr>
          <tr>
            <td style="padding: 8px; border: 1px solid #ddd; font-weight: bold;">Portal Type:</td>
            <td style="padding: 8px; border: 1px solid #ddd;">${escapeHtml(portalType)}</td>
          </tr>
          <tr>
            <td style="padding: 8px; border: 1px solid #ddd; font-weight: bold;">Created By:</td>
            <td style="padding: 8px; border: 1px solid #ddd;">${escapeHtml(createdBy)}</td>
          </tr>
        </table>
        <div style="background-color: #fef3c7; padding: 16px; border-left: 4px solid #f59e0b; border-radius: 4px; margin: 16px 0;">
          <p style="margin: 0; color: #333;">
            <strong>Action Required:</strong><br>
            Please review this account and approve or modify its status in the admin panel.
          </p>
        </div>
        <a href="${adminUrl}" style="display: inline-block; padding: 12px 24px; background-color: #059669; color: #ffffff; text-decoration: none; border-radius: 4px; margin: 16px 0; font-weight: bold;">
          Review in Admin Panel
        </a>
      </div>
    `,
  };

  try {
    appLogger.info('Attempting to send VPN pending faculty notification...');
    const info = await transporter.sendMail(mailOptions);
    appLogger.info('✅ VPN pending faculty notification sent successfully', {
      messageId: info.messageId,
      to: facultyEmail,
    });
    return info;
  } catch (error) {
    appLogger.error('❌ Failed to send VPN pending faculty notification', error);
    throw error;
  }
}

/**
 * Send email notification to all student directors about important events
 */
export async function sendStudentDirectorNotification(
  subject: string,
  message: string,
  details?: Record<string, string>
) {
  const { getEmailConfig, getStudentDirectorEmails } = await import('./email-config');
  const emailConfig = await getEmailConfig();

  console.log('[Email] sendStudentDirectorNotification called with subject:', subject);

  // Get student director emails from database or environment variable
  const directorEmails = await getStudentDirectorEmails();

  if (directorEmails.length === 0) {
    console.warn('[Email] ⚠️ No student director emails configured');
    return;
  }

  const detailsHtml = details ? `
    <table style="width: 100%; border-collapse: collapse; margin: 16px 0;">
      ${Object.entries(details).map(([key, value]) => `
        <tr>
          <td style="padding: 8px; border: 1px solid #ddd; font-weight: bold;">${escapeHtml(key)}:</td>
          <td style="padding: 8px; border: 1px solid #ddd;">${escapeHtml(value)}</td>
        </tr>
      `).join('')}
    </table>
  ` : '';

  const mailOptions = {
    from: emailConfig.emailFrom || getRequiredEnv('EMAIL_FROM'),
    to: directorEmails.join(','),
    subject: `[Student Directors] ${subject}`,
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2>Student Director Notification</h2>
        <div style="background-color: #ecfdf5; padding: 16px; border-left: 4px solid #10b981; border-radius: 4px; margin: 16px 0;">
          <p style="margin: 0; color: #333; white-space: pre-wrap;">${escapeHtml(message)}</p>
        </div>
        ${detailsHtml}
        <a href="${getRequiredEnv('NEXT_PUBLIC_APP_URL')}/admin" style="display: inline-block; padding: 12px 24px; background-color: #059669; color: #ffffff; text-decoration: none; border-radius: 4px; margin: 16px 0; font-weight: bold;">
          View Admin Dashboard
        </a>
        <hr style="margin: 24px 0; border: none; border-top: 1px solid #ddd;">
        <p style="color: #666; font-size: 12px;">
          This is an automated notification for student directors of Cal Poly Pomona Student SOC.
        </p>
      </div>
    `,
  };

  try {
    console.log('[Email] Attempting to send student director notification to:', directorEmails);
    const info = await transporter.sendMail(mailOptions);
    console.log('[Email] ✅ Student director notification sent successfully:', {
      messageId: info.messageId,
      to: directorEmails,
    });
    return info;
  } catch (error) {
    console.error('[Email] ❌ Failed to send student director notification:', error);
    throw error;
  }
}

/**
 * Send notification to faculty for approval
 * @param requestId - Access request ID
 * @param name - Requester name
 * @param email - Requester email
 * @param isInternal - Whether requester is internal
 * @param needsDomainAccount - Whether domain account is needed
 * @param eventReason - Event or reason for access
 * @param eventName - Event name if associated
 * @param customMessage - Optional custom message from admin
 */
export async function sendFacultyNotification(
  requestId: string,
  name: string,
  email: string,
  isInternal: boolean,
  needsDomainAccount: boolean,
  eventReason?: string,
  eventName?: string,
  customMessage?: string
) {
  console.log('[Email] sendFacultyNotification called with:', {
    requestId,
    name,
    email,
    isInternal,
    needsDomainAccount,
    hasCustomMessage: !!customMessage,
  });

  const { getEmailConfig } = await import('./email-config');
  const emailConfig = await getEmailConfig();

  const facultyEmail = emailConfig.facultyEmail;

  if (!facultyEmail) {
    throw new Error('Faculty email not configured. Please set FACULTY_EMAIL environment variable or configure in system settings.');
  }

  const adminUrl = `${getRequiredEnv('NEXT_PUBLIC_APP_URL')}/admin/requests/${requestId}`;

  const mailOptions = {
    from: emailConfig.emailFrom || getRequiredEnv('EMAIL_FROM'),
    to: facultyEmail,
    subject: `Faculty Approval Requested - ${escapeHtml(name)} Access Request`,
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2 style="color: #059669;">Faculty Approval Requested</h2>
        <p>A student access request has been reviewed by the Student Directors and is now awaiting faculty approval.</p>
        
        ${customMessage ? `
        <div style="background-color: #fef3c7; padding: 16px; border-left: 4px solid #f59e0b; border-radius: 4px; margin: 16px 0;">
          <h3 style="margin-top: 0; color: #92400e;">Message from Student Director</h3>
          <p style="margin: 0; color: #333; white-space: pre-wrap;">${escapeHtml(customMessage)}</p>
        </div>
        ` : ''}
        
        <table style="width: 100%; border-collapse: collapse; margin: 16px 0;">
          <tr>
            <td style="padding: 8px; border: 1px solid #ddd; font-weight: bold; background-color: #f5f5f5;">Name:</td>
            <td style="padding: 8px; border: 1px solid #ddd;">${escapeHtml(name)}</td>
          </tr>
          <tr>
            <td style="padding: 8px; border: 1px solid #ddd; font-weight: bold; background-color: #f5f5f5;">Email:</td>
            <td style="padding: 8px; border: 1px solid #ddd;">${escapeHtml(email)}</td>
          </tr>
          <tr>
            <td style="padding: 8px; border: 1px solid #ddd; font-weight: bold; background-color: #f5f5f5;">Type:</td>
            <td style="padding: 8px; border: 1px solid #ddd;">${isInternal ? 'Internal Student (@cpp.edu)' : 'External Student'}</td>
          </tr>
          <tr>
            <td style="padding: 8px; border: 1px solid #ddd; font-weight: bold; background-color: #f5f5f5;">Domain Account:</td>
            <td style="padding: 8px; border: 1px solid #ddd;">${needsDomainAccount ? 'Required' : 'Not Required'}</td>
          </tr>
          ${eventName ? `
          <tr>
            <td style="padding: 8px; border: 1px solid #ddd; font-weight: bold; background-color: #f5f5f5;">Event:</td>
            <td style="padding: 8px; border: 1px solid #ddd;">${escapeHtml(eventName)}</td>
          </tr>
          ` : ''}
          ${eventReason ? `
          <tr>
            <td style="padding: 8px; border: 1px solid #ddd; font-weight: bold; background-color: #f5f5f5;">Reason:</td>
            <td style="padding: 8px; border: 1px solid #ddd;">${escapeHtml(eventReason)}</td>
          </tr>
          ` : ''}
        </table>
        
        <div style="background-color: #ecfdf5; padding: 16px; border-left: 4px solid #10b981; border-radius: 4px; margin: 16px 0;">
          <h3 style="margin-top: 0; color: #059669;">Next Steps</h3>
          <p style="margin: 0;">Please review this request in the admin dashboard. You can approve or provide additional guidance to the Student Directors.</p>
        </div>
        
        <a href="${adminUrl}" style="display: inline-block; padding: 12px 24px; background-color: #059669; color: #ffffff; text-decoration: none; border-radius: 4px; margin: 16px 0; font-weight: bold;">
          Review Request
        </a>
        
        <hr style="margin: 24px 0; border: none; border-top: 1px solid #ddd;">
        <p style="color: #666; font-size: 12px;">
          This is an automated notification from the Cal Poly Pomona Student SOC User Access Request system.<br>
          If you have questions, please contact the Student SOC directors.
        </p>
      </div>
    `,
  };

  try {
    console.log('[Email] Attempting to send faculty notification to:', facultyEmail);
    const info = await transporter.sendMail(mailOptions);
    console.log('[Email] ✅ Faculty notification sent successfully:', {
      messageId: info.messageId,
      to: facultyEmail,
    });
    return info;
  } catch (error) {
    console.error('[Email] ❌ Failed to send faculty notification:', error);
    throw error;
  }
}

/**
 * Send email notification when a new support ticket is created
 */
export async function sendNewTicketNotificationToAdmin(params: {
  ticketId: string;
  subject: string;
  category?: string | null;
  severity?: string | null;
  username: string;
  userEmail?: string | null;
  body: string;
}) {
  const { ticketId, subject, category, severity, username, userEmail, body } = params;

  console.log('[Email] sendNewTicketNotificationToAdmin called with:', {
    ticketId,
    subject,
    username,
    hasEmail: !!userEmail,
  });

  const { getEmailConfig } = await import('./email-config');
  const emailConfig = await getEmailConfig();

  const adminEmail = emailConfig.adminEmail;

  if (!adminEmail) {
    console.warn('[Email] Admin email not configured. Skipping new ticket notification.');
    return;
  }

  const ticketUrl = `${getRequiredEnv('NEXT_PUBLIC_APP_URL')}/admin`;
  const bodyPreview = body.substring(0, 200) + (body.length > 200 ? '...' : '');

  const mailOptions = {
    from: emailConfig.emailFrom || getRequiredEnv('EMAIL_FROM'),
    to: adminEmail,
    subject: `New Support Ticket: ${subject}`,
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2 style="color: #dc2626;">New Support Ticket Created</h2>
        <p>A user has submitted a new support ticket that requires your attention.</p>
        
        <table style="width: 100%; border-collapse: collapse; margin: 16px 0;">
          <tr>
            <td style="padding: 8px; border: 1px solid #ddd; font-weight: bold; background-color: #f5f5f5;">Ticket ID:</td>
            <td style="padding: 8px; border: 1px solid #ddd;">${escapeHtml(ticketId)}</td>
          </tr>
          <tr>
            <td style="padding: 8px; border: 1px solid #ddd; font-weight: bold; background-color: #f5f5f5;">Subject:</td>
            <td style="padding: 8px; border: 1px solid #ddd;">${escapeHtml(subject)}</td>
          </tr>
          <tr>
            <td style="padding: 8px; border: 1px solid #ddd; font-weight: bold; background-color: #f5f5f5;">Username:</td>
            <td style="padding: 8px; border: 1px solid #ddd;">${escapeHtml(username)}</td>
          </tr>
          ${userEmail ? `
          <tr>
            <td style="padding: 8px; border: 1px solid #ddd; font-weight: bold; background-color: #f5f5f5;">User Email:</td>
            <td style="padding: 8px; border: 1px solid #ddd;">${escapeHtml(userEmail)}</td>
          </tr>
          ` : ''}
          ${category ? `
          <tr>
            <td style="padding: 8px; border: 1px solid #ddd; font-weight: bold; background-color: #f5f5f5;">Category:</td>
            <td style="padding: 8px; border: 1px solid #ddd;">${escapeHtml(category)}</td>
          </tr>
          ` : ''}
          ${severity ? `
          <tr>
            <td style="padding: 8px; border: 1px solid #ddd; font-weight: bold; background-color: #f5f5f5;">Severity:</td>
            <td style="padding: 8px; border: 1px solid #ddd;">
              <span style="padding: 4px 8px; border-radius: 4px; background-color: ${severity === 'critical' ? '#fee2e2' :
          severity === 'high' ? '#fed7aa' :
            severity === 'medium' ? '#fef3c7' : '#f0fdf4'
        }; color: ${severity === 'critical' ? '#991b1b' :
          severity === 'high' ? '#9a3412' :
            severity === 'medium' ? '#92400e' : '#166534'
        };">
                ${escapeHtml(severity.toUpperCase())}
              </span>
            </td>
          </tr>
          ` : ''}
        </table>
        
        <div style="background-color: #f9fafb; padding: 16px; border-radius: 4px; margin: 16px 0;">
          <h3 style="margin-top: 0;">Message Preview:</h3>
          <p style="margin: 0; white-space: pre-wrap; color: #374151;">${escapeHtml(bodyPreview)}</p>
        </div>
        
        <a href="${ticketUrl}" style="display: inline-block; padding: 12px 24px; background-color: #dc2626; color: #ffffff; text-decoration: none; border-radius: 4px; margin: 16px 0; font-weight: bold;">
          View Ticket in Admin Dashboard
        </a>
        
        <hr style="margin: 24px 0; border: none; border-top: 1px solid #ddd;">
        <p style="color: #666; font-size: 12px;">
          This is an automated notification from the Cal Poly Pomona Student SOC User Access Request system.
        </p>
      </div>
    `,
  };

  try {
    console.log('[Email] Attempting to send new ticket notification to admin:', adminEmail);
    const info = await transporter.sendMail(mailOptions);
    console.log('[Email] ✅ New ticket notification sent successfully:', {
      messageId: info.messageId,
      to: adminEmail,
    });
    return info;
  } catch (error) {
    console.error('[Email] ❌ Failed to send new ticket notification:', error);
    // Don't throw - we don't want ticket creation to fail if email fails
  }
}

/**
 * Send email notification when staff responds to a user's ticket
 */
export async function sendTicketResponseToUser(params: {
  ticketId: string;
  subject: string;
  userEmail: string;
  userName?: string;
  responseMessage: string;
  staffUsername: string;
}) {
  const { ticketId, subject, userEmail, userName, responseMessage, staffUsername } = params;

  console.log('[Email] sendTicketResponseToUser called with:', {
    ticketId,
    subject,
    userEmail,
    staffUsername,
  });

  const { getEmailConfig } = await import('./email-config');
  const emailConfig = await getEmailConfig();

  const ticketUrl = `${getRequiredEnv('NEXT_PUBLIC_APP_URL')}/support/tickets/${ticketId}`;

  const mailOptions = {
    from: emailConfig.emailFrom || getRequiredEnv('EMAIL_FROM'),
    to: userEmail,
    subject: `Response to Your Support Ticket: ${subject}`,
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2 style="color: #059669;">Staff Response to Your Support Ticket</h2>
        ${userName ? `<p>Hello ${escapeHtml(userName)},</p>` : '<p>Hello,</p>'}
        <p>A staff member has responded to your support ticket.</p>
        
        <table style="width: 100%; border-collapse: collapse; margin: 16px 0;">
          <tr>
            <td style="padding: 8px; border: 1px solid #ddd; font-weight: bold; background-color: #f5f5f5;">Ticket Subject:</td>
            <td style="padding: 8px; border: 1px solid #ddd;">${escapeHtml(subject)}</td>
          </tr>
          <tr>
            <td style="padding: 8px; border: 1px solid #ddd; font-weight: bold; background-color: #f5f5f5;">Responded By:</td>
            <td style="padding: 8px; border: 1px solid #ddd;">${escapeHtml(staffUsername)}</td>
          </tr>
        </table>
        
        <div style="background-color: #ecfdf5; padding: 16px; border-left: 4px solid #10b981; border-radius: 4px; margin: 16px 0;">
          <h3 style="margin-top: 0; color: #059669;">Response:</h3>
          <p style="margin: 0; white-space: pre-wrap; color: #374151;">${escapeHtml(responseMessage)}</p>
        </div>
        
        <a href="${ticketUrl}" style="display: inline-block; padding: 12px 24px; background-color: #059669; color: #ffffff; text-decoration: none; border-radius: 4px; margin: 16px 0; font-weight: bold;">
          View Full Ticket
        </a>
        
        <hr style="margin: 24px 0; border: none; border-top: 1px solid #ddd;">
        <p style="color: #666; font-size: 12px;">
          You can reply to this ticket by logging into the support portal.<br>
          If you did not submit this ticket, please contact the IT department immediately.
        </p>
      </div>
    `,
  };

  try {
    console.log('[Email] Attempting to send ticket response to user:', userEmail);
    const info = await transporter.sendMail(mailOptions);
    console.log('[Email] ✅ Ticket response sent successfully:', {
      messageId: info.messageId,
      to: userEmail,
    });
    return info;
  } catch (error) {
    console.error('[Email] ❌ Failed to send ticket response:', error);
    // Don't throw - we don't want response creation to fail if email fails
  }
}

/**
 * Send email notification to admin when a user responds to a ticket
 */
export async function sendUserResponseNotificationToAdmin(params: {
  ticketId: string;
  subject: string;
  username: string;
  userEmail?: string | null;
  responseMessage: string;
}) {
  const { ticketId, subject, username, userEmail, responseMessage } = params;

  console.log('[Email] sendUserResponseNotificationToAdmin called with:', {
    ticketId,
    subject,
    username,
    hasEmail: !!userEmail,
  });

  const { getEmailConfig } = await import('./email-config');
  const emailConfig = await getEmailConfig();

  const adminEmail = emailConfig.adminEmail;

  if (!adminEmail) {
    console.warn('[Email] Admin email not configured. Skipping user response notification.');
    return;
  }

  const ticketUrl = `${getRequiredEnv('NEXT_PUBLIC_APP_URL')}/admin`;
  const responsePreview = responseMessage.substring(0, 200) + (responseMessage.length > 200 ? '...' : '');

  const mailOptions = {
    from: emailConfig.emailFrom || getRequiredEnv('EMAIL_FROM'),
    to: adminEmail,
    subject: `User Response on Ticket: ${subject}`,
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2 style="color: #2563eb;">User Response on Support Ticket</h2>
        <p>A user has replied to an existing support ticket.</p>
        
        <table style="width: 100%; border-collapse: collapse; margin: 16px 0;">
          <tr>
            <td style="padding: 8px; border: 1px solid #ddd; font-weight: bold; background-color: #f5f5f5;">Ticket ID:</td>
            <td style="padding: 8px; border: 1px solid #ddd;">${escapeHtml(ticketId)}</td>
          </tr>
          <tr>
            <td style="padding: 8px; border: 1px solid #ddd; font-weight: bold; background-color: #f5f5f5;">Subject:</td>
            <td style="padding: 8px; border: 1px solid #ddd;">${escapeHtml(subject)}</td>
          </tr>
          <tr>
            <td style="padding: 8px; border: 1px solid #ddd; font-weight: bold; background-color: #f5f5f5;">Username:</td>
            <td style="padding: 8px; border: 1px solid #ddd;">${escapeHtml(username)}</td>
          </tr>
          ${userEmail ? `
          <tr>
            <td style="padding: 8px; border: 1px solid #ddd; font-weight: bold; background-color: #f5f5f5;">User Email:</td>
            <td style="padding: 8px; border: 1px solid #ddd;">${escapeHtml(userEmail)}</td>
          </tr>
          ` : ''}
        </table>
        
        <div style="background-color: #eff6ff; padding: 16px; border-left: 4px solid #3b82f6; border-radius: 4px; margin: 16px 0;">
          <h3 style="margin-top: 0; color: #1e40af;">Response Preview:</h3>
          <p style="margin: 0; white-space: pre-wrap; color: #374151;">${escapeHtml(responsePreview)}</p>
        </div>
        
        <a href="${ticketUrl}" style="display: inline-block; padding: 12px 24px; background-color: #2563eb; color: #ffffff; text-decoration: none; border-radius: 4px; margin: 16px 0; font-weight: bold;">
          View Ticket in Admin Dashboard
        </a>
        
        <hr style="margin: 24px 0; border: none; border-top: 1px solid #ddd;">
        <p style="color: #666; font-size: 12px;">
          This is an automated notification from the Cal Poly Pomona Student SOC User Access Request system.
        </p>
      </div>
    `,
  };

  try {
    console.log('[Email] Attempting to send user response notification to admin:', adminEmail);
    const info = await transporter.sendMail(mailOptions);
    console.log('[Email] ✅ User response notification sent successfully:', {
      messageId: info.messageId,
      to: adminEmail,
    });
    return info;
  } catch (error) {
    console.error('[Email] ❌ Failed to send user response notification:', error);
    // Don't throw - we don't want response creation to fail if email fails
  }
}

/**
 * Send email notification when a ticket status changes (closed/reopened)
 */
export async function sendTicketStatusChangeToUser(params: {
  ticketId: string;
  subject: string;
  userEmail: string;
  userName?: string;
  oldStatus: string;
  newStatus: string;
  changedBy: string;
}) {
  const { ticketId, subject, userEmail, userName, oldStatus, newStatus, changedBy } = params;

  console.log('[Email] sendTicketStatusChangeToUser called with:', {
    ticketId,
    subject,
    userEmail,
    oldStatus,
    newStatus,
    changedBy,
  });

  const { getEmailConfig } = await import('./email-config');
  const emailConfig = await getEmailConfig();

  const ticketUrl = `${getRequiredEnv('NEXT_PUBLIC_APP_URL')}/support/tickets/${ticketId}`;
  const isClosed = newStatus === 'closed';

  const mailOptions = {
    from: emailConfig.emailFrom || getRequiredEnv('EMAIL_FROM'),
    to: userEmail,
    subject: `Ticket ${isClosed ? 'Closed' : 'Status Updated'}: ${subject}`,
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2 style="color: ${isClosed ? '#dc2626' : '#2563eb'};">Support Ticket ${isClosed ? 'Closed' : 'Status Updated'}</h2>
        ${userName ? `<p>Hello ${escapeHtml(userName)},</p>` : '<p>Hello,</p>'}
        <p>The status of your support ticket has been updated.</p>
        
        <table style="width: 100%; border-collapse: collapse; margin: 16px 0;">
          <tr>
            <td style="padding: 8px; border: 1px solid #ddd; font-weight: bold; background-color: #f5f5f5;">Ticket Subject:</td>
            <td style="padding: 8px; border: 1px solid #ddd;">${escapeHtml(subject)}</td>
          </tr>
          <tr>
            <td style="padding: 8px; border: 1px solid #ddd; font-weight: bold; background-color: #f5f5f5;">Previous Status:</td>
            <td style="padding: 8px; border: 1px solid #ddd;">${escapeHtml(oldStatus.replace('_', ' ').toUpperCase())}</td>
          </tr>
          <tr>
            <td style="padding: 8px; border: 1px solid #ddd; font-weight: bold; background-color: #f5f5f5;">New Status:</td>
            <td style="padding: 8px; border: 1px solid #ddd;">
              <strong style="color: ${isClosed ? '#dc2626' : '#059669'};">
                ${escapeHtml(newStatus.replace('_', ' ').toUpperCase())}
              </strong>
            </td>
          </tr>
          <tr>
            <td style="padding: 8px; border: 1px solid #ddd; font-weight: bold; background-color: #f5f5f5;">Updated By:</td>
            <td style="padding: 8px; border: 1px solid #ddd;">${escapeHtml(changedBy)}</td>
          </tr>
        </table>
        
        ${isClosed ? `
        <div style="background-color: #fee2e2; padding: 16px; border-left: 4px solid #dc2626; border-radius: 4px; margin: 16px 0;">
          <h3 style="margin-top: 0; color: #991b1b;">Ticket Closed</h3>
          <p style="margin: 0; color: #374151;">
            Your ticket has been closed. If you need further assistance with this issue, you can reopen the ticket or create a new one.
          </p>
        </div>
        ` : `
        <div style="background-color: #dbeafe; padding: 16px; border-left: 4px solid #3b82f6; border-radius: 4px; margin: 16px 0;">
          <h3 style="margin-top: 0; color: #1e40af;">Status Updated</h3>
          <p style="margin: 0; color: #374151;">
            Your ticket status has been updated. Please check the ticket for any new responses or information.
          </p>
        </div>
        `}
        
        <a href="${ticketUrl}" style="display: inline-block; padding: 12px 24px; background-color: ${isClosed ? '#dc2626' : '#2563eb'}; color: #ffffff; text-decoration: none; border-radius: 4px; margin: 16px 0; font-weight: bold;">
          View Ticket
        </a>
        
        <hr style="margin: 24px 0; border: none; border-top: 1px solid #ddd;">
        <p style="color: #666; font-size: 12px;">
          This is an automated notification from the Cal Poly Pomona Student SOC User Access Request system.
        </p>
      </div>
    `,
  };

  try {
    console.log('[Email] Attempting to send ticket status change to user:', userEmail);
    const info = await transporter.sendMail(mailOptions);
    console.log('[Email] ✅ Ticket status change sent successfully:', {
      messageId: info.messageId,
      to: userEmail,
    });
    return info;
  } catch (error) {
    console.error('[Email] ❌ Failed to send ticket status change:', error);
    // Don't throw - we don't want status update to fail if email fails
  }
}

export async function sendOffboardInitialEmail(params: {
  email: string;
  name: string;
  adUsername: string;
  vpnUsername?: string | null;
  verificationToken: string;
  deadline: Date;
}) {
  const { email, name, adUsername, vpnUsername, verificationToken, deadline } = params;
  const { getEmailConfig } = await import('./email-config');
  const emailConfig = await getEmailConfig();
  const verificationUrl = `${getRequiredEnv('NEXT_PUBLIC_APP_URL')}/api/offboard/verify?token=${verificationToken}`;
  const deadlineText = deadline.toLocaleString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZoneName: 'short',
  });

  const mailOptions = {
    from: emailConfig.emailFrom || getRequiredEnv('EMAIL_FROM'),
    to: email,
    subject: 'Action Required: Confirm Continued Account Access',
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 640px; margin: 0 auto;">
        <h2>Confirm Continued Access</h2>
        <p>Hello ${escapeHtml(name)},</p>
        <p>We are reviewing active Student SOC accounts. Please confirm that you still need access for the account below and update your AD password as part of the confirmation.</p>
        <table style="width: 100%; border-collapse: collapse; margin: 16px 0;">
          <tr>
            <td style="padding: 8px; border: 1px solid #ddd; font-weight: bold; background-color: #f5f5f5;">AD Username</td>
            <td style="padding: 8px; border: 1px solid #ddd; font-family: monospace;">${escapeHtml(adUsername)}</td>
          </tr>
          ${vpnUsername ? `
          <tr>
            <td style="padding: 8px; border: 1px solid #ddd; font-weight: bold; background-color: #f5f5f5;">VPN Username</td>
            <td style="padding: 8px; border: 1px solid #ddd; font-family: monospace;">${escapeHtml(vpnUsername)}</td>
          </tr>
          ` : ''}
          <tr>
            <td style="padding: 8px; border: 1px solid #ddd; font-weight: bold; background-color: #f5f5f5;">Deadline</td>
            <td style="padding: 8px; border: 1px solid #ddd;">${escapeHtml(deadlineText)}</td>
          </tr>
        </table>
        <p>If you do not confirm and successfully update your password by the deadline, your AD account and any linked VPN access may be disabled.</p>
        <a href="${verificationUrl}" style="display: inline-block; padding: 12px 24px; background-color: #059669; color: #ffffff; text-decoration: none; border-radius: 4px; margin: 16px 0; font-weight: bold;">
          Confirm Continued Access
        </a>
        <p>Or copy and paste this link into your browser:</p>
        <p style="word-break: break-all; color: #666;">${verificationUrl}</p>
        <hr style="margin: 24px 0; border: none; border-top: 1px solid #ddd;">
        <p style="color: #666; font-size: 12px;">
          This link opens a confirmation page first. Your access is only confirmed after you enter your current AD password, choose a new AD password, and Active Directory accepts the change.
        </p>
      </div>
    `,
  };

  const info = await transporter.sendMail(mailOptions);
  if (info.rejected && info.rejected.length > 0) {
    throw new Error(`Email rejected by server for recipients: ${info.rejected.join(', ')}`);
  }
  return info;
}

export async function sendOffboardReminderEmail(params: {
  email: string;
  name: string;
  adUsername: string;
  vpnUsername?: string | null;
  verificationToken: string;
  deadline: Date;
  reminderDay: 3 | 6;
}) {
  const { email, name, adUsername, vpnUsername, verificationToken, deadline, reminderDay } = params;
  const { getEmailConfig } = await import('./email-config');
  const emailConfig = await getEmailConfig();
  const verificationUrl = `${getRequiredEnv('NEXT_PUBLIC_APP_URL')}/api/offboard/verify?token=${verificationToken}`;
  const deadlineText = deadline.toLocaleString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZoneName: 'short',
  });

  const mailOptions = {
    from: emailConfig.emailFrom || getRequiredEnv('EMAIL_FROM'),
    to: email,
    subject: `Reminder: Confirm Continued Account Access by ${deadline.toLocaleDateString('en-US')}`,
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 640px; margin: 0 auto;">
        <h2>Access Confirmation Reminder</h2>
        <p>Hello ${escapeHtml(name)},</p>
        <p>This is your day ${reminderDay} reminder to confirm that you still need Student SOC account access and update your AD password.</p>
        <table style="width: 100%; border-collapse: collapse; margin: 16px 0;">
          <tr>
            <td style="padding: 8px; border: 1px solid #ddd; font-weight: bold; background-color: #f5f5f5;">AD Username</td>
            <td style="padding: 8px; border: 1px solid #ddd; font-family: monospace;">${escapeHtml(adUsername)}</td>
          </tr>
          ${vpnUsername ? `
          <tr>
            <td style="padding: 8px; border: 1px solid #ddd; font-weight: bold; background-color: #f5f5f5;">VPN Username</td>
            <td style="padding: 8px; border: 1px solid #ddd; font-family: monospace;">${escapeHtml(vpnUsername)}</td>
          </tr>
          ` : ''}
          <tr>
            <td style="padding: 8px; border: 1px solid #ddd; font-weight: bold; background-color: #f5f5f5;">Deadline</td>
            <td style="padding: 8px; border: 1px solid #ddd;">${escapeHtml(deadlineText)}</td>
          </tr>
        </table>
        <p>Accounts that are not confirmed with a successful AD password update by the deadline are automatically queued for disable/revoke actions.</p>
        <a href="${verificationUrl}" style="display: inline-block; padding: 12px 24px; background-color: #059669; color: #ffffff; text-decoration: none; border-radius: 4px; margin: 16px 0; font-weight: bold;">
          Confirm Continued Access
        </a>
        <p>Or copy and paste this link into your browser:</p>
        <p style="word-break: break-all; color: #666;">${verificationUrl}</p>
      </div>
    `,
  };

  const info = await transporter.sendMail(mailOptions);
  if (info.rejected && info.rejected.length > 0) {
    throw new Error(`Email rejected by server for recipients: ${info.rejected.join(', ')}`);
  }
  return info;
}

export async function sendMassEmail(params: {
  to: string;
  subject: string;
  html: string;
  text: string;
}) {
  const { to, subject, html, text } = params;
  const { getEmailConfig } = await import('./email-config');
  const emailConfig = await getEmailConfig();

  const mailOptions = {
    from: emailConfig.emailFrom || getRequiredEnv('EMAIL_FROM'),
    to,
    subject,
    html,
    text,
    headers: {
      'X-UAR-Portal': 'Cal Poly SOC UAR Portal',
    },
  };

  const info = await transporter.sendMail(mailOptions);
  if (info.rejected && info.rejected.length > 0) {
    throw new Error(`Email rejected by server for recipients: ${info.rejected.join(', ')}`);
  }
  return info;
}
