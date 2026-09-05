const BLOCKED_EXTENSIONS = new Set([
  'exe', 'dll', 'msi', 'com', 'scr', 'cpl', 'sys', 'jar',
  'docm', 'dotm', 'xlsm', 'xltm', 'xlam', 'pptm', 'potm', 'ppam', 'sldm',
]);

const TEXT_EXTENSIONS = new Set([
  'txt', 'md', 'csv', 'json', 'xml', 'yaml', 'yml', 'log',
  'ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs', 'css', 'scss', 'html', 'htm',
  'py', 'php', 'rb', 'go', 'rs', 'java', 'kt', 'kts', 'swift', 'c', 'h',
  'cpp', 'hpp', 'cs', 'sql', 'sh', 'ps1', 'toml', 'ini', 'conf', 'env.example',
]);

const OFFICE_TYPES: Record<string, string> = {
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  odt: 'application/vnd.oasis.opendocument.text',
  ods: 'application/vnd.oasis.opendocument.spreadsheet',
  odp: 'application/vnd.oasis.opendocument.presentation',
};

export type AttachmentClassification =
  | { ok: true; contentType: string; extension: string; forceDownload: boolean }
  | { ok: false; error: string };

export function extensionOf(filename: string): string {
  const base = filename.toLowerCase().split(/[\\/]/).pop() ?? '';
  if (base.endsWith('.env.example')) return 'env.example';
  const dot = base.lastIndexOf('.');
  return dot >= 0 ? base.slice(dot + 1) : '';
}

export function textPreviewLanguage(filename: string): string | null {
  const extension = extensionOf(filename);
  if (!TEXT_EXTENSIONS.has(extension)) return null;
  const aliases: Record<string, string> = { tsx: 'typescript', ts: 'typescript', jsx: 'javascript', js: 'javascript', mjs: 'javascript', cjs: 'javascript', yml: 'yaml', sh: 'shell', ps1: 'powershell', py: 'python', rb: 'ruby', rs: 'rust', md: 'markdown' };
  return aliases[extension] ?? extension;
}

function startsWith(bytes: Uint8Array, magic: number[]): boolean {
  return magic.every((byte, index) => bytes[index] === byte);
}

function executableMagic(bytes: Uint8Array): boolean {
  return startsWith(bytes, [0x4d, 0x5a]) ||
    startsWith(bytes, [0x7f, 0x45, 0x4c, 0x46]) ||
    startsWith(bytes, [0xfe, 0xed, 0xfa, 0xce]) ||
    startsWith(bytes, [0xcf, 0xfa, 0xed, 0xfe]);
}

function probablyText(bytes: Uint8Array): boolean {
  const sample = bytes.slice(0, 8192);
  if (sample.some((byte) => byte === 0)) return false;
  const controlCount = sample.filter((byte) => byte < 9 || (byte > 13 && byte < 32)).length;
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(sample);
    return controlCount <= Math.max(2, Math.floor(sample.length * 0.01));
  } catch {
    return false;
  }
}

function zipIsEncrypted(bytes: Uint8Array): boolean {
  for (let index = 0; index + 8 <= bytes.length; index += 1) {
    if (startsWith(bytes.slice(index), [0x50, 0x4b, 0x03, 0x04])) {
      const flags = bytes[index + 6]! | (bytes[index + 7]! << 8);
      if ((flags & 0x0001) !== 0) return true;
    }
  }
  return false;
}

function zipContainsBlockedNames(bytes: Uint8Array): boolean {
  const listing = new TextDecoder('latin1').decode(bytes.slice(0, 2 * 1024 * 1024)).toLowerCase();
  return /\.(exe|dll|msi|com|scr|cpl|sys|jar|docm|xlsm|pptm)(?:\x00|\s|$)/.test(listing);
}

export function classifyAttachment(
  filename: string,
  _declaredContentType: string,
  bytes: Uint8Array,
): AttachmentClassification {
  const extension = extensionOf(filename);
  if (!extension || BLOCKED_EXTENSIONS.has(extension) || executableMagic(bytes)) {
    return { ok: false, error: 'Executable and macro-enabled files are not allowed' };
  }

  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47])) {
    return { ok: true, contentType: 'image/png', extension: 'png', forceDownload: false };
  }
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) {
    return { ok: true, contentType: 'image/jpeg', extension: 'jpg', forceDownload: false };
  }
  if (bytes.length >= 12 && startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) &&
      startsWith(bytes.slice(8), [0x57, 0x45, 0x42, 0x50])) {
    return { ok: true, contentType: 'image/webp', extension: 'webp', forceDownload: false };
  }
  if (startsWith(bytes, [0x47, 0x49, 0x46, 0x38])) {
    return { ok: true, contentType: 'image/gif', extension: 'gif', forceDownload: false };
  }
  if (startsWith(bytes, [0x25, 0x50, 0x44, 0x46])) {
    return { ok: true, contentType: 'application/pdf', extension: 'pdf', forceDownload: true };
  }
  if (startsWith(bytes, [0x50, 0x4b, 0x03, 0x04])) {
    if (zipIsEncrypted(bytes)) return { ok: false, error: 'Encrypted archives are not allowed' };
    if (zipContainsBlockedNames(bytes)) return { ok: false, error: 'Archive contains a blocked executable or macro file' };
    return {
      ok: true,
      contentType: OFFICE_TYPES[extension] ?? 'application/zip',
      extension,
      forceDownload: true,
    };
  }
  if (TEXT_EXTENSIONS.has(extension) && probablyText(bytes)) {
    return { ok: true, contentType: 'text/plain', extension, forceDownload: true };
  }

  return { ok: false, error: 'This file type is not supported or its contents do not match its extension' };
}
