import nodemailer from 'nodemailer';
import { getConfigValue, getRequiredSecretValue } from '@/lib/config/resolver';
import { assertExternalSideEffectAllowed } from '@/lib/clone-safety';

export interface AutomationEmailInput {
  to: string[];
  subject: string;
  body: string;
}

export async function sendAutomationEmail(input: AutomationEmailInput): Promise<{ messageId: string }> {
  assertExternalSideEffectAllowed('smtp');
  const [hostValue, portValue, userValue] = await Promise.all([
    getConfigValue<string>('smtp.host'),
    getConfigValue<number>('smtp.port'),
    getConfigValue<string>('smtp.user'),
  ]);

  const host = String(hostValue || '').trim();
  const port = Number(portValue) || 587;
  const user = String(userValue || '').trim();

  if (!host) {
    throw new Error('SMTP host is not configured; automation email cannot be delivered');
  }

  const smtpPassword = await getRequiredSecretValue('smtp.password');

  const transporter = nodemailer.createTransport({
    host,
    port,
    secure: port === 465,
    requireTLS: port !== 465,
    tls: {
      rejectUnauthorized: true,
    },
    auth: {
      user,
      pass: smtpPassword,
    },
    logger: false,
    debug: false,
  });

  try {
    const info = await transporter.sendMail({
      from: user || host,
      to: input.to.join(', '),
      subject: input.subject,
      text: input.body,
    });
    return { messageId: info.messageId };
  } finally {
    transporter.close();
  }
}
