import { createHash } from 'node:crypto';
import {
  markdownToSafeHtml,
  type BrandingBlock,
  type BrandingDoc,
  type BrandingTheme,
} from './branding';

/**
 * Branding-aware HTML renderer. Every dynamic value is either escaped text or
 * a validator-approved token (hex color, radius keyword, http(s) URL), so a
 * branding document can never inject markup. The functional forms (username /
 * password / Turnstile / submit, and the forced password change) stay fixed —
 * admins arrange and style content around them, never rewrite them.
 */

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

export type RenderKind = 'login' | 'change-password' | 'error';

export interface RenderContext {
  uid?: string;
  username?: string;
  /** Validated relying-party label supplied by the interaction handler. */
  requestingApplication?: string;
  /** A same-origin, validator-approved destination for leaving an interaction. */
  cancelUrl?: string;
  turnstileSiteKey?: string;
  errorMessage?: string;
  /** Preview mode replaces live Turnstile with an explicit disabled state. */
  preview?: boolean;
  /** High-entropy browser evidence is rendered only in explicit shadow mode. */
  deviceEvidenceEnabled?: boolean;
}

interface ResolvedTheme {
  /** Explicitly branded values - re-emitted so they win in BOTH modes. */
  explicitVars: string;
  controlRadiusPx: number;
  cardRadiusPx: number;
}

const RADIUS_PX: Record<NonNullable<BrandingTheme['radius']>, number> = {
  none: 0,
  sm: 4,
  md: 8,
  lg: 12,
};

/**
 * High-contrast, neutral defaults shared with the Auth Manager console. A
 * prefers-color-scheme block swaps dark equivalents, and explicitly branded
 * values are re-declared LAST so an admin's chosen theme applies identically
 * in both modes. Error colors remain tokens rather than hard-coded states.
 */
const THEME_VAR_SOURCES: Array<[keyof BrandingTheme, string, string, string]> = [
  // [theme key, css var, light default, dark default]
  ['pageBackground', '--page-bg', '#ffffff', '#09090b'],
  ['cardBackground', '--card-bg', '#ffffff', '#09090b'],
  ['borderColor', '--border', '#e4e4e7', '#27272a'],
  ['textColor', '--text', '#09090b', '#fafafa'],
  ['mutedTextColor', '--muted', '#71717a', '#a1a1aa'],
  ['accentColor', '--accent', '#18181b', '#fafafa'],
  ['accentText', '--accent-text', '#fafafa', '#09090b'],
];

const ERROR_VARS: Array<[string, string, string]> = [
  ['--error-bg', '#ffffff', '#09090b'],
  ['--error-border', '#09090b', '#fafafa'],
  ['--error-text', '#09090b', '#fafafa'],
];

function resolveTheme(theme?: BrandingTheme): ResolvedTheme {
  const radius = theme?.radius ?? 'md';
  const controlRadius = RADIUS_PX[radius];
  const explicit: string[] = [];
  for (const [key, cssVar] of THEME_VAR_SOURCES) {
    const value = theme?.[key];
    if (typeof value === 'string') explicit.push(`${cssVar}:${value}`);
  }
  return {
    explicitVars: explicit.join(';'),
    controlRadiusPx: controlRadius,
    cardRadiusPx: Math.min(controlRadius + 4, 16),
  };
}

function renderLogoBlock(block: Extract<BrandingBlock, { type: 'logo' }>): string {
  return `<div class="logo-row"><img src="${escapeHtml(block.url)}" alt="${escapeHtml(block.alt)}" style="height:${block.heightPx}px"></div>`;
}

function renderMarkdownBlock(block: Extract<BrandingBlock, { type: 'markdown' }>): string {
  // markdownToSafeHtml whitelists tags/attributes/schemes; the fragment is
  // safe to interpolate by construction.
  return `<div class="md">${markdownToSafeHtml(block.markdown)}</div>`;
}

function turnstileMarkup(siteKey: string | undefined, preview: boolean): string {
  if (preview || !siteKey) {
    return '<div class="preview-verification">Human verification is disabled in preview</div>';
  }
  return `<div class="cf-turnstile" data-sitekey="${escapeHtml(siteKey)}" data-size="flexible"></div>`;
}

/**
 * First-party sign-in evidence. Version 2 hashes a broader browser signal set
 * in the browser (including UA client hints, rendering, GPU and audio output)
 * and submits only the digest. It runs only on credential forms, uses no
 * third-party tracker, and remains spoofable shadow evidence rather than an
 * authentication factor. A short FNV fallback covers browsers without
 * WebCrypto; the server HMACs either value before durable storage.
 */
const DEVICE_HINT_JS = `
(function(){try{
var n=window.navigator,s=window.screen,el=document.getElementById('device-id');if(!el)return;
function fallback(v){var h=2166136261;for(var i=0;i<v.length;i++){h^=v.charCodeAt(i);h=Math.imul(h,16777619)>>>0;}return'v1-'+h.toString(16)+'-'+v.length.toString(16);}
function stable(v){if(!v||typeof v!=='object')return JSON.stringify(v);if(Array.isArray(v))return'['+v.map(stable).join(',')+']';return'{'+Object.keys(v).sort().map(function(k){return JSON.stringify(k)+':'+stable(v[k]);}).join(',')+'}';}
function canvasSignals(){var out={};try{var c=document.createElement('canvas');c.width=280;c.height=60;var x=c.getContext('2d');x.textBaseline='alphabetic';x.fillStyle='#f60';x.fillRect(10,10,100,30);x.fillStyle='#069';x.font='16px Arial';x.fillText('identity provider 0123456789',12,32);x.globalCompositeOperation='multiply';x.fillStyle='rgba(120,200,40,.72)';x.beginPath();x.arc(100,28,18,0,Math.PI*2);x.fill();out.canvas=c.toDataURL();var g=c.getContext('webgl')||c.getContext('experimental-webgl');if(g){var d=g.getExtension('WEBGL_debug_renderer_info');out.gpu=d?[g.getParameter(d.UNMASKED_VENDOR_WEBGL),g.getParameter(d.UNMASKED_RENDERER_WEBGL)]:[g.getParameter(g.VENDOR),g.getParameter(g.RENDERER)];}}catch(e){}return out;}
async function audioSignal(){try{var C=window.OfflineAudioContext||window.webkitOfflineAudioContext;if(!C)return null;var a=new C(1,5000,44100),o=a.createOscillator(),p=a.createDynamicsCompressor();o.type='triangle';o.frequency.value=10000;o.connect(p);p.connect(a.destination);o.start(0);var b=await a.startRendering(),d=b.getChannelData(0),r=[];for(var i=500;i<4500;i+=250)r.push(Math.round(d[i]*1000000));return r;}catch(e){return null;}}
async function collect(){var z={ua:n.userAgent,lang:n.language,languages:n.languages||[],platform:n.platform||'',vendor:n.vendor||'',timezone:Intl.DateTimeFormat().resolvedOptions().timeZone||'',offset:new Date().getTimezoneOffset(),screen:[s.width,s.height,s.availWidth,s.availHeight,s.colorDepth,s.pixelDepth],dpr:window.devicePixelRatio||1,cpu:n.hardwareConcurrency||0,memory:n.deviceMemory||0,touch:n.maxTouchPoints||0,cookies:n.cookieEnabled,storage:[!!window.localStorage,!!window.sessionStorage],render:canvasSignals()};try{if(n.userAgentData&&n.userAgentData.getHighEntropyValues)z.uaData=await n.userAgentData.getHighEntropyValues(['architecture','bitness','fullVersionList','model','platformVersion','wow64']);}catch(e){}z.audio=await audioSignal();var raw=stable(z);if(window.crypto&&window.crypto.subtle&&window.TextEncoder){var dig=await window.crypto.subtle.digest('SHA-256',new TextEncoder().encode(raw)),bytes=new Uint8Array(dig),bin='';for(var j=0;j<bytes.length;j++)bin+=String.fromCharCode(bytes[j]);return'v2-'+btoa(bin).split('+').join('-').split('/').join('_').replace(/=+$/,'');}return fallback(raw);}
var ready=collect().then(function(v){el.value=v;return v;}).catch(function(){var v=fallback([n.userAgent,n.language,s.width,s.height,new Date().getTimezoneOffset()].join('|'));el.value=v;return v;});
var form=el.form,proceed=false,waiting=false;if(form)form.addEventListener('submit',function(e){if(proceed||el.value)return;e.preventDefault();if(waiting)return;waiting=true;Promise.race([ready,new Promise(function(resolve){setTimeout(resolve,700);})]).then(function(){proceed=true;form.requestSubmit();});});
}catch(e){}}
)();`;
const DEVICE_HINT_SCRIPT = `<script>${DEVICE_HINT_JS}</script>`;

/**
 * The inline device-hint script is pinned by its SHA-256 hash so the CSP can
 * stay free of script-src 'unsafe-inline'. The hash MUST track the exact
 * bytes between <script> and </script>, hence the shared constant above.
 */
const DEVICE_HINT_SCRIPT_HASH = `sha256-${createHash('sha256').update(DEVICE_HINT_JS).digest('base64')}`;

/**
 * Frame protections + restrictive CSP for EVERY interaction page (login,
 * change-password, error). default-src 'self' plus explicit allowances for
 * the page's own first-party needs only: Turnstile (script + widget frame),
 * the hashed inline hint script, and the theme <style> block. img-src keeps
 * https:/data: because validated logo URLs may point at external CDNs.
 */
export function interactionContentSecurityPolicy(redirectUris: string[] = []): string {
  const redirectOrigins = [...new Set(redirectUris.flatMap((uri) => {
    try {
      const parsed = new URL(uri);
      return parsed.protocol === 'https:' || parsed.protocol === 'http:' ? [parsed.origin] : [];
    } catch {
      return [];
    }
  }))];
  return [
    "default-src 'self'",
    `script-src 'self' https://challenges.cloudflare.com '${DEVICE_HINT_SCRIPT_HASH}'`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: https:",
    "connect-src 'self'",
    "font-src 'self'",
    "frame-src https://challenges.cloudflare.com",
    "object-src 'none'",
    "base-uri 'none'",
    `form-action 'self'${redirectOrigins.length ? ` ${redirectOrigins.join(' ')}` : ''}`,
    "frame-ancestors 'none'",
  ].join('; ');
}

export const INTERACTION_CONTENT_SECURITY_POLICY = interactionContentSecurityPolicy();

/** Security headers merged into every interaction HTML response. */
export function interactionHtmlHeaders(
  extra: Record<string, string> = {},
  redirectUris: string[] = []
): Record<string, string> {
  return {
    'Content-Security-Policy': interactionContentSecurityPolicy(redirectUris),
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'no-referrer',
    ...extra,
  };
}

function loginFormMarkup(uid: string, siteKey: string | undefined, context: RenderContext): string {
  const describedBy = context.errorMessage ? ' aria-describedby="sign-in-error"' : '';
  return `<form method="post" action="/interaction/${escapeHtml(uid)}" id="login-form">
        <label for="username">Username</label>
        <input type="text" id="username" name="username" value="${escapeHtml(context.username ?? '')}" autocomplete="username"${describedBy} required autofocus>
        <label for="password">Password</label>
        <input type="password" id="password" name="password" autocomplete="current-password"${describedBy} required>
        ${context.deviceEvidenceEnabled ? '<input type="hidden" name="deviceId" id="device-id" value="">' : ''}
        ${turnstileMarkup(siteKey, Boolean(context.preview))}
        <button type="submit">Sign in</button>
      </form>`;
}

function leaveInteractionMarkup(context: RenderContext): string {
  const href = context.cancelUrl
    && context.cancelUrl.startsWith('/')
    && !context.cancelUrl.startsWith('//')
    && !/[\\\u0000-\u001f\u007f]/.test(context.cancelUrl)
    ? context.cancelUrl
    : '/';
  return `<a class="leave-interaction" href="${escapeHtml(href)}">Back to applications</a>`;
}

function changePasswordFormMarkup(uid: string, siteKey: string | undefined, context: RenderContext): string {
  const describedBy = context.errorMessage ? ' aria-describedby="sign-in-error"' : '';
  return `<form method="post" action="/interaction/${escapeHtml(uid)}/change-password">
        <input type="hidden" name="username" value="${escapeHtml(context.username ?? '')}">
        ${context.deviceEvidenceEnabled ? '<input type="hidden" name="deviceId" id="device-id" value="">' : ''}
        <label for="current">Current password</label>
        <input type="password" id="current" name="current" autocomplete="current-password"${describedBy} required>
        <label for="new">New password</label>
        <input type="password" id="new" name="next" minlength="8" autocomplete="new-password"${describedBy} required>
        <label for="confirm">Confirm new password</label>
        <input type="password" id="confirm" name="confirm" minlength="8" autocomplete="new-password"${describedBy} required>
        ${turnstileMarkup(siteKey, Boolean(context.preview))}
        <button type="submit">Change password &amp; continue</button>
      </form>`;
}

const PAGE_TITLES: Record<RenderKind, string> = {
  login: 'Sign in',
  'change-password': 'Password change required',
  error: 'Sign-in error',
};

function interactionHeading(kind: RenderKind, doc: BrandingDoc, context: RenderContext): string {
  const custom = doc.stateCopy?.[kind];
  let heading: string;
  let body: string;
  switch (kind) {
    case 'change-password':
      heading = 'Password change required';
      body = 'Choose a new directory password to continue.';
      break;
    case 'error':
      heading = 'Sign-in error';
      body = 'This request could not be completed.';
      break;
    default:
      heading = context.requestingApplication?.trim()
        ? `Sign in to ${context.requestingApplication.trim()}`
        : 'Sign in';
      body = 'Use your directory username & password.';
  }
  const bodyMarkup = custom
    ? custom.body ? `<p class="sub">${escapeHtml(custom.body)}</p>` : ''
    : `<p class="sub">${escapeHtml(body)}</p>`;
  return `<h1>${escapeHtml(custom?.heading ?? heading)}</h1>${bodyMarkup}`;
}

/**
 * Render a full HTML page from a validated branding document. The "login"
 * kind renders every block in order (the loginForm block expands into the
 * credential form). The change-password and error kinds reuse only the logo
 * blocks plus theme tokens around their fixed functional content.
 */
export function renderBrandingPage(
  kind: RenderKind,
  doc: BrandingDoc,
  context: RenderContext = {}
): string {
  const theme = resolveTheme(doc.theme);
  const titleSuffix = doc.titleSuffix ?? 'UAR Authentication';
  const uid = context.uid ?? '';

  let content: string;
  if (kind === 'login') {
    const parts: string[] = [interactionHeading(kind, doc, context)];
    for (const block of doc.blocks) {
      switch (block.type) {
        case 'logo':
          parts.push(renderLogoBlock(block));
          break;
        case 'heading':
          parts.push(`<h2 class="custom-heading">${escapeHtml(block.text)}</h2>`);
          break;
        case 'markdown':
          parts.push(renderMarkdownBlock(block));
          break;
        case 'divider':
          parts.push('<hr class="divider">');
          break;
        case 'footer':
          parts.push(`<p class="hint">${escapeHtml(block.text)}</p>`);
          break;
        case 'loginForm':
          if (context.errorMessage) {
            parts.push(`<div class="error" id="sign-in-error" role="alert">${escapeHtml(context.errorMessage)}</div>`);
          }
          parts.push(loginFormMarkup(uid, context.turnstileSiteKey, context));
          break;
      }
    }
    content = parts.join('\n      ');
  } else {
    const logos = doc.blocks.filter((b): b is Extract<BrandingBlock, { type: 'logo' }> => b.type === 'logo');
    const logoRows = logos.map(renderLogoBlock).join('\n      ');
    const errorBox =
      kind === 'error'
        ? `<div class="error" id="sign-in-error" role="alert">${escapeHtml(context.errorMessage ?? 'An unexpected error occurred.')}</div>`
        : context.errorMessage
          ? `<div class="error" id="sign-in-error" role="alert">${escapeHtml(context.errorMessage)}</div>`
          : '';
    const form =
      kind === 'error'
        ? ''
        : changePasswordFormMarkup(uid, context.turnstileSiteKey, context);
    content = `${logoRows}
      ${interactionHeading(kind, doc, context)}
      ${errorBox}
      ${form}`.replace(/\n\s*\n/g, '\n      ').trim();
  }

  const lightThemeColor = doc.theme?.pageBackground ?? '#ffffff';
  const darkThemeColor = doc.theme?.pageBackground ?? '#09090b';

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="theme-color" content="${escapeHtml(lightThemeColor)}" media="(prefers-color-scheme: light)">
<meta name="theme-color" content="${escapeHtml(darkThemeColor)}" media="(prefers-color-scheme: dark)">
<title>${escapeHtml(PAGE_TITLES[kind])} | ${escapeHtml(titleSuffix)}</title>
${context.preview ? '' : '<script src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer></script>'}<style>
  @font-face{font-family:"Geist";src:url("/ui/fonts/geist-v1-latin.woff2") format("woff2");font-style:normal;font-weight:100 900;font-display:swap}
  @font-face{font-family:"Geist Mono";src:url("/ui/fonts/geist-mono-v1-latin.woff2") format("woff2");font-style:normal;font-weight:100 900;font-display:swap}
  :root{--font-ui:"Geist","Arial",sans-serif;--font-mono:"Geist Mono","SFMono-Regular",Consolas,monospace;--focus:#18181b;--focus-contrast:#ffffff;${THEME_VAR_SOURCES.map(([, cssVar, light]) => `${cssVar}:${light}`).join(';')};${ERROR_VARS.map(([cssVar, light]) => `${cssVar}:${light}`).join(';')};--radius:${theme.controlRadiusPx}px;--card-radius:${theme.cardRadiusPx}px;color-scheme:light}
  @media (prefers-color-scheme:dark){:root{--focus:#fafafa;--focus-contrast:#09090b;${THEME_VAR_SOURCES.map(([, cssVar, , dark]) => `${cssVar}:${dark}`).join(';')};${ERROR_VARS.map(([cssVar, , dark]) => `${cssVar}:${dark}`).join(';')};color-scheme:dark}}
  ${theme.explicitVars ? `:root{${theme.explicitVars}}` : ''}
  *{box-sizing:border-box}
  html{min-height:100%;scrollbar-gutter:stable}
  body{margin:0;min-height:100dvh;font-family:var(--font-ui);color:var(--text);background:var(--page-bg);-webkit-font-smoothing:antialiased}
  ::selection{background:var(--text);color:var(--page-bg)}
  .skip-link{position:fixed;z-index:2;top:.75rem;left:.75rem;padding:.65rem .8rem;background:var(--text);color:var(--card-bg);border-radius:var(--radius);font-size:.82rem;transform:translateY(calc(-100% - 1rem));transition:transform .14s ease}.skip-link:focus{transform:translateY(0);outline:2px solid var(--focus);outline-offset:2px;box-shadow:0 0 0 6px var(--focus-contrast)}
  .identity-shell{width:100%;min-height:100dvh;display:grid;place-items:center;padding:clamp(1.25rem,5vw,4rem)}
  .credential-window{width:min(100%,420px);background:var(--card-bg)}
  .provider-lockup{display:flex;align-items:baseline;justify-content:space-between;margin:0 0 3rem;padding-bottom:1rem;border-bottom:1px solid var(--border)}
  .provider-organization{font-size:.95rem;font-weight:620;letter-spacing:-.02em}
  .provider-service{color:var(--muted);font-family:var(--font-mono);font-size:.68rem;font-weight:500;letter-spacing:.05em;text-transform:uppercase}
  .credential-content{width:100%}
  h1{font-size:1.65rem;font-weight:600;letter-spacing:-.035em;line-height:1.2;margin:0 0 .6rem;color:var(--text);text-wrap:balance}
  h2.custom-heading{margin:0 0 .65rem;font-size:1rem;font-weight:600;letter-spacing:-.015em;line-height:1.35}
  p.sub{color:var(--muted);font-size:.875rem;line-height:1.5;margin:0 0 1.75rem}
  .md{color:var(--muted);font-size:.9rem;line-height:1.6;margin:0 0 1.35rem}
  .md p{margin:.25rem 0}
  .md:last-child{margin-bottom:0}
  .md a{color:var(--text);text-underline-offset:3px}
  label{display:block;font-size:.86rem;font-weight:560;margin:1.15rem 0 .48rem;color:var(--text)}
  input[type=text],input[type=password]{display:block;width:100%;min-height:42px;padding:.58rem .7rem;border:1px solid var(--border);border-radius:var(--radius);font-size:.9rem;font-family:inherit;background:var(--card-bg);color:var(--text)}
  input[type=text]:hover,input[type=password]:hover{border-color:color-mix(in srgb,var(--text) 36%,var(--border))}
  input[type=text]:focus-visible,input[type=password]:focus-visible{outline:2px solid var(--focus);outline-offset:2px;border-color:var(--focus);box-shadow:0 0 0 2px var(--card-bg),0 0 0 6px var(--focus-contrast)}
  input:-webkit-autofill{-webkit-box-shadow:0 0 0 1000px var(--card-bg) inset;-webkit-text-fill-color:var(--text)}
  button{margin-top:1.25rem;width:100%;min-height:42px;padding:.58rem .8rem;background:var(--accent);color:var(--accent-text);border:1px solid var(--accent);border-radius:var(--radius);font-family:inherit;font-weight:600;font-size:.875rem;cursor:pointer}
  button:hover{opacity:.88}
  button:active{transform:scale(.99)}
  button:focus-visible{outline:2px solid var(--focus);outline-offset:3px;box-shadow:0 0 0 7px var(--focus-contrast)}
  .error{display:grid;grid-template-columns:auto 1fr;gap:.65rem;align-items:start;background:var(--error-bg);border:1px solid var(--error-border);border-radius:var(--radius);padding:.8rem .9rem;font-size:.85rem;line-height:1.5;margin-bottom:1.25rem;color:var(--error-text)}
  .error::before{content:"Error";font-family:var(--font-mono);font-size:.65rem;font-weight:600;letter-spacing:.04em;text-transform:uppercase;padding-top:.14rem}
  .hint{color:var(--muted);font-size:.75rem;line-height:1.5;margin:1.5rem 0 0;padding-top:1rem;border-top:1px solid var(--border)}
  .divider{border:0;border-top:1px solid var(--border);margin:1.55rem 0}
  .logo-row{display:flex;justify-content:flex-start;margin-bottom:1.4rem}
  .logo-row img{max-width:100%;object-fit:contain}
  .cf-turnstile,.preview-verification{max-width:100%;margin:1.05rem 0 .15rem}
  .preview-verification{padding:.7rem 0;border-block:1px solid var(--border);color:var(--muted);font-family:var(--font-mono);font-size:.66rem}
  .leave-interaction{display:inline-flex;margin-top:1.1rem;color:var(--muted);font-size:.82rem;text-decoration:underline;text-underline-offset:3px}.leave-interaction:hover{color:var(--text)}.leave-interaction:focus-visible{outline:2px solid var(--focus);outline-offset:3px;box-shadow:0 0 0 7px var(--focus-contrast)}
  @media(max-width:760px){.identity-shell{padding:1.25rem}}
  @media(max-width:480px){.identity-shell{place-items:start;padding:1.25rem}.credential-window{padding-top:1.5rem}.provider-lockup{margin-bottom:2.5rem}}
  @media(max-width:340px){.identity-shell{padding-inline:.625rem}}
  @media (prefers-reduced-motion:reduce){*{animation:none!important;transition:none!important}}
</style>
</head>
<body><a class="skip-link" href="#credentials">Skip to sign-in</a>
<div class="identity-shell" data-template="${escapeHtml(doc.template ?? 'split')}">
  <main class="credential-window" id="credentials">
    <div class="provider-lockup" aria-label="Identity provider">
      <span class="provider-organization">Cal Poly SOC</span>
      <span class="provider-service">IdP</span>
    </div>
    <div class="credential-content">${content}${!context.preview ? leaveInteractionMarkup(context) : ''}</div>
  </main>
</div>${!context.preview && context.deviceEvidenceEnabled ? DEVICE_HINT_SCRIPT : ''}</body></html>`;
}
