import type { MessageTemplateDefinition } from './catalog';
import { renderMessageTemplate } from './core';
import { renderMessageDocument } from './renderer';

const SAMPLE_OVERRIDES: Record<string, string> = {
  name: 'Alex Rivera',
  recipientName: 'Alex Rivera',
  accountName: 'Alex Rivera',
  email: 'alex.rivera@example.edu',
  accountEmail: 'alex.rivera@example.edu',
  userEmail: 'alex.rivera@example.edu',
  username: 'arivera',
  adUsername: 'arivera',
  accountUsername: 'vpn.arivera',
  ldapUsername: 'arivera',
  password: 'sample-password-123',
  linkedBy: 'Jordan Smith (Admin)',
  createdBy: 'Jordan Smith (Admin)',
  changedBy: 'Jordan Smith (Admin)',
  respondedBy: 'jstaff',
  reason: 'Duplicate request — please resubmit with your CPP email.',
  message: 'This is a sample notification body for preview purposes.',
  notificationTitle: 'Sample Notification',
  ticketSubject: 'VPN client will not connect',
  ticketSubjectHtml: 'VPN client will not connect',
  ticketId: 'TCK-2026-0042',
  ticketIdHtml: 'TCK-2026-0042',
  assignmentTag: '[Assigned]',
  statusWord: 'Status Updated',
};

const SAMPLE_ROW_BLOCK =
  '<tr><td style="padding: 8px; border: 1px solid #ddd; font-weight: bold;">Sample Field</td>' +
  '<td style="padding: 8px; border: 1px solid #ddd;">Sample value for Alex Rivera</td></tr>';

function sampleBlockValue(name: string): string {
  const lower = name.toLowerCase();
  if (lower.includes('greeting')) return '<p>Hello Alex Rivera,</p>';
  if (lower.includes('row')) return SAMPLE_ROW_BLOCK;
  if (lower.includes('notice')) {
    return '<div style="background-color: #dbeafe; padding: 16px; border-left: 4px solid #3b82f6; border-radius: 4px; margin: 16px 0;">' +
      '<h3 style="margin-top: 0;">Notice</h3><p style="margin: 0;">Sample notice content.</p></div>';
  }
  if (lower.includes('block')) {
    return '<div style="background-color: #f5f5f5; padding: 16px; border-radius: 4px; margin: 16px 0;">' +
      '<p style="margin: 0;">Sample conditional content.</p></div>';
  }
  return '[Sample content]';
}

function sampleVariableValue(name: string, description: string): string {
  if (SAMPLE_OVERRIDES[name]) return SAMPLE_OVERRIDES[name];
  const lower = name.toLowerCase();
  if (/color/.test(lower)) return '#059669';
  if (lower.endsWith('url')) {
    const slug = name.replace(/Url$/, '').replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase();
    return `https://portal.example/${slug || 'link'}`;
  }
  if (lower.endsWith('block')) return sampleBlockValue(name);
  if (lower.includes('date') || lower.includes('expiry')) return 'Monday, August 24, 2026 at 10:00 AM PDT';
  if (lower.endsWith('day') || lower.includes('count')) return '3';
  if (lower.startsWith('subjectline')) return 'Reminder: Your SDC Account Password Expires Soon';
  const firstSentence = description.split(/[.;(]/)[0]?.trim();
  return firstSentence ? `[${firstSentence}]` : `[${name}]`;
}

export function buildMessageSampleVariables(
  variables: MessageTemplateDefinition['variables']
): Record<string, string> {
  return Object.fromEntries(
    variables.map((variable) => [variable.name, sampleVariableValue(variable.name, variable.description)])
  );
}

export function renderMessageAuthoringSample(input: {
  definition: MessageTemplateDefinition;
  subject: string;
  body: string;
  css?: string;
}): { subject: string; html: string; text: string; diagnostics: string[] } {
  const variables = buildMessageSampleVariables(input.definition.variables);
  const subject = renderMessageTemplate(input.subject, variables).trim();
  const body = input.definition.subjectOnly
    ? '<p>This template controls the subject line only. The workflow generates the final message body.</p>'
    : input.body;
  const rendered = renderMessageDocument(
    body,
    variables,
    input.css ?? ''
  );
  return { subject, ...rendered };
}
