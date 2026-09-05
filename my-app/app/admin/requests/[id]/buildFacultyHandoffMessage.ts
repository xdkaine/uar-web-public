import type { AccessRequest } from './RequestDetailTypes';

interface BuildFacultyHandoffMessageOptions {
  request: AccessRequest | null;
  facultyHandoffTemplate: string | null;
  revealedFacultyPassword: string;
}

const DEFAULT_TEMPLATE = [
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
].join('\n');

export function buildFacultyHandoffMessage({
  request,
  facultyHandoffTemplate,
  revealedFacultyPassword,
}: BuildFacultyHandoffMessageOptions) {
  if (!request) return '';

  const actionPhrase = request.isInternal
    ? 'verify the requester\'s access'
    : 'create the requester\'s VPN account';
  const completionRequest = request.isInternal
    ? 'Please let me know once access has been verified.'
    : 'Please let me know once the account has been created.';
  const accountDisableDate = request.accountExpiresAt
    ? `\nAccount Disable Date: ${new Date(request.accountExpiresAt).toLocaleString()}`
    : '';
  const vpnUsernameLine = !request.isInternal && request.vpnUsername
    ? `\nVPN Username: ${request.vpnUsername}`
    : '';
  const password = request.isInternal
    ? 'N/A'
    : revealedFacultyPassword || '[Reveal the password before copying this message]';
  const variables: Record<string, string> = {
    actionPhrase,
    name: request.name,
    email: request.email,
    vpnUsernameLine,
    password,
    accountDisableDate,
    completionRequest,
  };

  return (facultyHandoffTemplate ?? DEFAULT_TEMPLATE).replace(/\{\{(\w+)\}\}/g, (match, name: string) => {
    const value = variables[name];
    return value === undefined ? match : value;
  });
}
