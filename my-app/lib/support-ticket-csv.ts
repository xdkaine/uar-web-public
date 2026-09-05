import { generateCsvContent } from './csv-security';

export interface SupportTicketCsvRecord {
  id: string;
  subject: string;
  username: string;
  category: string | null;
  severity: string | null;
  status: string;
  responses: readonly unknown[];
  createdAt: string;
  updatedAt: string;
  closedAt: string | null;
}

export function generateSupportTicketsCsv(
  tickets: readonly SupportTicketCsvRecord[]
): string {
  const headers = [
    'ID',
    'Subject',
    'Username',
    'Category',
    'Severity',
    'Status',
    'Responses',
    'Created',
    'Updated',
    'Closed',
  ];
  const csvData = tickets.map((ticket) => [
    ticket.id,
    ticket.subject,
    ticket.username,
    ticket.category || '',
    ticket.severity || '',
    ticket.status,
    ticket.responses.length.toString(),
    new Date(ticket.createdAt).toLocaleDateString(),
    new Date(ticket.updatedAt).toLocaleDateString(),
    ticket.closedAt ? new Date(ticket.closedAt).toLocaleDateString() : '',
  ]);

  return generateCsvContent(headers, csvData);
}
