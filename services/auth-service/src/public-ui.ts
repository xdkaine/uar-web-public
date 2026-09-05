import type { CatalogEntryView } from './application-catalog';

function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

export const PUBLIC_UI_HEADERS = {
  'Content-Type': 'text/html; charset=utf-8',
  'Cache-Control': 'no-store',
  'Referrer-Policy': 'no-referrer',
  'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; img-src https: data:; font-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
  'X-Content-Type-Options': 'nosniff',
};

export function configuredBootstrapApplication(
  clientId: string,
  redirectUris: readonly string[]
): CatalogEntryView | null {
  const first = redirectUris[0];
  if (!first) return null;
  let launchUrl: string;
  try {
    const parsed = new URL(first);
    const loopback = ['localhost', '127.0.0.1', '::1'].includes(parsed.hostname);
    if (parsed.protocol !== 'https:' && !(loopback && parsed.protocol === 'http:')) return null;
    launchUrl = `${parsed.origin}/`;
  } catch {
    return null;
  }
  const words = clientId.split(/[-_]+/).filter(Boolean);
  const name = clientId === 'uar-portal'
    ? 'UAR Portal'
    : words.map((word) => word.charAt(0).toUpperCase() + word.slice(1)).join(' ');
  return {
    id: `configured:${clientId}`,
    slug: clientId,
    name: name || 'Application',
    description: null,
    launchUrl,
    iconUrl: null,
    kind: 'oidc',
    oidcClientId: clientId,
    visibility: 'public',
    sortOrder: -10_000,
    publishedAt: new Date(0),
  };
}

const SHELL_STYLE = `
@font-face{font-family:Geist;src:url('/ui/fonts/geist-v1-latin.woff2') format('woff2');font-weight:100 900;font-display:swap}
@font-face{font-family:'Geist Mono';src:url('/ui/fonts/geist-mono-v1-latin.woff2') format('woff2');font-weight:100 900;font-display:swap}
:root{--canvas:#ffffff;--surface:#ffffff;--ink:#09090b;--muted:#71717a;--line:#e4e4e7;--signal:#18181b;color-scheme:light}
@media(prefers-color-scheme:dark){:root{--canvas:#09090b;--surface:#09090b;--ink:#fafafa;--muted:#a1a1aa;--line:#27272a;--signal:#fafafa;color-scheme:dark}}
*{box-sizing:border-box}body{margin:0;min-height:100vh;background:var(--canvas);color:var(--ink);font:14px/1.5 Geist,Arial,sans-serif;-webkit-font-smoothing:antialiased}
a{color:inherit}.shell{width:min(100% - 2rem,800px);margin:auto;padding:1.25rem 0 5rem}.bar{display:flex;align-items:center;justify-content:space-between;padding-bottom:1rem;border-bottom:1px solid var(--line)}
.brand{font-weight:620;letter-spacing:-.02em}.issuer{color:var(--muted);font:11px 'Geist Mono',monospace;text-transform:uppercase;letter-spacing:.04em}
h1{margin:3.5rem 0 .35rem;font-size:1.75rem;font-weight:600;line-height:1.2;letter-spacing:-.04em}.intro{margin:0 0 2.5rem;color:var(--muted)}
.group{margin-top:2rem}.group h2{margin:0;padding:.65rem 0;border-bottom:1px solid var(--line);color:var(--muted);font:11px 'Geist Mono',monospace;text-transform:uppercase;letter-spacing:.05em}
.app{display:grid;grid-template-columns:42px minmax(0,1fr) auto;gap:1rem;align-items:center;padding:1rem 0;border-bottom:1px solid var(--line);text-decoration:none}.app:hover .open{text-decoration:underline;text-underline-offset:3px}
.icon{display:grid;place-items:center;width:38px;height:38px;border:1px solid var(--line);border-radius:8px;background:var(--surface);overflow:hidden;font:600 13px 'Geist Mono',monospace}.icon img{width:100%;height:100%;object-fit:contain}.name{display:block;font-weight:590}.desc{display:-webkit-box;margin-top:.15rem;overflow:hidden;color:var(--muted);font-size:.84rem;line-height:1.4;-webkit-box-orient:vertical;-webkit-line-clamp:2}.open{color:var(--muted);font:11px 'Geist Mono',monospace;text-transform:uppercase;letter-spacing:.04em}
.empty{padding:1rem 0;color:var(--muted);border-bottom:1px solid var(--line)}.error-shell{max-width:620px}.error-shell h1{max-width:18ch}.action{display:inline-flex;margin-top:1.5rem;padding:.6rem .8rem;background:var(--ink);color:var(--surface);border-radius:6px;text-decoration:none;font-weight:590}
:focus-visible{outline:2px solid var(--signal);outline-offset:3px}@media(max-width:560px){.shell{padding-top:1.25rem}.issuer{display:none}h1{margin-top:3rem}.app{grid-template-columns:36px minmax(0,1fr) auto;gap:.7rem}.icon{width:34px;height:34px}.desc{-webkit-line-clamp:1}.open{font-size:10px}}
`;

function initials(name: string): string {
  return name.split(/\s+/).slice(0, 2).map((part) => part[0] ?? '').join('').toUpperCase();
}

function renderGroup(title: string, entries: CatalogEntryView[]): string {
  if (!entries.length) return '';
  return `<section class="group"><h2>${escapeHtml(title)}</h2>${entries.map((entry) => {
    const icon = entry.iconUrl
      ? `<img src="${escapeHtml(entry.iconUrl)}" alt="">`
      : escapeHtml(initials(entry.name));
    return `<a class="app" href="${escapeHtml(entry.launchUrl)}" rel="noopener noreferrer"><span class="icon" aria-hidden="true">${icon}</span><span><span class="name">${escapeHtml(entry.name)}</span>${entry.description ? `<span class="desc">${escapeHtml(entry.description)}</span>` : ''}</span><span class="open">Open</span></a>`;
  }).join('')}</section>`;
}

export function renderApplicationLanding(entries: CatalogEntryView[]): string {
  const identity = entries.filter((entry) => entry.kind === 'oidc');
  const external = entries.filter((entry) => entry.kind === 'external');
  const content = entries.length
    ? `${renderGroup('Uses Cal Poly SOC IdP', identity)}${renderGroup('Other services', external)}`
    : '<p class="empty">No applications are published.</p>';
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Applications · Cal Poly SOC IdP</title><style>${SHELL_STYLE}</style></head><body><main class="shell"><header class="bar"><span class="brand">Cal Poly SOC</span><span class="issuer">IdP</span></header><h1>Applications</h1><p class="intro">Open a SOC service.</p>${content}</main></body></html>`;
}

function errorCopy(code: string): { title: string; detail: string } {
  switch (code) {
    case 'invalid_client': return { title: 'Application not registered', detail: 'This application is not configured to use the Cal Poly SOC IdP.' };
    case 'expired_interaction': return { title: 'Sign-in expired', detail: 'Start again from the application you were trying to open.' };
    case 'temporarily_unavailable':
    case 'server_error': return { title: 'Sign-in unavailable', detail: 'Try again in a few minutes.' };
    default: return { title: 'Sign-in link not valid', detail: 'The link is incomplete, expired, or was not created by a registered application.' };
  }
}

export function renderProtocolErrorPage(code: string): string {
  const copy = errorCopy(code);
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(copy.title)} · Cal Poly SOC IdP</title><style>${SHELL_STYLE}</style></head><body><main class="shell error-shell"><header class="bar"><span class="brand">Cal Poly SOC</span><span class="issuer">IdP</span></header><h1>${escapeHtml(copy.title)}</h1><p class="intro">${escapeHtml(copy.detail)}</p><a class="action" href="/">Back to applications</a></main></body></html>`;
}

export async function providerErrorRenderer(
  ctx: { type?: string; body?: unknown; status?: number; set?: (name: string, value: string) => void },
  out: Record<string, unknown>
): Promise<void> {
  const code = typeof out.error === 'string' ? out.error : 'invalid_request';
  ctx.type = 'html';
  ctx.body = renderProtocolErrorPage(code);
  ctx.set?.('Cache-Control', 'no-store');
  ctx.set?.('Referrer-Policy', 'no-referrer');
  ctx.set?.('Content-Security-Policy', PUBLIC_UI_HEADERS['Content-Security-Policy']);
  ctx.set?.('X-Content-Type-Options', 'nosniff');
}
