import { PAGE_APPEARANCE_IDS, type PageAppearanceId } from './appearance';

export type ManagedPageBlock =
  | { id: string; type: 'richText'; body: string }
  | { id: string; type: 'notice'; body: string; tone: 'info' | 'warning' | 'success' }
  | { id: string; type: 'actionCards'; title: string; items: Array<{ label: string; href: string; description: string }> }
  | { id: string; type: 'workflowShowcase'; title: string; steps: string[] }
  | { id: string; type: 'serviceStory'; title: string; body: string }
  | { id: string; type: 'faq'; title: string; items: Array<{ question: string; answer: string }> };

export interface ManagedPageDocument {
  mode: 'basic' | 'advanced';
  region: 'intro';
  blocks: ManagedPageBlock[];
  html: string;
  css: string;
  javascript: string;
}

export const EMPTY_MANAGED_PAGE: ManagedPageDocument = {
  mode: 'basic', region: 'intro', blocks: [], html: '', css: '', javascript: '',
};

function boundedString(input: unknown, max: number, label: string, required = false): string {
  if (typeof input !== 'string') {
    if (required) throw new Error(`${label} is required`);
    return '';
  }
  const value = input.trim();
  if (required && !value) throw new Error(`${label} is required`);
  if (value.length > max) throw new Error(`${label} exceeds ${max} characters`);
  return value;
}

function boundedSource(input: unknown, max: number, label: string): string {
  const value = typeof input === 'string' ? input : '';
  if (value.length > max) throw new Error(`${label} exceeds ${max} characters`);
  return value;
}

function safeActionHref(input: unknown): string {
  const href = boundedString(input, 2048, 'Action link', true);
  if (href.startsWith('/') && !href.startsWith('//') && !href.includes('\\')) return href;
  try {
    const url = new URL(href);
    if (url.protocol === 'https:' && !url.username && !url.password) return url.toString();
  } catch {
    // Fall through to the policy error.
  }
  throw new Error('Action links must be internal paths or HTTPS URLs');
}

function validateBlocks(input: unknown): ManagedPageBlock[] {
  if (!Array.isArray(input)) throw new Error('Basic page blocks must be a list');
  if (input.length > 30) throw new Error('Basic pages allow at most 30 blocks');
  const ids = new Set<string>();
  return input.map((rawBlock, blockIndex) => {
    const label = `Block ${blockIndex + 1}`;
    if (!rawBlock || typeof rawBlock !== 'object' || Array.isArray(rawBlock)) {
      throw new Error(`${label} must be an object`);
    }
    const block = rawBlock as Record<string, unknown>;
    const id = boundedString(block.id, 80, `${label} id`, true);
    if (!/^[A-Za-z0-9_-]+$/.test(id)) throw new Error(`${label} id contains unsupported characters`);
    if (ids.has(id)) throw new Error(`Block ids must be unique: ${id}`);
    ids.add(id);
    const type = block.type;
    if (type === 'richText') {
      return { id, type, body: boundedString(block.body, 10000, `${label} body`, true) };
    }
    if (type === 'notice') {
      if (!['info', 'warning', 'success'].includes(String(block.tone))) throw new Error(`${label} has an invalid notice tone`);
      return { id, type, body: boundedString(block.body, 4000, `${label} body`, true), tone: block.tone as 'info' | 'warning' | 'success' };
    }
    if (type === 'serviceStory') {
      return { id, type, title: boundedString(block.title, 160, `${label} title`, true), body: boundedString(block.body, 10000, `${label} body`, true) };
    }
    if (type === 'workflowShowcase') {
      if (!Array.isArray(block.steps) || block.steps.length === 0 || block.steps.length > 12) throw new Error(`${label} needs 1 to 12 workflow steps`);
      return { id, type, title: boundedString(block.title, 160, `${label} title`, true), steps: block.steps.map((step, index) => boundedString(step, 200, `${label} step ${index + 1}`, true)) };
    }
    if (type === 'actionCards') {
      if (!Array.isArray(block.items) || block.items.length === 0 || block.items.length > 12) throw new Error(`${label} needs 1 to 12 action cards`);
      return {
        id,
        type,
        title: boundedString(block.title, 160, `${label} title`, true),
        items: block.items.map((rawItem, index) => {
          if (!rawItem || typeof rawItem !== 'object' || Array.isArray(rawItem)) throw new Error(`${label} action ${index + 1} must be an object`);
          const item = rawItem as Record<string, unknown>;
          return { label: boundedString(item.label, 120, `${label} action ${index + 1} label`, true), href: safeActionHref(item.href), description: boundedString(item.description, 500, `${label} action ${index + 1} description`, true) };
        }),
      };
    }
    if (type === 'faq') {
      if (!Array.isArray(block.items) || block.items.length === 0 || block.items.length > 20) throw new Error(`${label} needs 1 to 20 FAQ items`);
      return {
        id,
        type,
        title: boundedString(block.title, 160, `${label} title`, true),
        items: block.items.map((rawItem, index) => {
          if (!rawItem || typeof rawItem !== 'object' || Array.isArray(rawItem)) throw new Error(`${label} FAQ ${index + 1} must be an object`);
          const item = rawItem as Record<string, unknown>;
          return { question: boundedString(item.question, 300, `${label} FAQ ${index + 1} question`, true), answer: boundedString(item.answer, 4000, `${label} FAQ ${index + 1} answer`, true) };
        }),
      };
    }
    throw new Error(`${label} has an unsupported type`);
  });
}

export function validateManagedPageDocument(pageKey: unknown, value: unknown): { pageKey: PageAppearanceId; document: ManagedPageDocument } {
  if (typeof pageKey !== 'string' || !PAGE_APPEARANCE_IDS.includes(pageKey as PageAppearanceId)) throw new Error('Unknown managed page');
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Page document must be an object');
  const raw = value as Partial<ManagedPageDocument>;
  const mode = raw.mode === 'advanced' ? 'advanced' : 'basic';
  const blocks = mode === 'basic' ? validateBlocks(raw.blocks ?? []) : [];
  if (JSON.stringify(blocks).length > 30000) throw new Error('Basic page blocks exceed the 30k character limit');
  return {
    pageKey: pageKey as PageAppearanceId,
    document: {
      mode, region: 'intro', blocks,
      html: boundedSource(raw.html, 30000, 'HTML'), css: boundedSource(raw.css, 30000, 'CSS'), javascript: boundedSource(raw.javascript, 30000, 'JavaScript'),
    },
  };
}

export function buildSandboxDocument(document: ManagedPageDocument): string {
  const css = document.css.replace(/<\/style/gi, '<\\/style');
  const script = document.javascript.replace(/<\/script/gi, '<\\/script');
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; font-src data:; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'none'; form-action 'none'; base-uri 'none'"><style>html{color-scheme:light dark}body{margin:0;padding:20px;font:14px/1.5 system-ui,sans-serif}@media(prefers-reduced-motion:reduce){*,*::before,*::after{scroll-behavior:auto!important;animation-duration:.001ms!important;animation-iteration-count:1!important;transition-duration:.001ms!important}}${css}</style></head><body>${document.html}<script>${script}</script></body></html>`;
}
