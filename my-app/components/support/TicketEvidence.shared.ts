export const EVIDENCE_ACCEPT = [
  '.png', '.jpg', '.jpeg', '.webp', '.gif', '.pdf', '.zip', '.docx', '.xlsx', '.pptx', '.odt', '.ods', '.odp',
  '.txt', '.md', '.csv', '.json', '.xml', '.yaml', '.yml', '.log', '.ts', '.tsx', '.js', '.jsx', '.css', '.html',
  '.py', '.php', '.rb', '.go', '.rs', '.java', '.kt', '.swift', '.c', '.h', '.cpp', '.hpp', '.cs', '.sql', '.sh', '.ps1', '.toml', '.ini', '.conf',
].join(',');
export const MAX_EVIDENCE_BYTES = 20 * 1024 * 1024;
export const MAX_FILES_PER_TICKET = 50;
export interface TicketAttachment { id: string; filename: string; contentType: string; sizeBytes: number; scanStatus?: string; uploadedBy?: string; createdAt?: string; }
export interface StagedEvidenceValidation { accepted: File[]; error?: string; }
const stagedFileIds = new WeakMap<File, string>(); let nextStagedFileId = 0;
export function stagedEvidenceFileId(file: File): string { let id = stagedFileIds.get(file); if (!id) { id = `staged-evidence-${++nextStagedFileId}`; stagedFileIds.set(file, id); } return id; }
export function contentUrl(ticketId: string, attachmentId: string): string { return `/api/support/tickets/${ticketId}/attachments/${attachmentId}/content`; }
export function formatBytes(bytes: number): string { if (bytes < 1024) return `${bytes} B`; if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`; return `${(bytes / (1024 * 1024)).toFixed(1)} MB`; }
export function validateStagedEvidenceFiles(incoming: File[], existingCount: number): StagedEvidenceValidation {
  for (const file of incoming) if (file.size <= 0 || file.size > MAX_EVIDENCE_BYTES) return { accepted: [], error: `${file.name}: files must be under ${formatBytes(MAX_EVIDENCE_BYTES)}` };
  if (existingCount + incoming.length > MAX_FILES_PER_TICKET) return { accepted: [], error: `Tickets allow at most ${MAX_FILES_PER_TICKET} attachments` };
  return { accepted: incoming };
}
