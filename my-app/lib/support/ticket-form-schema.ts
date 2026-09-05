/**
 * Topic-driven form schema for the support ticket creation flow. Each topic
 * (and, for ACCOUNT, each intent) predetermines the structured prompts the
 * requester sees; free text always remains available. Structured answers are
 * composed into the ticket description as labeled lines so the server
 * contract, stored data, and notifications stay unchanged.
 */

export type TicketFormFieldKind = 'text' | 'select';

export interface TicketFormField {
  key: string;
  label: string;
  kind: TicketFormFieldKind;
  placeholder?: string;
  help?: string;
  required?: boolean;
  options?: Array<{ value: string; label: string }>;
}

export type TicketAccountIntent = 'problem' | 'join_group';

interface FormSchemaInput {
  category: string | null | undefined;
  accountIntent?: TicketAccountIntent;
}

const ACCOUNT_PROBLEM_FIELDS: TicketFormField[] = [
  {
    key: 'problemType',
    label: 'What is happening?',
    kind: 'select',
    required: true,
    placeholder: 'Choose the closest match',
    options: [
      { value: 'locked_out', label: 'Locked out of my account' },
      { value: 'sign_in_failure', label: 'Sign-in keeps failing' },
      { value: 'wrong_access', label: 'Wrong permissions or access' },
      { value: 'password_issue', label: 'Password reset / expiration trouble' },
      { value: 'other', label: 'Something else' },
    ],
  },
  {
    key: 'startedWhen',
    label: 'When did it start?',
    kind: 'text',
    placeholder: 'e.g. this morning, after lunch, since Monday',
  },
];

const INFRASTRUCTURE_FIELDS: TicketFormField[] = [
  {
    key: 'affectedSystem',
    label: 'Which system is affected?',
    kind: 'text',
    required: true,
    placeholder: 'e.g. lab-01, hypervisor node, VPN concentrator',
  },
  {
    key: 'impact',
    label: 'Who is affected?',
    kind: 'select',
    required: true,
    placeholder: 'Choose the blast radius',
    options: [
      { value: 'single_user', label: 'Just me' },
      { value: 'team', label: 'My team or group' },
      { value: 'lab', label: 'A whole lab or room' },
      { value: 'site', label: 'Site-wide / everyone' },
    ],
  },
  {
    key: 'startedWhen',
    label: 'When did it start?',
    kind: 'text',
    placeholder: 'e.g. 10 minutes ago, since last night',
  },
];

const SDC_FIELDS: TicketFormField[] = [
  {
    key: 'sdcArea',
    label: 'What do you need help with?',
    kind: 'select',
    required: true,
    placeholder: 'Choose an area',
    options: [
      { value: 'sdc_system', label: 'A Student Data Center system' },
      { value: 'sdc_access', label: 'Physical or logical access to the SDC' },
      { value: 'sdc_resources', label: 'Compute / storage / network resources' },
      { value: 'other', label: 'Something else' },
    ],
  },
  {
    key: 'affectedResource',
    label: 'Which system or resource?',
    kind: 'text',
    placeholder: 'e.g. GPU node 2, lab VLAN, storage quota',
  },
];

const SOC_FIELDS: TicketFormField[] = [
  {
    key: 'socService',
    label: 'Which SOC service?',
    kind: 'select',
    required: true,
    placeholder: 'Choose a service',
    options: [
      { value: 'monitoring', label: 'Monitoring / alerting question' },
      { value: 'incident', label: 'Report a security concern' },
      { value: 'triage_help', label: 'Help triaging an alert' },
      { value: 'other', label: 'Something else' },
    ],
  },
  {
    key: 'observedWhen',
    label: 'When did you observe it?',
    kind: 'text',
    placeholder: 'e.g. today at 09:40, overnight',
  },
];

/**
 * Ordered structured prompts for the given routing choice. Group joins carry
 * their routing in the dedicated picker, so no extra prompts are layered on.
 */
export function getTicketFormFields(input: FormSchemaInput): TicketFormField[] {
  const { category, accountIntent = 'problem' } = input;
  switch (category) {
    case 'ACCOUNT':
      return accountIntent === 'join_group' ? [] : ACCOUNT_PROBLEM_FIELDS;
    case 'INFRASTRUCTURE':
      return INFRASTRUCTURE_FIELDS;
    case 'SDC':
      return SDC_FIELDS;
    case 'SOC':
      return SOC_FIELDS;
    default:
      return [];
  }
}

export type TicketFormValues = Record<string, string>;

/** Labels for select values so composed text stays readable. */
function displayValue(field: TicketFormField, raw: string): string {
  if (field.kind === 'select') {
    return field.options?.find((option) => option.value === raw)?.label ?? raw;
  }
  return raw;
}

/**
 * Compose structured answers + free text into the stored description.
 * Structured lines lead, a blank line separates the narrative, and empty
 * answers never render. With no structured answers the text passes through.
 */
export function composeTicketDescription(
  fields: TicketFormField[],
  values: TicketFormValues,
  narrative: string
): string {
  const lines: string[] = [];
  for (const field of fields) {
    const raw = (values[field.key] ?? '').trim();
    if (!raw) continue;
    lines.push(`${field.label.replace(/\?$/, '')}: ${displayValue(field, raw)}`);
  }
  const trimmedNarrative = narrative.trim();
  if (lines.length === 0) return trimmedNarrative;
  if (!trimmedNarrative) return lines.join('\n');
  return `${lines.join('\n')}\n\n${trimmedNarrative}`;
}

/** Validate structured answers against the schema. Returns missing keys. */
export function missingRequiredFieldKeys(
  fields: TicketFormField[],
  values: TicketFormValues
): string[] {
  return fields
    .filter((field) => field.required && !(values[field.key] ?? '').trim())
    .map((field) => field.key);
}
