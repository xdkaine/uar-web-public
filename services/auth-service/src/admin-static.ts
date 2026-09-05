/**
 * First-party Auth Manager console assets (console rework). Served from the
 * auth service itself under a strict CSP (script/style 'self'), so
 * everything is plain CSS/JS with zero external dependencies. All dynamic
 * DOM goes through createElement/textContent - never innerHTML with data.
 *
 * Structure: shared helpers at top scope; one isolated IIFE per view
 * (dashboard, sign-ins, users, applications, sign-in appearance, audit),
 * plus theme + session (sign-out) wiring. The sign-in page reuses
 * ADMIN_CSS + ADMIN_THEME_JS.
 */

export const ADMIN_CSS = `
@font-face{font-family:"Geist";src:url("/ui/fonts/geist-v1-latin.woff2") format("woff2");font-style:normal;font-weight:100 900;font-display:swap}
@font-face{font-family:"Geist Mono";src:url("/ui/fonts/geist-mono-v1-latin.woff2") format("woff2");font-style:normal;font-weight:100 900;font-display:swap}
:root{
  --font-ui:"Geist","Arial",sans-serif;
  --font-data:"Geist Mono","SFMono-Regular",Consolas,monospace;
  --bg:#ffffff;--card:#ffffff;--card-2:#f4f4f5;--border:#e4e4e7;--border-strong:#a1a1aa;
  --text:#09090b;--muted:#71717a;--accent:#18181b;--accent-hover:#27272a;--accent-text:#fafafa;
  --signal:#18181b;--warning:#52525b;--nav:#ffffff;--nav-muted:#71717a;
  --ok:#18181b;--bad:#18181b;--input-bg:#ffffff;--hover:#f4f4f5;
  color-scheme:light}
:root[data-theme=dark]{
  --bg:#09090b;--card:#09090b;--card-2:#18181b;--border:#27272a;--border-strong:#52525b;
  --text:#fafafa;--muted:#a1a1aa;--accent:#fafafa;--accent-hover:#e4e4e7;--accent-text:#09090b;
  --signal:#fafafa;--warning:#d4d4d8;--nav:#09090b;--nav-muted:#a1a1aa;
  --ok:#fafafa;--bad:#fafafa;--input-bg:#09090b;--hover:#18181b;color-scheme:dark}
@media(prefers-color-scheme:dark){:root:not([data-theme=light]){
  --bg:#09090b;--card:#09090b;--card-2:#18181b;--border:#27272a;--border-strong:#52525b;
  --text:#fafafa;--muted:#a1a1aa;--accent:#fafafa;--accent-hover:#e4e4e7;--accent-text:#09090b;
  --signal:#fafafa;--warning:#d4d4d8;--nav:#09090b;--nav-muted:#a1a1aa;
  --ok:#fafafa;--bad:#fafafa;--input-bg:#09090b;--hover:#18181b;color-scheme:dark}}
*{box-sizing:border-box}
[hidden]{display:none!important}
html{min-height:100%}
body{margin:0;min-height:100vh;background:var(--bg);color:var(--text);font-family:var(--font-ui);font-size:14px;line-height:1.5;-webkit-font-smoothing:antialiased}
body.nav-open{overflow:hidden}
::selection{background:var(--text);color:var(--bg)}
:focus-visible{outline:2px solid var(--text)!important;outline-offset:2px!important}
*{scrollbar-width:thin;scrollbar-color:var(--border-strong) transparent}
::-webkit-scrollbar{width:10px;height:10px}::-webkit-scrollbar-thumb{background:var(--border-strong);border:3px solid transparent;background-clip:content-box}

/* Console frame and navigation */
.console-masthead{position:sticky;top:0;z-index:50;height:56px;display:flex;align-items:center;justify-content:space-between;gap:2rem;padding:0 1rem;background:var(--bg);color:var(--text);border-bottom:1px solid var(--border)}
.masthead-lockup,.provider-lockup{display:flex;align-items:center;gap:.7rem}.provider-name{display:flex;flex-direction:column;line-height:1.08}.provider-name strong{font-size:.9rem;font-weight:600;letter-spacing:-.015em}.provider-name span{margin-top:.16rem;color:var(--muted);font-family:var(--font-data);font-size:.58rem;font-weight:500;letter-spacing:.04em;text-transform:uppercase}
.masthead-edition{display:flex;align-items:center;gap:.5rem;color:var(--muted);font-family:var(--font-data);font-size:.61rem;text-transform:uppercase}.masthead-edition span{margin-right:.25rem}
.mobile-nav-toggle{display:none;min-width:40px;min-height:40px;padding:.45rem;background:transparent;color:var(--text);border:1px solid var(--border)}
.mobile-nav-toggle span,.mobile-nav-toggle::before,.mobile-nav-toggle::after{content:"";display:block;width:20px;height:1px;background:currentColor}.mobile-nav-toggle span{margin:5px 0}
.console-frame{display:flex;min-height:calc(100vh - 56px)}
.sidebar{position:sticky;top:56px;width:224px;height:calc(100dvh - 56px);flex:none;display:flex;flex-direction:column;padding:.75rem .65rem;background:var(--nav);border-right:1px solid var(--border)}
.sidebar-caption{margin:.85rem .6rem .3rem;color:var(--nav-muted);font-family:var(--font-data);font-size:.57rem;font-weight:550;letter-spacing:.05em;text-transform:uppercase}.sidebar-caption:first-child{margin-top:.2rem}
.side-nav{display:flex;flex-direction:column;flex:1;gap:.18rem;overflow-y:auto}
.side-nav .nav-btn{display:grid;grid-template-columns:1.35rem 1fr;gap:.5rem;align-items:center;width:100%;min-height:36px;padding:.45rem .55rem;background:transparent;color:var(--nav-muted);border:1px solid transparent;border-radius:6px;text-align:left;font:inherit;cursor:pointer}
.side-nav .nav-btn:hover{background:var(--hover);color:var(--text)}.side-nav .nav-btn.active{background:var(--text);color:var(--bg);border-color:var(--text)}
.nav-icon{display:flex;align-items:center;justify-content:center;color:currentColor}.nav-icon svg{width:15px;height:15px;stroke-width:1.7}.nav-label{font-size:.8rem;font-weight:500}
.side-foot{padding-top:.75rem;border-top:1px solid var(--border)}
#whoami{display:block;min-width:0;margin-bottom:.55rem;color:var(--nav-muted);font-family:var(--font-data);font-size:.68rem;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.foot-actions{display:grid}.foot-actions .nav-btn{min-height:34px;padding:.38rem .5rem;background:transparent;color:var(--nav-muted);border:1px solid var(--border);border-radius:6px;font:inherit;font-size:.72rem}.foot-actions .nav-btn:hover{color:var(--text);background:var(--hover)}
.nav-scrim{display:none}

/* Operational page hierarchy */
.view-wrap{flex:1;min-width:0;max-width:1440px;padding:clamp(1.5rem,3vw,2.75rem)}
.view-kicker{display:none}.view-head{display:flex;align-items:center;gap:.65rem;flex-wrap:wrap;margin:0 0 .35rem}
.view-head h1{margin:0;font-size:1.55rem;font-weight:600;line-height:1.2;letter-spacing:-.03em}.view-head>h2{margin:0;font-size:1rem;font-weight:600}.view-sub{max-width:72ch;margin:.4rem 0 1.5rem;color:var(--muted);font-size:.82rem}
.panel{margin:0 0 1rem;padding:1rem;background:var(--card);border:1px solid var(--border);border-radius:8px}.panel>h2:first-child{margin-top:0}
.panel h2,.panel-label{display:block;margin:0 0 .8rem;color:var(--text);font-size:.84rem;font-weight:600;letter-spacing:-.01em}
#user-detail h2{display:block;margin:.1rem 0 .6rem;color:var(--text);font-family:var(--font-ui);font-size:1.35rem;font-weight:560;letter-spacing:-.025em;text-transform:none}#user-detail h2::before{display:none}
h3{margin:.15rem 0 .45rem;font-size:1.12rem;font-weight:560;letter-spacing:-.02em}

/* Controls */
label{display:block;margin:.78rem 0 .32rem;font-size:.76rem;font-weight:540}
input[type=text],input[type=password],input[type=number],input[type=url],input[type=datetime-local],select,textarea{width:100%;min-height:38px;padding:.5rem .62rem;background:var(--input-bg);color:var(--text);border:1px solid var(--border);border-radius:6px;font:inherit;font-size:.84rem}
input:hover,select:hover,textarea:hover{border-color:var(--border-strong)}input:focus,select:focus,textarea:focus{outline:none;border-color:var(--text);box-shadow:0 0 0 2px var(--bg),0 0 0 4px var(--text)}textarea{resize:vertical;line-height:1.5}
select{appearance:none;padding-right:2rem;background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 12 12'%3E%3Cpath d='M2.5 4.5 6 8l3.5-3.5' fill='none' stroke='%2371717a' stroke-width='1.6'/%3E%3C/svg%3E");background-repeat:no-repeat;background-position:right .6rem center;background-size:11px}
.color-row{display:flex;align-items:center;justify-content:space-between;gap:.55rem;margin-bottom:.48rem}.color-row span{font-size:.78rem}.color-row input[type=color]{width:46px;height:30px;padding:2px;border:1px solid var(--border-strong);background:var(--input-bg);cursor:pointer}.color-row select{width:92px}
button{display:inline-flex;align-items:center;justify-content:center;gap:.4rem;min-height:38px;padding:.5rem .82rem;background:var(--text);color:var(--bg);border:1px solid var(--text);border-radius:6px;font:inherit;font-size:.8rem;font-weight:560;cursor:pointer}
button:hover{background:var(--accent-hover)}button:active{transform:translateY(1px)}button:disabled{opacity:.45;cursor:not-allowed;transform:none}
button.secondary{background:var(--card);color:var(--text);border-color:var(--border-strong)}button.secondary:hover{background:var(--hover)}button.mini{min-height:30px;padding:.28rem .56rem;font-size:.7rem}
button.remove{min-height:28px;padding:.12rem .4rem;background:transparent;color:var(--muted);border:0;font-size:1rem}button.remove:hover{background:color-mix(in srgb,var(--bad) 10%,transparent);color:var(--bad)}
button[data-act="delete"],button.danger{background:var(--card);color:var(--text);border-color:var(--text)}button[data-act="delete"]:hover,button.danger:hover{background:var(--text);color:var(--bg)}

/* Ledger summaries and tables */
.stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));margin:0 0 1.2rem;border-block:1px solid var(--border)}
.stat{min-height:92px;padding:.9rem;border-right:1px solid var(--border)}.stat:last-child{border-right:0}.stat .num{font-family:var(--font-data);font-size:1.65rem;font-weight:500;line-height:1.1;font-variant-numeric:tabular-nums;letter-spacing:-.04em}.stat .lbl{margin-top:.45rem;color:var(--muted);font-size:.7rem}.stat .foot{margin-top:.18rem;color:var(--muted);font-size:.68rem}
.data-table{width:100%;min-width:680px;border-collapse:collapse;font-size:.8rem}.data-table th{padding:.55rem .62rem;text-align:left;color:var(--muted);border-bottom:1px solid var(--border);font-size:.68rem;font-weight:500;white-space:nowrap}.data-table td{padding:.62rem;border-bottom:1px solid var(--border);vertical-align:top}.data-table tbody tr:hover td{background:var(--hover)}
#sessions-list,#users-results,#audit-list{overflow-x:auto}.mono{font-family:var(--font-data);font-size:.74rem}.cell-muted{color:var(--muted);font-size:.76rem}.audit-risk-high td:first-child{box-shadow:inset 3px 0 var(--text)}.audit-risk-medium td:first-child{box-shadow:inset 1px 0 var(--border-strong)}.audit-detail{max-width:620px;white-space:pre-wrap;word-break:break-word;color:var(--muted);font:11px/1.45 var(--font-data)}
.chip{display:inline-flex;align-items:center;gap:.35rem;margin:.15rem .3rem .15rem 0;padding:.14rem .48rem;background:var(--card-2);border:1px solid var(--border);border-radius:999px;font-size:.69rem}.chip b{font-weight:600;font-variant-numeric:tabular-nums}.chip.danger{background:var(--text);color:var(--bg);border-color:var(--text)}.chip.ok{background:var(--card);color:var(--text);border-color:var(--border-strong)}
.badge,.required-tag{display:inline-flex;padding:.12rem .42rem;color:var(--muted);background:var(--card-2);border:1px solid var(--border);border-radius:999px;font-family:var(--font-data);font-size:.59rem;font-weight:520;letter-spacing:.03em;text-transform:uppercase}.badge.ok,.badge.bad,.status-ok,.status-bad{color:var(--text)}

/* View-specific composition */
.filters{display:flex;align-items:center;flex-wrap:wrap;gap:.5rem;margin:0 0 .9rem}.filters input[type=text]{max-width:250px}.filters label{display:flex;align-items:center;gap:.38rem;margin:0;color:var(--muted);font-weight:500}.filters select{width:auto}.notice{margin:.45rem 0 0;color:var(--muted);font-size:.8rem;line-height:1.5}.notice.mono{font-size:.73rem}
.block-row{display:flex;align-items:center;gap:.6rem;margin-bottom:.45rem;padding:.62rem .7rem;background:var(--card);border:1px solid var(--border);border-radius:6px;cursor:grab}.block-row:hover{border-color:var(--border-strong)}.block-row.selected{border-color:var(--text);box-shadow:0 0 0 1px var(--text)}.block-row.dragging{opacity:.42}.block-row .label{flex:1;min-width:0}.block-row .title{font-weight:560;font-size:.81rem}.block-row .hint{color:var(--muted);font-size:.69rem;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.props .field{margin-bottom:.72rem}
.layout{display:grid;grid-template-columns:250px minmax(0,1fr) 320px;gap:1rem;align-items:start}.palette button{width:100%;margin-bottom:.42rem;justify-content:flex-start;background:transparent;color:var(--text);border-color:var(--border-strong)}.palette button:hover{background:var(--hover)}
.preview-frame{width:100%;max-width:900px;height:680px;background:var(--card-2);border:1px solid var(--border);border-radius:8px}.guide{margin-top:.7rem;padding:.85rem .95rem;background:var(--card-2);border:1px solid var(--border);border-radius:6px;font-size:.79rem}.guide ol{margin:.4rem 0 .35rem 1.15rem;padding:0}.guide li{margin:.28rem 0}.guide code{padding:.05rem .28rem;background:var(--hover);font-family:var(--font-data);font-size:.7rem}.secret-result,.secret-rotation{display:flex;align-items:center;flex-wrap:wrap;gap:.5rem}.secret-result .secret-value{max-width:100%;overflow:auto;white-space:nowrap}.secret-result .notice,.secret-rotation .notice{width:100%;margin:.15rem 0 0}
.reg-form{display:grid;grid-template-columns:repeat(4,1fr);gap:.7rem .8rem;align-items:end;margin-bottom:.4rem}.reg-form .field{margin:0}.reg-form .field-span2{grid-column:span 2}.reg-form button{min-height:39px}[data-per-client]{display:flex;gap:.4rem;flex-wrap:wrap;margin:0 0 .8rem}#local-accounts .block-row,#dash-editor .block-row{cursor:default}
.scope-field{margin:0;padding:.65rem .75rem;border:1px solid var(--border);border-radius:6px}.scope-field legend{padding:0 .25rem;font-size:.76rem;font-weight:540}.scope-field label{display:grid;grid-template-columns:auto 1fr 2fr;gap:.45rem;align-items:center;margin:.35rem 0;font-size:.76rem}.scope-field label span{color:var(--muted);font-size:.7rem}

/* Configuration and policy */
.identity-grid,.policy-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:1rem}.identity-grid .panel,.policy-grid .panel{margin:0}.provider-heading{display:flex;align-items:flex-start;justify-content:space-between;gap:1rem;margin-bottom:1rem}.provider-heading h2{display:block;margin:0 0 .25rem;color:var(--text);font-family:var(--font-ui);font-size:1.2rem;font-weight:610;letter-spacing:-.025em;text-transform:none}.provider-heading h2::before{display:none}.provider-heading p{margin:0;color:var(--muted);font-size:.76rem}.config-list{margin:0}.config-row{display:grid;grid-template-columns:minmax(120px,.72fr) minmax(0,1.28fr);gap:1rem;padding:.68rem 0;border-top:1px solid var(--border)}.config-row:first-child{border-top:0}.config-row dt{color:var(--muted);font-size:.73rem}.config-row dd{min-width:0;margin:0;text-align:right;font-family:var(--font-data);font-size:.7rem;overflow-wrap:anywhere}.config-row dd.state-bad{color:var(--bad)}.config-row dd.state-warn{color:var(--warning)}.config-row dd.state-ok{color:var(--ok)}
.policy-stack{display:grid;gap:0}.policy-line{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:1rem;align-items:start;padding:.72rem 0;border-top:1px solid var(--border)}.policy-line:first-child{border-top:0}.policy-line strong{display:block;font-size:.79rem}.policy-line span{display:block;margin-top:.12rem;color:var(--muted);font-size:.71rem}.policy-value{font-family:var(--font-data);font-size:.67rem;text-align:right}.managed-note{display:flex;align-items:flex-start;gap:.7rem;margin-top:1rem;padding:.75rem 0;border-top:1px solid var(--border);font-size:.76rem}.managed-note strong{white-space:nowrap}.loading-line{color:var(--muted);font-family:var(--font-data);font-size:.72rem}

/* Feedback */
#toast{position:fixed;right:1.2rem;bottom:1.2rem;z-index:80;display:none;max-width:440px;padding:.78rem 1rem;background:var(--text);color:var(--bg);border:1px solid var(--text);border-radius:6px;font-size:.81rem;box-shadow:0 12px 32px rgba(0,0,0,.16)}#toast.bad{background:var(--bg);color:var(--text);box-shadow:0 0 0 2px var(--text)}
.error{display:grid;grid-template-columns:auto 1fr;gap:.6rem;margin:0 0 1.1rem;padding:.72rem .82rem;background:var(--card);color:var(--text);border:1px solid var(--text);font-size:.85rem}.error::before{content:"Error";font-family:var(--font-data);font-size:.65rem;font-weight:650;text-transform:uppercase}
.impact-dialog{width:min(calc(100% - 2rem),520px);padding:0;background:var(--card);color:var(--text);border:1px solid var(--border-strong);border-radius:10px;box-shadow:0 24px 72px rgba(0,0,0,.3)}.impact-dialog::backdrop{background:rgba(0,0,0,.58)}.impact-form{display:grid;gap:1rem;padding:1.25rem}.impact-form h2{margin:0;font-size:1.25rem}.impact-form p{margin:0;color:var(--muted);line-height:1.55}.impact-field{display:grid;gap:.35rem}.impact-field[hidden]{display:none}.impact-actions{display:flex;justify-content:flex-end;gap:.6rem}.impact-actions .danger{background:var(--text);border-color:var(--text);color:var(--bg)}

/* Administrative sign-in */
.login-body{background:var(--bg)}.identity-login{width:min(100% - 2rem,960px);min-height:100dvh;margin:auto;padding:1.25rem 0 4rem}.login-top{display:flex;align-items:center;justify-content:space-between;padding-bottom:1rem;border-bottom:1px solid var(--border)}.login-top .provider-lockup{gap:.6rem}.login-top .provider-name span{display:none}
.auth-card{width:min(100%,380px);margin:clamp(4rem,12vh,7rem) auto 0;padding:0;background:transparent}.auth-card h1{margin:0 0 .55rem;font-size:1.65rem;font-weight:600;line-height:1.2;letter-spacing:-.035em}.auth-card .sub{margin:0 0 1.75rem;color:var(--muted);font-size:.84rem}.auth-card form>button{width:100%;margin-top:1.25rem;min-height:42px}.cf-turnstile{margin:1.05rem 0 .15rem}.theme-text{min-width:38px;min-height:34px;padding:.25rem .55rem;background:transparent;color:var(--muted);border:1px solid var(--border);border-radius:6px;font-family:var(--font-data);font-size:.72rem}.theme-text:hover{background:var(--hover);color:var(--text)}

@media(max-width:1180px){.layout{grid-template-columns:1fr 1fr}.layout .props{grid-column:span 2}.reg-form{grid-template-columns:1fr 1fr}.reg-form .field-span2{grid-column:span 2}}
@media(max-width:900px){
  .console-masthead{height:60px;padding:0 1rem}.console-masthead .provider-name span,.masthead-edition>span{display:none}.mobile-nav-toggle{display:block}.console-frame{min-height:calc(100vh - 60px)}
  .sidebar{position:fixed;z-index:70;top:60px;bottom:0;left:0;height:auto;width:min(84vw,300px);transform:translateX(-105%);transition:transform .18s ease;background:var(--nav);box-shadow:8px 0 24px rgba(0,0,0,.18)}.sidebar.open{transform:none}
  .nav-scrim{position:fixed;z-index:60;inset:60px 0 0;display:block;background:rgba(0,0,0,.55);border:0;border-radius:0;padding:0}.view-wrap{padding:1.4rem 1rem 3rem}
  .identity-login{width:min(100% - 2rem,680px)}.auth-card{margin-top:4.5rem}
}
@media(max-width:720px){.identity-grid,.policy-grid{grid-template-columns:1fr}.config-row{grid-template-columns:1fr}.config-row dd{text-align:left}.policy-line{grid-template-columns:1fr}.policy-value{text-align:left}}
@media(max-width:620px){.stats{grid-template-columns:1fr 1fr}.stat:nth-child(even){border-right:0}.layout{grid-template-columns:1fr}.layout .props{grid-column:auto}.reg-form{grid-template-columns:1fr}.reg-form .field-span2{grid-column:auto}.view-head{align-items:flex-start}.view-head h1{font-size:1.5rem}.view-head select{width:100%}.preview-frame{height:590px}}
@media(max-width:340px){.identity-login{width:100%;padding-inline:.625rem}}
@media(prefers-reduced-motion:reduce){*{animation:none!important;transition:none!important}}
`;

export const ADMIN_THEME_JS = `'use strict';
/* Light/dark theme bootstrap: explicit data-theme attribute resolved from
   the stored preference or the OS preference. Runs before paint on every
   console surface (login page included). */
(function () {
  var KEY = 'authmgr-theme';
  function stored() {
    try { return localStorage.getItem(KEY); } catch (e) { return null; }
  }
  function systemDark() {
    return !!(window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches);
  }
  function resolved() {
    var pref = stored();
    if (pref === 'dark' || pref === 'light') return pref;
    return systemDark() ? 'dark' : 'light';
  }
  function apply() {
    document.documentElement.setAttribute('data-theme', resolved());
  }
  function set(pref) {
    try { localStorage.setItem(KEY, pref); } catch (e) { /* private mode */ }
    apply();
  }
  window.AuthMgrTheme = {
    apply: apply,
    set: set,
    get: resolved,
    toggle: function () { set(resolved() === 'dark' ? 'light' : 'dark'); }
  };
  apply();
  if (window.matchMedia) {
    var mq = window.matchMedia('(prefers-color-scheme: dark)');
    var listener = function () { var pref = stored(); if (pref !== 'dark' && pref !== 'light') apply(); };
    if (mq.addEventListener) mq.addEventListener('change', listener);
    else if (mq.addListener) mq.addListener(listener);
  }
  function bindLoginToggle() {
    var button = document.getElementById('btn-login-theme');
    if (!button) return;
    var label = function () {
      var mode = resolved();
      button.textContent = mode === 'dark' ? '☀' : '☾';
      button.setAttribute('aria-label', mode === 'dark' ? 'Use light theme' : 'Use dark theme');
      button.setAttribute('title', mode === 'dark' ? 'Use light theme' : 'Use dark theme');
      button.setAttribute('aria-pressed', mode === 'dark' ? 'true' : 'false');
    };
    button.addEventListener('click', function () { window.AuthMgrTheme.toggle(); label(); });
    label();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bindLoginToggle);
  else bindLoginToggle();
})();
`;

export const ADMIN_EDITOR_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Cal Poly SOC IdP Administration</title>
<link rel="stylesheet" href="/admin/app.css">
<script src="/admin/theme.js"></script>
</head>
<body>
<header class="console-masthead">
  <div class="masthead-lockup">
    <button id="btn-mobile-nav" class="mobile-nav-toggle" type="button" aria-label="Open navigation" aria-controls="console-sidebar" aria-expanded="false"><span></span></button>
    <div class="provider-name"><strong>Cal Poly SOC</strong><span>IdP Admin</span></div>
  </div>
  <div class="masthead-edition"><span>Administration</span><button id="btn-theme" class="theme-text" type="button" aria-label="Use dark theme" title="Use dark theme">☾</button></div>
</header>
<div class="console-frame">
<aside id="console-sidebar" class="sidebar" inert>
  <nav class="side-nav" aria-label="Console sections">
<p class="sidebar-caption">Configuration</p>
<button id="btn-view-dashboard" class="nav-btn" type="button"><span class="nav-icon" aria-hidden="true"><svg viewBox="0 0 16 16" fill="none" stroke="currentColor"><rect x="2" y="2" width="5" height="5" rx="1"/><rect x="9" y="2" width="5" height="5" rx="1"/><rect x="2" y="9" width="5" height="5" rx="1"/><rect x="9" y="9" width="5" height="5" rx="1"/></svg></span><span class="nav-label">Overview</span></button>
<button id="btn-view-identity" class="nav-btn" type="button"><span class="nav-icon" aria-hidden="true"><svg viewBox="0 0 16 16" fill="none" stroke="currentColor"><circle cx="3" cy="8" r="1.5"/><circle cx="13" cy="3" r="1.5"/><circle cx="13" cy="13" r="1.5"/><path d="M4.5 8h3M8 8l3.5-4M8 8l3.5 4"/></svg></span><span class="nav-label">Identity sources</span></button>
<button id="btn-view-policies" class="nav-btn" type="button"><span class="nav-icon" aria-hidden="true"><svg viewBox="0 0 16 16" fill="none" stroke="currentColor"><path d="M8 1.5 13 3v4.3c0 3.1-1.7 5.5-5 7.2-3.3-1.7-5-4.1-5-7.2V3l5-1.5Z"/><path d="m5.6 8 1.5 1.5 3.4-3.4"/></svg></span><span class="nav-label">Sign-in rules</span></button>
<p class="sidebar-caption">Directory & access</p>
<button id="btn-view-users" class="nav-btn" type="button"><span class="nav-icon" aria-hidden="true"><svg viewBox="0 0 16 16" fill="none" stroke="currentColor"><circle cx="6" cy="5" r="2.5"/><path d="M1.8 13c.4-2.3 1.8-3.5 4.2-3.5s3.8 1.2 4.2 3.5M10 4.2c1.7.2 2.5 1.1 2.5 2.5 0 1.2-.7 2-2 2.4M11.5 10c1.5.5 2.4 1.5 2.7 3"/></svg></span><span class="nav-label">Directory users</span></button>
<button id="btn-view-clients" class="nav-btn" type="button"><span class="nav-icon" aria-hidden="true"><svg viewBox="0 0 16 16" fill="none" stroke="currentColor"><rect x="2" y="2.5" width="12" height="11" rx="2"/><path d="M2 6h12M5 4.2h.1M7 4.2h.1"/></svg></span><span class="nav-label">Applications</span></button>
<button id="btn-view-sessions" class="nav-btn" type="button"><span class="nav-icon" aria-hidden="true"><svg viewBox="0 0 16 16" fill="none" stroke="currentColor"><circle cx="8" cy="8" r="5.5"/><path d="M5 8h2l1-2 1.5 4 1-2H12"/></svg></span><span class="nav-label">Sessions</span></button>
<p class="sidebar-caption">Experience</p>
<button id="btn-view-branding" class="nav-btn" type="button"><span class="nav-icon" aria-hidden="true"><svg viewBox="0 0 16 16" fill="none" stroke="currentColor"><circle cx="8" cy="8" r="2.4"/><path d="M8 1.5v2M8 12.5v2M1.5 8h2M12.5 8h2M3.4 3.4l1.4 1.4M11.2 11.2l1.4 1.4M12.6 3.4l-1.4 1.4M4.8 11.2l-1.4 1.4"/></svg></span><span class="nav-label">Sign-in pages</span></button>
<p class="sidebar-caption">Evidence</p>
<button id="btn-view-audit" class="nav-btn" type="button"><span class="nav-icon" aria-hidden="true"><svg viewBox="0 0 16 16" fill="none" stroke="currentColor"><path d="M3 3h10M3 8h10M3 13h10"/><circle cx="5" cy="3" r="1"/><circle cx="11" cy="8" r="1"/><circle cx="7" cy="13" r="1"/></svg></span><span class="nav-label">Audit</span></button>
  </nav>
  <div class="side-foot">
    <span id="whoami"></span>
    <div class="foot-actions">
      <button id="btn-logout" class="nav-btn logout" type="button">Sign out</button>
    </div>
  </div>
</aside>
<button id="nav-scrim" class="nav-scrim" type="button" aria-label="Close navigation" hidden></button>
<main id="console-main" class="view-wrap">

<section id="view-dashboard" hidden>
  <div class="view-head"><h1 tabindex="-1">Overview</h1><span class="badge" id="dash-generated"></span></div>
  <p class="view-sub">Current sessions, sign-in outcomes, registered applications, and recent activity.</p>
  <div id="dash-widgets" class="stats"></div>
  <div id="dash-editor" hidden></div>
</section>

<section id="view-identity" hidden>
  <div class="view-head"><h1 tabindex="-1">Identity sources</h1></div>
  <p class="view-sub">Effective credential sources for application and Auth Manager sign-in.</p>

  <div class="identity-grid">
    <section class="panel">
      <div class="provider-heading"><div><h2>Active Directory</h2><p>Only credential source for application sign-in</p></div></div>
      <dl class="config-list">
        <div class="config-row"><dt>Domain</dt><dd id="identity-domain" aria-busy="true"></dd></div>
        <div class="config-row"><dt>Directory endpoint</dt><dd id="identity-endpoint" aria-busy="true"></dd></div>
        <div class="config-row"><dt>User search base</dt><dd id="identity-search-base" aria-busy="true"></dd></div>
        <div class="config-row"><dt>Transport</dt><dd id="identity-transport" aria-busy="true"></dd></div>
        <div class="config-row"><dt>Certificate verification</dt><dd id="identity-certificate" aria-busy="true"></dd></div>
        <div class="config-row"><dt>Directory browsing</dt><dd id="identity-search-mode" aria-busy="true"></dd></div>
        <div class="config-row"><dt>Configuration owner</dt><dd>Deployment environment</dd></div>
      </dl>
    </section>
    <section class="panel">
      <div class="provider-heading"><div><h2>Auth Manager recovery</h2><p>Local access to this console only</p></div><span class="badge">No OIDC access</span></div>
      <dl class="config-list">
        <div class="config-row"><dt>Activation</dt><dd id="recovery-activation">Explicit Auth Manager sign-in only</dd></div>
        <div class="config-row"><dt>OIDC identities</dt><dd class="state-ok">Never issued</dd></div>
        <div class="config-row"><dt>Account management</dt><dd>Auth Manager</dd></div>
        <div class="config-row"><dt>Configured accounts</dt><dd id="recovery-account-count" aria-busy="true"></dd></div>
      </dl>
      <div class="managed-note"><strong>Credential boundary</strong><span>Recovery credentials open Auth Manager only. They are never checked during an application sign-in and never become OIDC tokens.</span></div>
    </section>
  </div>
</section>

<section id="view-policies" hidden>
  <div class="view-head"><h1 tabindex="-1">Sign-in rules</h1><span class="badge">Read only</span></div>
  <p class="view-sub">Rules enforced by the running service configuration.</p>
  <div class="policy-grid">
    <section class="panel">
      <div class="provider-heading"><div><h2>Authentication</h2><p>Controls before a session is created</p></div></div>
      <div id="authentication-policy" class="policy-stack" aria-busy="true"></div>
    </section>
    <section class="panel">
      <div class="provider-heading"><div><h2>Tokens and claims</h2><p>Trust passed to relying applications</p></div></div>
      <div id="federation-policy" class="policy-stack" aria-busy="true"></div>
    </section>
    <section class="panel">
      <div class="provider-heading"><div><h2>Administrative access</h2><p>Who can sign in to Auth Manager</p></div></div>
      <div id="admin-policy" class="policy-stack" aria-busy="true"></div>
    </section>
    <section class="panel">
      <div class="provider-heading"><div><h2>Policy ownership</h2><p>Where each type of rule changes</p></div></div>
      <dl class="config-list">
        <div class="config-row"><dt>Provider and safeguards</dt><dd>Deployment environment</dd></div>
        <div class="config-row"><dt>Application claims and sessions</dt><dd>Applications</dd></div>
        <div class="config-row"><dt>Sign-in presentation</dt><dd>Sign-in pages</dd></div>
        <div class="config-row"><dt>Recovery accounts</dt><dd>Recovery tooling</dd></div>
      </dl>
      <div class="managed-note"><strong>Current boundary</strong><span>This console shows effective provider policy but does not rewrite environment configuration. That prevents a UI change from silently changing the service trust boundary.</span></div>
    </section>
  </div>
</section>

<section id="view-sessions" hidden>
  <div class="view-head"><h1 tabindex="-1">Sessions</h1></div>
  <p class="view-sub">Active identity-provider sessions. End one session, one user's sessions, or every session for an application.</p>
  <section class="panel">
    <div id="sessions-stats" class="stats"></div>
    <div class="filters">
      <label>User <input id="sess-filter-user" type="text"></label>
      <label>Application <input id="sess-filter-app" type="text"></label>
      <label>IP address <input id="sess-filter-ip" type="text"></label>
      <label>Browser or device <input id="sess-filter-device" type="text"></label>
      <select id="sess-filter-amr" aria-label="Filter authentication method"><option value="">All methods</option><option value="ad">Directory</option><option value="pwd_changed">Password changed</option><option value="pwd">Password</option></select>
      <button type="button" class="secondary mini" id="btn-sess-refresh">Refresh</button>
      <label><input type="checkbox" id="sess-autorefresh" checked> Auto-refresh (30s)</label>
    </div>
    <div id="sessions-list"></div>
  </section>
</section>

<section id="view-users" hidden>
  <div class="view-head"><h1 tabindex="-1">Directory users</h1></div>
  <p class="view-sub">Search Active Directory and review account state and sign-in history.</p>
  <section class="panel">
    <div class="filters">
      <label>Name, username, or email <input id="user-query" type="text"></label>
      <button id="btn-user-search" class="secondary" type="button">Search</button>
    </div>
    <div id="users-results"></div>
  </section>
  <section class="panel" id="user-detail" hidden></section>
  <section class="panel">
    <h2>Auth Manager recovery accounts</h2>
    <p class="notice">These accounts can open Auth Manager only. Active Directory administrators manage the roster; a recovery administrator can rotate only its own password.</p>
    <form id="recovery-form" class="reg-form">
      <div class="field"><label for="recovery-username">Username</label><input id="recovery-username" autocomplete="off" required></div>
      <div class="field field-span2"><label for="recovery-password">Initial password</label><input id="recovery-password" type="password" autocomplete="new-password" minlength="16" maxlength="256" required></div>
      <button id="btn-recovery-create" type="submit">Create recovery account</button>
    </form>
    <div id="recovery-accounts"></div>
  </section>
</section>

<section id="view-clients" hidden>
  <div class="view-head"><h1 tabindex="-1">Applications</h1></div>
  <p class="view-sub">Connect services to this issuer with OpenID Connect. New registrations work immediately; client secrets are shown once.</p>
  <section class="panel">
    <h2>Register application</h2>
    <form id="client-form" class="reg-form">
      <div class="field"><label for="client-name">Application name</label><input id="client-name" required></div>
      <div class="field field-span2"><label for="client-uris">Redirect URIs</label><textarea id="client-uris" rows="2" aria-describedby="client-uris-help" required></textarea><p id="client-uris-help" class="notice">Enter one exact URI per line.</p></div>
      <fieldset class="field field-span2 scope-field"><legend>Claims</legend><label><input type="checkbox" name="client-scope" value="openid" checked disabled> OpenID identifier <span>Required</span></label><label><input type="checkbox" name="client-scope" value="profile" checked> Profile <span>Name and username</span></label><label><input type="checkbox" name="client-scope" value="email" checked> Email <span>Directory email</span></label><label><input type="checkbox" name="client-scope" value="groups"> Groups <span>AD group names; enable only when needed</span></label><label><input type="checkbox" name="client-scope" value="amr"> Authentication method <span>AD session evidence</span></label></fieldset>
      <div class="field field-span2"><label for="client-post-logout">Post-logout redirect URIs (optional)</label><textarea id="client-post-logout" rows="2" aria-describedby="client-post-logout-help"></textarea><p id="client-post-logout-help" class="notice">Enter one exact URI per line.</p></div>
      <div class="field field-span2"><label for="client-backchannel">Back-channel logout URI (optional)</label><input id="client-backchannel"></div>
      <div class="field"><label for="client-ttl">Session lifetime</label><select id="client-ttl"><option value="">Default (8 hours)</option><option value="3600">1 hour</option><option value="28800">8 hours</option><option value="43200">12 hours</option><option value="86400">1 day</option><option value="604800">7 days</option><option value="1209600">14 days</option></select></div>
      <button type="submit">Register application</button>
    </form>
  </section>
  <div id="clients-list"></div>
  <section class="panel">
    <h2>Application directory</h2>
    <p class="notice">Only published entries appear at the identity-provider root. OIDC registrations are never published automatically.</p>
    <form id="catalog-form" class="reg-form">
      <input id="catalog-id" type="hidden">
      <div class="field"><label for="catalog-name">Name</label><input id="catalog-name" required></div>
      <div class="field"><label for="catalog-slug">Slug</label><input id="catalog-slug" required></div>
      <div class="field field-span2"><label for="catalog-description">Description</label><input id="catalog-description" maxlength="240"></div>
      <div class="field field-span2"><label for="catalog-url">Launch URL</label><input id="catalog-url" type="url" required></div>
      <div class="field"><label for="catalog-kind">Type</label><select id="catalog-kind"><option value="oidc">Uses Cal Poly SOC IdP</option><option value="external">Other service</option></select></div>
      <div class="field"><label for="catalog-client">OIDC application</label><select id="catalog-client"><option value="">None</option></select></div>
      <div class="field"><label for="catalog-visibility">Visibility</label><select id="catalog-visibility"><option value="hidden">Hidden draft</option><option value="public">Published</option></select></div>
      <div class="field"><label for="catalog-sort">Sort order</label><input id="catalog-sort" type="number" value="0"></div>
      <button type="submit">Save directory entry</button><button id="btn-catalog-cancel" class="secondary" type="button" hidden>Cancel edit</button>
    </form>
    <div id="catalog-list"></div>
  </section>
</section>

<section id="view-audit" hidden>
  <div class="view-head"><h1 tabindex="-1">Audit log</h1></div>
  <p class="view-sub">Search and export identity and security events.</p>
  <section class="panel">
    <div class="filters">
      <label>Search <input id="audit-query" type="text"></label>
      <label>User or subject <input id="audit-user" type="text"></label>
      <label>Action <input id="audit-action" type="text"></label>
      <label>IP address <input id="audit-ip" type="text"></label>
      <select id="audit-outcome" aria-label="Filter outcome"><option value="">All outcomes</option><option>success</option><option>failure</option><option>denied</option><option>pending</option><option>skipped</option></select>
      <select id="audit-risk" aria-label="Filter risk"><option value="">All risk</option><option>low</option><option>medium</option><option>high</option></select>
      <label>From <input id="audit-from" type="datetime-local"></label>
      <label>To <input id="audit-to" type="datetime-local"></label>
      <button id="btn-audit-refresh" class="secondary mini" type="button">Apply filters</button>
      <button id="btn-audit-csv" class="secondary mini" type="button">Export CSV</button>
      <button id="btn-audit-ndjson" class="secondary mini" type="button">Export NDJSON</button>
    </div>
    <div id="audit-list"></div>
    <button id="btn-audit-more" class="secondary" type="button" hidden>Load more</button>
  </section>
</section>

<div id="view-branding" hidden>
  <div class="view-head">
    <h1 tabindex="-1">Sign-in pages</h1>
    <select id="profile-select" aria-label="Application profile"></select>
    <select id="branding-template" aria-label="Sign-in page template"><option value="split">Split</option><option value="focused">Focused</option><option value="compact">Compact</option></select>
    <select id="preview-kind" aria-label="Preview state"><option value="login">Sign in</option><option value="change-password">Password change</option><option value="error">Error</option></select>
    <button id="btn-preview" class="secondary" type="button">Preview</button>
    <button id="btn-publish" type="button">Publish</button>
  </div>
  <p class="view-sub">Arrange and style the sign-in page users see for the selected application. Publish goes live within ~30 seconds.</p>
  <section class="panel">
    <h2>Copy for selected preview state</h2>
    <div class="reg-form">
      <div class="field field-span2"><label for="state-copy-heading">Heading</label><input id="state-copy-heading" type="text" maxlength="120"></div>
      <div class="field field-span2"><label for="state-copy-body">Supporting text</label><textarea id="state-copy-body" rows="2" maxlength="300"></textarea></div>
    </div>
    <p class="notice">Choose Sign in, Password change, or Error above, then edit that state's copy. Empty fields use the built-in text.</p>
  </section>
  <div class="layout">
    <section class="panel palette">
      <h2>Add content</h2>
      <div id="palette"></div>
      <h2 style="margin-top:1rem">Theme</h2>
      <div id="theme-controls"></div>
      <button id="btn-reset" class="secondary" type="button" style="width:100%;margin-top:.75rem">Reset draft to default</button>
    </section>
    <section class="panel">
      <h2>Layout — drag rows to reorder</h2>
      <div id="canvas"></div>
      <p class="notice" id="form-warning" hidden>The layout needs exactly one Sign-in Form block.</p>
    </section>
    <section class="panel props">
      <h2 id="props-title">Properties</h2>
      <div id="props"><p class="notice">Select a block to edit it.</p></div>
    </section>
  </div>
  <section class="panel" style="margin-top:1rem">
    <h2>Live preview</h2>
    <iframe id="preview" class="preview-frame" title="Sign-in page preview"></iframe>
    <p class="notice">The preview uses the live sign-in renderer. Human verification is disabled in preview.</p>
  </section>
  <section class="panel">
    <h2>Published history</h2>
    <div id="branding-revisions"></div>
  </section>
</div>

</main>
</div>
<div id="toast" role="status" aria-live="polite" aria-atomic="true"></div>
<dialog id="impact-dialog" class="impact-dialog" aria-labelledby="impact-title" aria-describedby="impact-description">
  <form id="impact-form" class="impact-form" method="dialog">
    <h2 id="impact-title">Confirm action</h2>
    <p id="impact-description"></p>
    <label id="impact-field" class="impact-field" for="impact-value" hidden><span id="impact-label"></span><input id="impact-value"></label>
    <p id="impact-evidence" class="notice"></p>
    <div class="impact-actions"><button id="impact-cancel" class="secondary" type="button">Cancel</button><button id="impact-confirm" type="submit">Continue</button></div>
  </form>
</dialog>
<script src="/admin/app.js"></script>
</body>
</html>`;

export const ADMIN_JS = `'use strict';
/* Shared helpers (top scope so every view IIFE can use them). */
var el = function (id) { return document.getElementById(id); };
var esc = function (value) {
  return String(value == null ? '' : value).replace(/[&<>"']/g, function (ch) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch];
  });
};
var toastTimer = null;
var setStatus = function (text, bad) {
  var toast = el('toast');
  if (toast) {
    toast.textContent = text || '';
    toast.className = bad ? 'bad' : '';
    toast.setAttribute('role', bad ? 'alert' : 'status');
    toast.setAttribute('aria-live', bad ? 'assertive' : 'polite');
    toast.style.display = text ? 'block' : 'none';
    if (toastTimer) clearTimeout(toastTimer);
    if (text) {
      toastTimer = setTimeout(function () { toast.style.display = 'none'; }, bad ? 8000 : 4000);
    }
  }
};
var pendingRequests = 0;
var setBusy = function (busy) {
  var main = el('console-main');
  if (!main) return;
  main.setAttribute('aria-busy', busy ? 'true' : 'false');
};
var api = function (method, path, body) {
  pendingRequests += 1;
  setBusy(true);
  return fetch(path, {
    method: method,
    headers: body ? { 'Content-Type': 'application/json' } : {},
    credentials: 'same-origin',
    body: body ? JSON.stringify(body) : undefined
  }).then(function (response) {
    return response.json().catch(function () { return {}; }).then(function (data) {
      if (!response.ok) {
        var message = data.error || data.detail || ('Request failed (' + response.status + ')');
        if (data.detail && data.error) message = data.error + ': ' + data.detail;
        if (data.issues && data.issues.length) message += ': ' + data.issues.join('; ');
        throw new Error(message);
      }
      return data;
    });
  }).finally(function () {
    pendingRequests = Math.max(0, pendingRequests - 1);
    setBusy(pendingRequests > 0);
  });
};
var requestImpact = function (options) {
  return new Promise(function (resolve) {
    var dialog = el('impact-dialog');
    var form = el('impact-form');
    var cancel = el('impact-cancel');
    var confirm = el('impact-confirm');
    var field = el('impact-field');
    var input = el('impact-value');
    var previous = document.activeElement;
    var settled = false;
    el('impact-title').textContent = options.title || 'Confirm action';
    el('impact-description').textContent = options.description || '';
    el('impact-evidence').textContent = options.evidence || 'The audit trail records the acting administrator and outcome.';
    confirm.textContent = options.confirmLabel || 'Continue';
    confirm.className = options.destructive ? 'danger' : '';
    field.hidden = !options.inputLabel;
    el('impact-label').textContent = options.inputLabel || '';
    input.value = options.defaultValue || '';
    input.type = options.inputType === 'password' ? 'password' : 'text';
    input.autocomplete = options.inputType === 'password' ? 'new-password' : 'off';
    input.required = Boolean(options.inputRequired);
    var finish = function (result) {
      if (settled) return;
      settled = true;
      form.removeEventListener('submit', submit);
      cancel.removeEventListener('click', cancelClick);
      dialog.removeEventListener('cancel', cancelDialog);
      if (dialog.open) dialog.close();
      if (previous && previous.focus) previous.focus();
      resolve(result);
    };
    var submit = function (event) { event.preventDefault(); finish({ confirmed: true, value: input.value }); };
    var cancelClick = function () { finish({ confirmed: false, value: null }); };
    var cancelDialog = function (event) { event.preventDefault(); finish({ confirmed: false, value: null }); };
    form.addEventListener('submit', submit);
    cancel.addEventListener('click', cancelClick);
    dialog.addEventListener('cancel', cancelDialog);
    dialog.showModal();
    if (options.inputLabel) input.focus(); else cancel.focus();
  });
};
var timeAgo = function (iso) {
  if (!iso) return '-';
  var seconds = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  if (seconds < 60) return seconds + 's ago';
  if (seconds < 3600) return Math.floor(seconds / 60) + 'm ago';
  if (seconds < 86400) return Math.floor(seconds / 3600) + 'h ago';
  return Math.floor(seconds / 86400) + 'd ago';
};
var timeAhead = function (iso) {
  if (!iso) return '-';
  var seconds = Math.floor((new Date(iso).getTime() - Date.now()) / 1000);
  if (seconds <= 0) return 'expired';
  if (seconds < 3600) return 'in ' + Math.floor(seconds / 60) + 'm';
  if (seconds < 86400) return 'in ' + Math.floor(seconds / 3600) + 'h';
  return 'in ' + Math.floor(seconds / 86400) + 'd';
};
var fmtWhen = function (iso) {
  if (!iso) return '-';
  try { return new Date(iso).toLocaleString(); } catch (e) { return String(iso); }
};

/* ---- Theme toggle -------------------------------------------------------- */
(function () {
  var button = el('btn-theme');
  if (!button) return;
  var label = function () {
    var mode = window.AuthMgrTheme ? window.AuthMgrTheme.get() : 'light';
    button.textContent = mode === 'dark' ? '☀' : '☾';
    button.setAttribute('aria-label', mode === 'dark' ? 'Use light theme' : 'Use dark theme');
    button.setAttribute('title', mode === 'dark' ? 'Use light theme' : 'Use dark theme');
    button.setAttribute('aria-pressed', mode === 'dark' ? 'true' : 'false');
  };
  button.addEventListener('click', function () {
    if (window.AuthMgrTheme) window.AuthMgrTheme.toggle();
    label();
  });
  label();
})();

/* ---- Mobile navigation -------------------------------------------------- */
(function () {
  var button = el('btn-mobile-nav');
  var sidebar = el('console-sidebar');
  var scrim = el('nav-scrim');
  if (!button || !sidebar || !scrim) return;
  var mobile = window.matchMedia ? window.matchMedia('(max-width: 900px)') : { matches: false };
  function syncAccess() {
    var closedOnMobile = mobile.matches && !sidebar.classList.contains('open');
    sidebar.inert = closedOnMobile;
    if (closedOnMobile) sidebar.setAttribute('aria-hidden', 'true');
    else sidebar.removeAttribute('aria-hidden');
  }
  function close(restoreFocus) {
    sidebar.classList.remove('open');
    scrim.hidden = true;
    document.body.classList.remove('nav-open');
    button.setAttribute('aria-expanded', 'false');
    button.setAttribute('aria-label', 'Open navigation');
    syncAccess();
    if (restoreFocus) button.focus();
  }
  function open() {
    sidebar.classList.add('open');
    sidebar.inert = false;
    sidebar.removeAttribute('aria-hidden');
    scrim.hidden = false;
    document.body.classList.add('nav-open');
    button.setAttribute('aria-expanded', 'true');
    button.setAttribute('aria-label', 'Close navigation');
    var active = sidebar.querySelector('.nav-btn.active') || sidebar.querySelector('button');
    if (active) active.focus();
  }
  button.addEventListener('click', function () {
    if (sidebar.classList.contains('open')) close(true); else open();
  });
  scrim.addEventListener('click', function () { close(true); });
  document.addEventListener('keydown', function (event) {
    if (event.key === 'Escape' && sidebar.classList.contains('open')) {
      close(true);
      return;
    }
    if (event.key !== 'Tab' || !mobile.matches || !sidebar.classList.contains('open')) return;
    var focusable = Array.prototype.slice.call(sidebar.querySelectorAll('button:not([disabled]),a[href],input:not([disabled]),select:not([disabled]),textarea:not([disabled])'));
    if (!focusable.length) return;
    var first = focusable[0];
    var last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  });
  var viewportChanged = function () {
    if (!mobile.matches) {
      sidebar.classList.remove('open');
      scrim.hidden = true;
      document.body.classList.remove('nav-open');
    }
    syncAccess();
  };
  if (mobile.addEventListener) mobile.addEventListener('change', viewportChanged);
  else if (mobile.addListener) mobile.addListener(viewportChanged);
  syncAccess();
  window.AuthMgrNavClose = close;
})();

/* ---- Sign out ------------------------------------------------------------ */
(function () {
  var button = el('btn-logout');
  if (!button) return;
  button.addEventListener('click', function () {
    button.disabled = true;
    fetch('/admin/logout', { method: 'POST', credentials: 'same-origin' })
      .catch(function () { /* clearing cookies succeeded server-side regardless */ })
      .then(function () { window.location.href = '/admin'; });
  });
})();

/* ---- View switching ------------------------------------------------------ */
(function () {
  var views = {
    dashboard: { section: 'view-dashboard', button: 'btn-view-dashboard', event: 'authmgr:show-dashboard' },
    identity: { section: 'view-identity', button: 'btn-view-identity', event: 'authmgr:show-identity' },
    policies: { section: 'view-policies', button: 'btn-view-policies', event: 'authmgr:show-policies' },
    sessions: { section: 'view-sessions', button: 'btn-view-sessions', event: 'authmgr:show-sessions' },
    users: { section: 'view-users', button: 'btn-view-users', event: 'authmgr:show-users' },
    clients: { section: 'view-clients', button: 'btn-view-clients', event: 'authmgr:show-clients' },
    branding: { section: 'view-branding', button: 'btn-view-branding', event: 'authmgr:show-branding' },
    audit: { section: 'view-audit', button: 'btn-view-audit', event: 'authmgr:show-audit' }
  };
  var current = null;
  function viewFromLocation() {
    var name = window.location.hash.replace(/^#/, '');
    return views[name] ? name : 'dashboard';
  }
  function writeLocation(name) {
    var hash = '#' + name;
    if (window.location.hash !== hash) window.history.pushState(null, '', hash);
  }
  function show(name, moveFocus, updateLocation) {
    if (!views[name]) name = 'dashboard';
    if (current === name) {
      if (updateLocation) writeLocation(name);
      document.dispatchEvent(new CustomEvent(views[name].event));
      return;
    }
    current = name;
    Object.keys(views).forEach(function (key) {
      var active = key === name;
      var section = el(views[key].section);
      var button = el(views[key].button);
      section.hidden = !active;
      button.classList.toggle('active', active);
      if (active) button.setAttribute('aria-current', 'page');
      else button.removeAttribute('aria-current');
    });
    if (window.AuthMgrNavClose) window.AuthMgrNavClose();
    if (moveFocus) {
      var heading = el(views[name].section).querySelector('h1');
      if (heading) heading.focus();
    }
    if (updateLocation) writeLocation(name);
    document.dispatchEvent(new CustomEvent(views[name].event));
    document.dispatchEvent(new CustomEvent('authmgr:view-change', { detail: { name: name } }));
  }
  Object.keys(views).forEach(function (key) {
    el(views[key].button).addEventListener('click', function () { show(key, true, true); });
  });
  window.addEventListener('hashchange', function () { show(viewFromLocation(), true, false); });
  window.addEventListener('popstate', function () { show(viewFromLocation(), true, false); });
  setTimeout(function () { show(viewFromLocation(), false, false); }, 0);
})();

/* ---- Dashboard ------------------------------------------------------------ */
(function () {
  var REGISTRY = {
    active_sessions: 'Active sessions',
    distinct_users: 'Users signed in',
    signins_24h: 'Sign-ins (24h)',
    failed_signins_24h: 'Failed sign-ins (24h)',
    high_risk_signins_24h: 'High-risk sign-ins (24h)',
    registered_apps: 'Applications',
    recent_activity: 'Recent activity'
  };
  var DEFAULT_LAYOUT = ['high_risk_signins_24h', 'failed_signins_24h', 'active_sessions', 'distinct_users', 'signins_24h', 'recent_activity', 'registered_apps'];
  var layout = DEFAULT_LAYOUT.slice();
  var data = null;
  var dashboardState = 'loading';
  var customizing = false;
  var draft = [];

  function widgetBody(key) {
    var wrap = document.createElement('div');
    if (!data || !data.widgets) return wrap;
    var w = data.widgets;
    if (key === 'active_sessions') {
      addStat(wrap, String(w.active_sessions.count), 'Active sessions', 'live IdP sessions');
    } else if (key === 'distinct_users') {
      addStat(wrap, String(w.distinct_users.count), 'Users signed in', 'distinct accounts');
    } else if (key === 'signins_24h') {
      var rate = w.signins_24h.successRate === null ? '-' : w.signins_24h.successRate + '%';
      addStat(wrap, String(w.signins_24h.success), 'Sign-ins (24h)', 'success rate ' + rate);
    } else if (key === 'high_risk_signins_24h') {
      addStat(wrap, String(w.high_risk_signins_24h.count), 'High-risk sign-ins (24h)', 'shadow evidence; review in Audit');
    } else if (key === 'failed_signins_24h') {
      addStat(wrap, String(w.failed_signins_24h.count), 'Failed sign-ins (24h)', 'denied or wrong password');
    } else if (key === 'registered_apps') {
      addStat(wrap, String(w.registered_apps.enabled), 'Applications', w.registered_apps.total + ' registered total');
    } else if (key === 'recent_activity') {
      var title = document.createElement('div');
      title.className = 'lbl';
      title.style.textTransform = 'uppercase';
      title.textContent = 'Recent activity';
      wrap.appendChild(title);
      var list = document.createElement('div');
      (w.recent_activity || []).slice(0, 8).forEach(function (row) {
        var line = document.createElement('div');
        line.className = 'cell-muted';
        line.style.marginTop = '.3rem';
        line.textContent = row.action + ' - ' + row.username + (row.outcome ? ' (' + row.outcome + ')' : '') + ', ' + timeAgo(row.createdAt);
        list.appendChild(line);
      });
      if (!(w.recent_activity || []).length) {
        var empty = document.createElement('div');
        empty.className = 'cell-muted';
        empty.textContent = 'No events yet.';
        list.appendChild(empty);
      }
      wrap.appendChild(list);
    }
    return wrap;
  }
  function addStat(host, num, label, foot) {
    var numEl = document.createElement('div');
    numEl.className = 'num';
    numEl.textContent = num;
    var lbl = document.createElement('div');
    lbl.className = 'lbl';
    lbl.textContent = label;
    host.appendChild(numEl);
    host.appendChild(lbl);
    if (foot) {
      var footEl = document.createElement('div');
      footEl.className = 'foot';
      footEl.textContent = foot;
      host.appendChild(footEl);
    }
  }

  function renderWidgets() {
    var host = el('dash-widgets');
    host.className = customizing ? 'stats' + ' widget-list' : 'stats';
    host.textContent = '';
    if (!data || !data.widgets) {
      var notice = document.createElement('div');
      notice.className = 'panel dashboard-state';
      var message = document.createElement('p');
      message.className = 'notice';
      message.textContent = dashboardState === 'loading'
        ? 'Loading operational data…'
        : 'Operational data is unavailable. Counts are not shown.';
      notice.appendChild(message);
      if (dashboardState === 'unavailable') {
        var retry = document.createElement('button');
        retry.type = 'button'; retry.className = 'secondary mini'; retry.textContent = 'Retry';
        retry.addEventListener('click', loadDashboard);
        notice.appendChild(retry);
      }
      host.appendChild(notice);
      var unavailableGenerated = el('dash-generated');
      if (unavailableGenerated) unavailableGenerated.textContent = '';
      return;
    }
    var source = customizing ? draft : layout;
    source.forEach(function (key) {
      var card = document.createElement('div');
      card.className = 'stat';
      card.appendChild(widgetBody(key));
      host.appendChild(card);
    });
    var generated = el('dash-generated');
    if (generated) generated.textContent = data && data.generatedAt ? 'updated ' + timeAgo(data.generatedAt) : '';
  }

  function renderEditor() {
    var host = el('dash-editor');
    host.textContent = '';
    if (!customizing) { host.hidden = true; return; }
    host.hidden = false;
    draft.forEach(function (key, index) {
      var row = document.createElement('div');
      row.className = 'block-row';
      var label = document.createElement('div');
      label.className = 'label';
      label.textContent = REGISTRY[key] || key;
      row.appendChild(label);
      var up = document.createElement('button');
      up.type = 'button'; up.className = 'secondary mini'; up.textContent = 'Up';
      up.disabled = index === 0;
      up.addEventListener('click', function () { draft.splice(index - 1, 0, draft.splice(index, 1)[0]); renderEditor(); });
      var down = document.createElement('button');
      down.type = 'button'; down.className = 'secondary mini'; down.textContent = 'Down';
      down.disabled = index === draft.length - 1;
      down.addEventListener('click', function () { draft.splice(index + 1, 0, draft.splice(index, 1)[0]); renderEditor(); });
      var remove = document.createElement('button');
      remove.type = 'button'; remove.className = 'secondary mini'; remove.textContent = 'Remove';
      remove.disabled = draft.length <= 1;
      remove.addEventListener('click', function () { draft.splice(index, 1); renderEditor(); });
      row.appendChild(up); row.appendChild(down); row.appendChild(remove);
      host.appendChild(row);
    });
    Object.keys(REGISTRY).forEach(function (key) {
      if (draft.indexOf(key) >= 0) return;
      var row = document.createElement('div');
      row.className = 'block-row';
      var label = document.createElement('div');
      label.className = 'label';
      label.textContent = '+ ' + (REGISTRY[key] || key);
      row.appendChild(label);
      var add = document.createElement('button');
      add.type = 'button'; add.className = 'secondary mini'; add.textContent = 'Add';
      add.addEventListener('click', function () { draft.push(key); renderEditor(); });
      row.appendChild(add);
      host.appendChild(row);
    });
    var actions = document.createElement('div');
    actions.className = 'filters';
    actions.style.marginTop = '.6rem';
    var save = document.createElement('button');
    save.type = 'button'; save.textContent = 'Save layout';
    save.addEventListener('click', function () {
      api('PUT', '/admin/api/dashboard/layout', { widgets: draft })
        .then(function () { layout = draft.slice(); customizing = false; renderWidgets(); renderEditor(); setStatus('Dashboard layout saved.'); })
        .catch(function (error) { setStatus(error.message, true); });
    });
    var reset = document.createElement('button');
    reset.type = 'button'; reset.className = 'secondary';
    reset.textContent = 'Use default layout';
    reset.addEventListener('click', function () {
      api('PUT', '/admin/api/dashboard/layout', { widgets: DEFAULT_LAYOUT })
        .then(function () { layout = DEFAULT_LAYOUT.slice(); customizing = false; renderWidgets(); renderEditor(); setStatus('Dashboard layout reset to default.'); })
        .catch(function (error) { setStatus(error.message, true); });
    });
    var cancel = document.createElement('button');
    cancel.type = 'button'; cancel.className = 'secondary';
    cancel.textContent = 'Cancel';
    cancel.addEventListener('click', function () { customizing = false; renderWidgets(); renderEditor(); });
    actions.appendChild(save); actions.appendChild(reset); actions.appendChild(cancel);
    host.appendChild(actions);
  }

  function loadDashboard() {
    dashboardState = 'loading';
    data = null;
    renderWidgets();
    api('GET', '/admin/api/dashboard')
      .then(function (payload) {
        data = payload.data || null;
        dashboardState = data && data.widgets ? 'ready' : 'unavailable';
        layout = DEFAULT_LAYOUT.slice();
        customizing = false;
        renderWidgets();
        renderEditor();
      })
      .catch(function (error) {
        data = null;
        dashboardState = 'unavailable';
        renderWidgets();
        setStatus(error.message, true);
      });
  }
  document.addEventListener('authmgr:show-dashboard', loadDashboard);
})();

/* ---- Identity sources and effective sign-in policy ----------------------- */
(function () {
  var configuration = null;
  var loading = null;

  function text(id, value) {
    var node = el(id);
    if (node) {
      node.textContent = String(value == null ? '' : value);
      node.removeAttribute('aria-busy');
    }
  }

  function duration(ms) {
    var minutes = Math.round(Number(ms || 0) / 60000);
    if (minutes < 60) return minutes + ' min';
    var hours = Math.round(minutes / 60);
    return hours + ' hr';
  }

  function policyLine(title, detail, value, state) {
    var row = document.createElement('div');
    row.className = 'policy-line' + (state ? ' ' + state : '');
    var body = document.createElement('div');
    var heading = document.createElement('strong');
    heading.textContent = title;
    var description = document.createElement('span');
    description.textContent = detail;
    body.appendChild(heading);
    body.appendChild(description);
    var evidence = document.createElement('div');
    evidence.className = 'policy-value';
    evidence.textContent = value;
    row.appendChild(body);
    row.appendChild(evidence);
    return row;
  }

  function renderIdentity(data) {
    var source = data.source;
    text('identity-domain', source.domain);
    text('identity-endpoint', source.endpoint);
    text('identity-search-base', source.searchBase);
    text('identity-transport', source.transport);
    text('identity-certificate', source.certificateVerification);
    text('identity-search-mode', source.directorySearch);
    text('recovery-activation', data.recovery.activation);
    text('recovery-account-count', data.recovery.accountCount == null ? 'Unavailable' : data.recovery.accountCount);

    var transport = el('identity-transport');
    var certificate = el('identity-certificate');
    if (transport) transport.className = source.transport === 'LDAPS' ? 'state-ok' : 'state-bad';
    if (certificate) certificate.className = source.certificateVerification === 'required' ? 'state-ok' : source.certificateVerification === 'disabled' ? 'state-warn' : 'state-bad';
  }

  function renderPolicies(data) {
    var safeguards = data.safeguards;
    var federation = data.federation;
    var admin = data.administration;
    var authHost = el('authentication-policy');
    var federationHost = el('federation-policy');
    var adminHost = el('admin-policy');
    authHost.textContent = '';
    federationHost.textContent = '';
    adminHost.textContent = '';
    authHost.removeAttribute('aria-busy');
    federationHost.removeAttribute('aria-busy');
    adminHost.removeAttribute('aria-busy');

    authHost.appendChild(policyLine('Human verification', 'Required before credentials are evaluated.', 'Turnstile', ''));
    authHost.appendChild(policyLine('IP attempt limit', 'Fixed window across sign-in attempts.', safeguards.ipRateLimit.attempts + ' / ' + duration(safeguards.ipRateLimit.windowMs), ''));
    authHost.appendChild(policyLine('Account lockout', 'Per-username limiter alongside the IP control.', safeguards.accountLockout.attempts + ' / ' + duration(safeguards.accountLockout.windowMs), ''));
    authHost.appendChild(policyLine('Proxy address trust', 'Forwarded addresses are accepted only behind the trusted proxy.', safeguards.trustedProxyHeaders ? 'enabled' : 'disabled', safeguards.trustedProxyHeaders ? '' : 'warn'));
    authHost.appendChild(policyLine('Device evidence', 'Observational only; it never authorizes or blocks a session.', safeguards.deviceEvidence, safeguards.deviceEvidence === 'shadow' ? '' : 'warn'));

    federationHost.appendChild(policyLine('Authentication flow', 'Every client must use the authorization code flow with PKCE.', federation.flow, ''));
    federationHost.appendChild(policyLine('ID token signing', 'The provider signs identity tokens with its RSA key.', federation.signingAlgorithm, ''));
    federationHost.appendChild(policyLine('Default session', 'Applications can set a bounded session override.', duration(federation.defaultSessionTtlSeconds * 1000), ''));
    federationHost.appendChild(policyLine('Available scopes', 'Each application receives only scopes enabled on its registration.', federation.allowedScopes.join(' · '), ''));
    federationHost.appendChild(policyLine('Authorization data', 'Portal roles and elevation are resolved by each relying party.', 'not in tokens', ''));
    federationHost.appendChild(policyLine('Coordinated sign-out', 'Session termination pushes signed logout tokens to registered apps.', federation.backChannelLogout ? 'enabled' : 'disabled', federation.backChannelLogout ? '' : 'warn'));

    adminHost.appendChild(policyLine('Named operators', 'Explicit Active Directory usernames allowed to attempt console sign-in.', String(admin.namedOperators), admin.namedOperators ? '' : 'warn'));
    adminHost.appendChild(policyLine('Allowed groups', 'Configured Active Directory groups that grant console access.', String(admin.allowedGroups), admin.allowedGroups ? '' : 'warn'));
    adminHost.appendChild(policyLine('Live directory verification', 'Current account state and allowed-group membership are rechecked before each protected request.', admin.directoryVerification, ''));
    adminHost.appendChild(policyLine('Local recovery', 'Auth Manager recovery accounts never become OIDC identities.', admin.localRecoveryEnabled ? 'enabled' : 'disabled', admin.localRecoveryEnabled ? '' : 'warn'));
    adminHost.appendChild(policyLine('Recovery session verification', 'Rotation or disablement invalidates every matching console session.', admin.localRecoveryVerification, ''));
  }

  function loadConfiguration() {
    if (configuration) {
      renderIdentity(configuration);
      renderPolicies(configuration);
      return Promise.resolve(configuration);
    }
    if (loading) return loading;
    loading = api('GET', '/admin/api/identity-configuration')
      .then(function (data) {
        configuration = data;
        renderIdentity(data);
        renderPolicies(data);
        return data;
      })
      .catch(function (error) {
        ['identity-domain', 'identity-endpoint', 'identity-search-base', 'identity-transport',
          'identity-certificate', 'identity-search-mode', 'recovery-account-count'].forEach(function (id) {
          text(id, 'Unavailable');
        });
        ['authentication-policy', 'federation-policy', 'admin-policy'].forEach(function (id) {
          var host = el(id);
          if (!host) return;
          host.removeAttribute('aria-busy');
          host.textContent = 'Configuration unavailable.';
        });
        setStatus(error.message, true);
        throw error;
      })
      .finally(function () { loading = null; });
    return loading;
  }

  document.addEventListener('authmgr:show-identity', function () { loadConfiguration().catch(function () {}); });
  document.addEventListener('authmgr:show-policies', function () { loadConfiguration().catch(function () {}); });
})();

/* ---- Live sign-ins (session control plane, ADR-0014) --------------------- */
(function () {
  var cache = [];
  var aggregates = null;
  var timer = null;

  function deviceLabel(context) {
    if (!context) return '-';
    var known = context.deviceCookieId ? context.deviceCookieId.slice(0, 8) : '';
    var hash = context.deviceId ? String(context.deviceId).slice(0, 10) : '';
    if (known && hash) return known + '-' + hash;
    return known || hash || '-';
  }

  function browserEvidence(context) {
    var ua = String((context && context.userAgent) || '');
    var browser = /Edg\\//.test(ua) ? 'Edge' : /Firefox\\//.test(ua) ? 'Firefox' : /Chrome\\//.test(ua) ? 'Chrome' : /Safari\\//.test(ua) ? 'Safari' : ua ? 'Other browser' : 'Unknown browser';
    var os = /Windows/.test(ua) ? 'Windows' : /Android/.test(ua) ? 'Android' : /iPhone|iPad/.test(ua) ? 'iOS / iPadOS' : /Mac OS X/.test(ua) ? 'macOS' : /Linux/.test(ua) ? 'Linux' : 'Unknown OS';
    var kind = /iPad|Tablet/.test(ua) ? 'Tablet' : /Mobile|Android|iPhone/.test(ua) ? 'Mobile' : 'Desktop';
    return { browser: browser, os: os, kind: kind, label: browser + ' · ' + os + ' · ' + kind };
  }

  function matchesFilters(session) {
    var user = (el('sess-filter-user').value || '').trim().toLowerCase();
    var app = (el('sess-filter-app').value || '').trim().toLowerCase();
    var ip = (el('sess-filter-ip').value || '').trim().toLowerCase();
    var device = (el('sess-filter-device').value || '').trim().toLowerCase();
    var amr = el('sess-filter-amr').value;
    if (user && String(session.accountId || '').toLowerCase().indexOf(user) < 0) return false;
    if (app) {
      var joined = (session.clients || []).join(' ').toLowerCase() +
        ' ' + String((session.context && session.context.clientId) || '').toLowerCase();
      if (joined.indexOf(app) < 0) return false;
    }
    if (ip && String((session.context && session.context.ip) || '').toLowerCase().indexOf(ip) < 0) return false;
    if (device && browserEvidence(session.context).label.toLowerCase().indexOf(device) < 0) return false;
    if (amr && (session.amr || []).indexOf(amr) < 0) return false;
    return true;
  }

  function destroy(scope, target, confirmText) {
    requestImpact({ title: 'End active sign-in sessions', description: confirmText, confirmLabel: 'End sessions', destructive: true, evidence: 'This revokes provider sessions and attempts relying-party logout delivery. Failed logout pushes remain visible as evidence.' }).then(function (decision) {
      if (!decision.confirmed) return;
      return api('POST', '/admin/api/sessions/destroy', { scope: scope, target: target })
      .then(function (result) {
        var message = 'Ended ' + result.destroyed + ' session(s).';
        if (result.failed) {
          message += ' ' + result.failed + ' FAILED - they are still alive.';
        }
        if (result.pushed) {
          message += ' App logout pushes: ' + result.pushed.delivered + ' delivered';
          if (result.pushed.failed) {
            message += ', ' + result.pushed.failed + ' NOT delivered';
          }
          message += '.';
        }
        setStatus(message, Boolean(result.failed || (result.pushed && result.pushed.failed)));
        return loadSessions();
      })
        .catch(function (error) { setStatus(error.message, true); });
    });
  }

  function renderStats() {
    var host = el('sessions-stats');
    host.textContent = '';
    var cards = [
      [aggregates ? aggregates.totalSessions : 0, 'Active sessions'],
      [aggregates ? aggregates.distinctUsers : 0, 'Users signed in'],
      [aggregates ? aggregates.distinctDevices : 0, 'Known devices']
    ];
    cards.forEach(function (entry) {
      var box = document.createElement('div');
      box.className = 'stat';
      var num = document.createElement('div');
      num.className = 'num';
      num.textContent = String(entry[0]);
      var lbl = document.createElement('div');
      lbl.className = 'lbl';
      lbl.textContent = entry[1];
      box.appendChild(num);
      box.appendChild(lbl);
      host.appendChild(box);
    });

    var perClient = (aggregates && aggregates.perClient) || [];
    var stale = document.querySelector('#view-sessions div[data-per-client]');
    if (stale) stale.remove();
    if (perClient.length) {
      var wrap = document.createElement('div');
      wrap.setAttribute('data-per-client', 'true');
      wrap.style.margin = '0 0 .75rem';
      perClient.forEach(function (entry) {
        var chip = document.createElement('span');
        chip.className = 'chip';
        chip.setAttribute('data-client', entry.clientId);
        var name = document.createElement('span');
        name.textContent = entry.clientId + ' ';
        var count = document.createElement('b');
        count.textContent = String(entry.sessions);
        chip.appendChild(name);
        chip.appendChild(count);
        var kill = document.createElement('button');
        kill.type = 'button';
        kill.className = 'secondary mini';
        kill.textContent = 'End all';
        kill.setAttribute('aria-label', 'End all sessions for ' + entry.clientId);
        kill.addEventListener('click', function () {
          destroy('client', entry.clientId,
            'Sign out EVERYONE using ' + entry.clientId + ' right now?');
        });
        chip.appendChild(kill);
        wrap.appendChild(chip);
      });
      host.after(wrap);
    }
  }

  function renderTable() {
    var host = el('sessions-list');
    host.textContent = '';
    var rows = cache.filter(matchesFilters)
      .sort(function (a, b) {
        return new Date(b.loginAt || 0) - new Date(a.loginAt || 0);
      });
    if (!rows.length) {
      var emptyP = document.createElement('p');
      emptyP.className = 'notice';
      emptyP.textContent = 'No active sign-ins match.';
      host.appendChild(emptyP);
      return;
    }

    var table = document.createElement('table');
    table.className = 'data-table';
    var thead = document.createElement('thead');
    var headRow = document.createElement('tr');
    ['User', 'Applications', 'Signed in', 'Expires', 'IP', 'Browser / device', ''].forEach(function (titleText) {
      var th = document.createElement('th');
      th.scope = 'col';
      th.textContent = titleText;
      headRow.appendChild(th);
    });
    thead.appendChild(headRow);
    table.appendChild(thead);

    var tbody = document.createElement('tbody');
    rows.forEach(function (session) {
      var tr = document.createElement('tr');

      var user = document.createElement('td');
      var userName = document.createElement('div');
      userName.style.fontWeight = '600';
      userName.textContent = session.accountId || '(anonymous)';
      var method = document.createElement('div');
      method.className = 'cell-muted';
      method.textContent = (session.amr || []).join('+') || '-';
      user.appendChild(userName);
      user.appendChild(method);

      var apps = document.createElement('td');
      (session.clients || []).forEach(function (clientId) {
        var chip = document.createElement('span');
        chip.className = 'chip';
        chip.textContent = clientId;
        apps.appendChild(chip);
      });
      if (!(session.clients || []).length) apps.textContent = '-';

      var signedIn = document.createElement('td');
      signedIn.textContent = timeAgo(session.loginAt);
      signedIn.title = session.loginAt || '';

      var expires = document.createElement('td');
      expires.textContent = timeAhead(session.expiresAt);

      var ipCell = document.createElement('td');
      ipCell.className = 'mono';
      ipCell.textContent = (session.context && session.context.ip) || '-';

      var device = document.createElement('td');
      device.className = 'cell-muted';
      var ua = (session.context && session.context.userAgent) || '';
      var evidence = browserEvidence(session.context);
      var deviceName = document.createElement('div'); deviceName.textContent = evidence.label; device.appendChild(deviceName);
      var deviceId = document.createElement('div'); deviceId.className = 'mono'; deviceId.textContent = session.context && session.context.deviceCookieId ? 'recognized browser ' + deviceLabel(session.context) : 'new or unavailable evidence'; device.appendChild(deviceId);
      if (ua) device.title = ua;

      var actions = document.createElement('td');
      actions.style.whiteSpace = 'nowrap';
      if (session.accountId) {
        var killUser = document.createElement('button');
        killUser.type = 'button';
        killUser.className = 'secondary mini';
        killUser.style.marginRight = '.35rem';
        killUser.textContent = 'End all for user';
        killUser.addEventListener('click', function () {
          destroy('user', session.accountId,
            'Sign out ' + session.accountId + ' everywhere (all sessions)?');
        });
        actions.appendChild(killUser);
      }
      var killSession = document.createElement('button');
      killSession.type = 'button';
      killSession.className = 'secondary mini';
      killSession.textContent = 'End session';
      killSession.addEventListener('click', function () {
        destroy('sid', session.sid, 'End this single sign-in session?');
      });
      actions.appendChild(killSession);

      [user, apps, signedIn, expires, ipCell, device, actions].forEach(function (cell) {
        tr.appendChild(cell);
      });
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    host.appendChild(table);
  }

  function renderAll() {
    renderStats();
    renderTable();
  }

  function loadSessions() {
    return api('GET', '/admin/api/sessions')
      .then(function (data) {
        cache = data.sessions || [];
        aggregates = data.aggregates || null;
        renderAll();
      })
      .catch(function (error) { setStatus(error.message, true); });
  }

  function stopTimer() {
    if (timer) { clearInterval(timer); timer = null; }
  }
  function restartTimer() {
    stopTimer();
    if (el('sess-autorefresh').checked) {
      timer = setInterval(loadSessions, 30000);
    }
  }

  el('btn-sess-refresh').addEventListener('click', function () { loadSessions(); });
  ['sess-filter-user', 'sess-filter-app', 'sess-filter-ip', 'sess-filter-device'].forEach(function (id) {
    el(id).addEventListener('input', renderTable);
  });
  el('sess-filter-amr').addEventListener('change', renderTable);
  el('sess-autorefresh').addEventListener('change', restartTimer);
  document.addEventListener('authmgr:show-sessions', function () {
    loadSessions();
    restartTimer();
  });
})();

/* ---- Directory users ------------------------------------------------------ */
(function () {
  function chipRow(host, text, cls) {
    var chip = document.createElement('span');
    chip.className = 'chip' + (cls ? ' ' + cls : '');
    chip.textContent = text;
    host.appendChild(chip);
    return chip;
  }

  function renderResults(users) {
    var host = el('users-results');
    host.textContent = '';
    if (!users.length) {
      var p = document.createElement('p');
      p.className = 'notice';
      p.textContent = 'No directory entries match. At least two characters required.';
      host.appendChild(p);
      return;
    }
    var table = document.createElement('table');
    table.className = 'data-table';
    var thead = document.createElement('thead');
    var headRow = document.createElement('tr');
    ['User', 'Display name', 'Email', 'State', ''].forEach(function (t) {
      var th = document.createElement('th');
      th.scope = 'col';
      th.textContent = t;
      headRow.appendChild(th);
    });
    thead.appendChild(headRow);
    table.appendChild(thead);
    var tbody = document.createElement('tbody');
    users.forEach(function (user) {
      var tr = document.createElement('tr');
      var td = function (text, cls) {
        var cell = document.createElement('td');
        if (cls) cell.className = cls;
        cell.textContent = text || '-';
        tr.appendChild(cell);
        return cell;
      };
      td(user.username, 'mono');
      td(user.displayName);
      td(user.mail);
      var state = document.createElement('td');
      if (user.disabled) chipRow(state, 'disabled', 'danger');
      if (user.lockedOut) chipRow(state, 'locked out', 'danger');
      if (!user.disabled && !user.lockedOut) chipRow(state, 'active', 'ok');
      tr.appendChild(state);
      var actions = document.createElement('td');
      var view = document.createElement('button');
      view.type = 'button';
      view.className = 'secondary mini';
      view.textContent = 'Details';
      view.addEventListener('click', function () { loadUser(user.username); });
      actions.appendChild(view);
      tr.appendChild(actions);
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    host.appendChild(table);
  }

  function renderDetail(payload) {
    var host = el('user-detail');
    host.textContent = '';
    host.hidden = false;
    var user = payload.user;
    var h = document.createElement('h2');
    h.textContent = user.username + (user.displayName ? ' - ' + user.displayName : '');
    host.appendChild(h);
    var meta = document.createElement('div');
    chipRow(meta, user.disabled ? 'DISABLED' : 'enabled', user.disabled ? 'danger' : 'ok');
    if (user.lockedOut) chipRow(meta, 'LOCKED OUT', 'danger');
    if (user.mail) chipRow(meta, user.mail);
    if (user.groupCount) chipRow(meta, user.groupCount + ' group(s)');
    host.appendChild(meta);

    if (user.groups && user.groups.length) {
      var gh = document.createElement('label');
      gh.textContent = 'Groups (first ' + user.groups.length + ')';
      host.appendChild(gh);
      var groups = document.createElement('div');
      user.groups.forEach(function (g) { chipRow(groups, g); });
      host.appendChild(groups);
    }

    var sh = document.createElement('label');
    sh.textContent = 'Recent sign-in activity';
    sh.style.marginTop = '.9rem';
    host.appendChild(sh);
    var signIns = payload.signIns || [];
    if (!signIns.length) {
      var none = document.createElement('p');
      none.className = 'notice';
      none.textContent = 'No recorded sign-in events.';
      host.appendChild(none);
      return;
    }
    var table = document.createElement('table');
    table.className = 'data-table';
    var thead = document.createElement('thead');
    var headRow = document.createElement('tr');
    ['When', 'Event', 'Outcome', 'IP'].forEach(function (t) {
      var th = document.createElement('th');
      th.scope = 'col';
      th.textContent = t;
      headRow.appendChild(th);
    });
    thead.appendChild(headRow);
    table.appendChild(thead);
    var tbody = document.createElement('tbody');
    signIns.forEach(function (row) {
      var tr = document.createElement('tr');
      var when = document.createElement('td');
      when.textContent = fmtWhen(row.createdAt);
      var action = document.createElement('td');
      action.textContent = row.action;
      var outcome = document.createElement('td');
      outcome.textContent = row.outcome || (row.success ? 'success' : 'failure');
      var ip = document.createElement('td');
      ip.className = 'mono';
      ip.textContent = row.ip || '-';
      tr.appendChild(when); tr.appendChild(action); tr.appendChild(outcome); tr.appendChild(ip);
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    host.appendChild(table);
  }

  function loadUser(username) {
    api('GET', '/admin/api/users/' + encodeURIComponent(username))
      .then(renderDetail)
      .catch(function (error) { setStatus(error.message, true); });
  }

  function runSearch() {
    var query = (el('user-query').value || '').trim();
    if (query.length < 2) {
      setStatus('Type at least two characters to search the directory.', true);
      return;
    }
    api('GET', '/admin/api/users?q=' + encodeURIComponent(query))
      .then(function (data) { renderResults(data.users || []); })
      .catch(function (error) { setStatus(error.message, true); });
  }
  el('btn-user-search').addEventListener('click', runSearch);
  el('user-query').addEventListener('keydown', function (event) {
    if (event.key === 'Enter') { event.preventDefault(); runSearch(); }
  });

  function rotateRecovery(account, reload, rotatesCurrentSession) {
    requestImpact({
      title: 'Rotate recovery password',
      description: 'Every current Auth Manager session for ' + account.username + ' will stop on its next request.',
      evidence: 'The credential version and audit trail record this rotation.',
      confirmLabel: 'Rotate password',
      inputLabel: 'New password (at least 16 characters)',
      inputType: 'password',
      inputRequired: true
    }).then(function (result) {
      if (!result.confirmed) return;
      return api('PATCH', '/admin/api/recovery-accounts/' + encodeURIComponent(account.id), {
        action: 'rotate_password', password: result.value
      }).then(function () {
        if (rotatesCurrentSession) { window.location.href = '/admin'; return; }
        setStatus('Recovery password rotated. Existing sessions are invalid.');
        return reload();
      });
    }).catch(function (error) { setStatus(error.message, true); });
  }

  function loadRecoveryAccounts() {
    return api('GET', '/admin/api/recovery-accounts')
      .then(function (data) {
        var host = el('recovery-accounts');
        var form = el('recovery-form');
        host.textContent = '';
        form.hidden = !data.enabled || !data.capabilities.manageRoster;
        var accounts = data.accounts || [];
        if (!accounts.length) {
          var p = document.createElement('p');
          p.className = 'notice';
          p.textContent = data.enabled
            ? 'No Auth Manager recovery accounts exist.'
            : 'Local recovery is disabled by deployment configuration.';
          host.appendChild(p);
          return;
        }
        accounts.forEach(function (account) {
          var row = document.createElement('div');
          row.className = 'block-row';
          var label = document.createElement('div');
          label.className = 'label';
          var title = document.createElement('div');
          title.className = 'title';
          title.textContent = account.username;
          var hint = document.createElement('div');
          hint.className = 'hint';
          hint.textContent = 'password changed ' + fmtWhen(account.passwordChangedAt) +
            (account.lastUsedAt ? ', last used ' + timeAgo(account.lastUsedAt) : ', never used');
          label.appendChild(title); label.appendChild(hint); row.appendChild(label);
          chipRow(row, account.isActive ? 'active' : 'inactive', account.isActive ? 'ok' : 'danger');

          var mayRotate = data.capabilities.manageRoster || data.capabilities.ownAccountId === account.id;
          if (mayRotate) {
            var rotate = document.createElement('button');
            rotate.type = 'button'; rotate.className = 'secondary mini'; rotate.textContent = 'Rotate password';
            rotate.addEventListener('click', function () {
              rotateRecovery(account, loadRecoveryAccounts, data.capabilities.ownAccountId === account.id);
            });
            row.appendChild(rotate);
          }
          if (data.capabilities.manageRoster) {
            var toggle = document.createElement('button');
            toggle.type = 'button'; toggle.className = account.isActive ? 'danger mini' : 'secondary mini';
            toggle.textContent = account.isActive ? 'Disable' : 'Enable';
            toggle.addEventListener('click', function () {
              requestImpact({
                title: (account.isActive ? 'Disable ' : 'Enable ') + account.username,
                description: account.isActive
                  ? 'This account and all of its current Auth Manager sessions will stop working.'
                  : 'This account will be allowed to sign in to Auth Manager.',
                confirmLabel: account.isActive ? 'Disable account' : 'Enable account',
                destructive: account.isActive
              }).then(function (result) {
                if (!result.confirmed) return;
                return api('PATCH', '/admin/api/recovery-accounts/' + encodeURIComponent(account.id), {
                  action: 'set_active', active: !account.isActive
                }).then(function () { setStatus(account.isActive ? 'Recovery account disabled.' : 'Recovery account enabled.'); return loadRecoveryAccounts(); });
              }).catch(function (error) { setStatus(error.message, true); });
            });
            row.appendChild(toggle);
          }
          host.appendChild(row);
        });
      })
      .catch(function (error) { setStatus(error.message, true); });
  }

  el('recovery-form').addEventListener('submit', function (event) {
    event.preventDefault();
    api('POST', '/admin/api/recovery-accounts', {
      username: el('recovery-username').value,
      password: el('recovery-password').value
    }).then(function () {
      el('recovery-password').value = '';
      setStatus('Recovery account created.');
      return loadRecoveryAccounts();
    }).catch(function (error) { setStatus(error.message, true); });
  });
  document.addEventListener('authmgr:show-users', function () {
    loadRecoveryAccounts();
  });
})();

/* ---- Applications (client registry + setup guides) ------------------------ */
(function () {
  var ttlBounds = { min: 300, max: 1209600 };
  var issuer = '';
  var GUIDES = {
    proxmox: {
      title: 'Proxmox VE (OIDC realm)',
      matches: function (name, clientId) { return /proxmox|pve/i.test(name + ' ' + clientId); },
      steps: [
        'Datacenter -> Permissions -> Realms -> Add -> OpenID Connect Server.',
        'Issuer URL: the discovery base shown below (no path).',
        'Client ID: the application ID shown on this card.',
        'Client Key: the secret issued at registration (rotate to re-show).',
        'Scopes: openid email profile groups (groups enables role mapping).',
        'Enable "Autocreate users" so first sign-ins provision PVE users.',
        'Username claim: preferred_username (the AD sAMAccountName) - matches existing PVE users 1:1.',
        'Group mapping (PVE 8.2+): the groups claim carries AD group CNs; create PVE groups with matching names and assign roles to them.',
        'Enable the realm and use realm login at the PVE UI; sign-out at the Auth Manager ends PVE sessions via back-channel logout.'
      ]
    }
  };
  function genericGuide() {
    return {
      title: 'Any OIDC relying party',
      steps: [
        'Discovery: point your app at the discovery URL below.',
        'Client authentication: client_secret_basic (HTTP Basic).',
        'PKCE: REQUIRED for every client, confidential included.',
        'Grant: authorization code only; response type code.',
        'Scopes: openid email profile (add groups to receive AD group CNs in tokens).',
        'Back-channel logout: register your logout endpoint; sessions ended here push a signed logout to each app.',
        'Redirect URIs must be exact https URLs (loopback http allowed for local dev).'
      ]
    };
  }

  function applyTtlBounds(bounds) {
    if (bounds && Number.isFinite(bounds.min) && Number.isFinite(bounds.max) && bounds.max > 0) {
      ttlBounds = { min: bounds.min, max: bounds.max };
      var input = el('client-ttl');
      if (input) {
        input.setAttribute('min', String(ttlBounds.min));
        input.setAttribute('max', String(ttlBounds.max));
      }
    }
  }

  function appendGuide(card, clientId) {
    var known = null;
    Object.keys(GUIDES).forEach(function (key) {
      if (!known && GUIDES[key].matches(card.getAttribute('data-name') || '', clientId)) known = GUIDES[key];
    });
    var guide = known || genericGuide();
    var box = document.createElement('div');
    box.className = 'guide';
    var head = document.createElement('div');
    head.style.display = 'flex';
    head.style.justifyContent = 'space-between';
    head.style.alignItems = 'center';
    var title = document.createElement('b');
    title.textContent = 'Setup guide: ' + guide.title;
    head.appendChild(title);
    var toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = 'secondary mini';
    toggle.textContent = 'Show';
    toggle.setAttribute('aria-expanded', 'false');
    head.appendChild(toggle);
    box.appendChild(head);
    var body = document.createElement('div');
    body.hidden = true;
    var ol = document.createElement('ol');
    guide.steps.forEach(function (step) {
      var li = document.createElement('li');
      li.textContent = step;
      ol.appendChild(li);
    });
    body.appendChild(ol);
    var disc = document.createElement('p');
    disc.className = 'notice mono';
    disc.textContent = 'Discovery: ' + issuer + '/.well-known/openid-configuration';
    body.appendChild(disc);
    box.appendChild(body);
    toggle.addEventListener('click', function () {
      body.hidden = !body.hidden;
      toggle.textContent = body.hidden ? 'Show' : 'Hide';
      toggle.setAttribute('aria-expanded', body.hidden ? 'false' : 'true');
    });
    card.appendChild(box);
  }

  var secretTimer = null;
  var secretValue = '';
  var secretHost = null;

  function clearNewSecret() {
    if (secretTimer) { clearTimeout(secretTimer); secretTimer = null; }
    secretValue = '';
    if (secretHost) secretHost.textContent = '';
    secretHost = null;
  }

  function showNewSecret(host, clientId, value, mirrorPending) {
    clearNewSecret();
    secretHost = host;
    secretValue = value;
    var notice = document.createElement('div');
    notice.className = 'guide secret-result';
    var copy = document.createElement('button');
    copy.type = 'button'; copy.className = 'secondary mini'; copy.textContent = 'Copy secret';
    copy.setAttribute('aria-label', 'Copy the new secret for ' + clientId);
    var reveal = document.createElement('button');
    reveal.type = 'button'; reveal.className = 'secondary mini'; reveal.textContent = 'Reveal';
    var valueLine = document.createElement('code');
    valueLine.className = 'secret-value'; valueLine.textContent = '••••••••••••••••';
    var detail = document.createElement('p');
    detail.className = 'notice';
    detail.textContent = 'Update ' + clientId + ' now. This value is shown once and clears in 60 seconds.' +
      (mirrorPending ? ' Provider sync is pending.' : '');
    copy.addEventListener('click', function () {
      if (!secretValue || !navigator.clipboard || !navigator.clipboard.writeText) {
        setStatus('Copy is unavailable. Reveal the secret and copy it manually before it clears.', true);
        return;
      }
      copy.disabled = true;
      navigator.clipboard.writeText(secretValue)
        .then(function () { copy.textContent = 'Copied'; })
        .catch(function () { setStatus('Copy failed. Reveal the secret and copy it manually before it clears.', true); })
        .then(function () { if (secretValue) copy.disabled = false; });
    });
    reveal.addEventListener('click', function () {
      if (!secretValue) return;
      var visible = valueLine.textContent === secretValue;
      valueLine.textContent = visible ? '••••••••••••••••' : secretValue;
      reveal.textContent = visible ? 'Reveal' : 'Hide';
    });
    notice.appendChild(copy); notice.appendChild(reveal); notice.appendChild(valueLine); notice.appendChild(detail);
    host.appendChild(notice);
    secretTimer = setTimeout(function () {
      if (secretHost === host) clearNewSecret();
    }, 60 * 1000);
  }

  function requestSecretRotation(card, client, rotateButton, secretOut) {
    clearNewSecret();
    secretHost = secretOut;
    var prompt = document.createElement('div');
    prompt.className = 'guide secret-rotation';
    var detail = document.createElement('p');
    detail.className = 'notice';
    detail.textContent = 'Rotating this secret immediately invalidates the current credential for ' + client.clientId + '. Update the application before continuing.';
    var confirm = document.createElement('button');
    confirm.type = 'button'; confirm.textContent = 'Rotate secret now';
    var cancel = document.createElement('button');
    cancel.type = 'button'; cancel.className = 'secondary'; cancel.textContent = 'Cancel';
    cancel.addEventListener('click', clearNewSecret);
    confirm.addEventListener('click', function () {
      confirm.disabled = true;
      rotateButton.disabled = true;
      confirm.textContent = 'Rotating…';
      api('PATCH', '/admin/api/registry/' + encodeURIComponent(client.clientId), { rotateSecret: true })
        .then(function (data) {
          if (!data || typeof data.clientSecret !== 'string' || !data.clientSecret) {
            throw new Error('The new secret was not returned. Refresh this application before retrying.');
          }
          showNewSecret(secretOut, client.clientId, data.clientSecret, data.mirrorPending === true);
          setStatus(data.mirrorPending
            ? 'Secret rotated. Copy it and update the application; provider sync is pending.'
            : 'Secret rotated. Copy it and update the application now.', data.mirrorPending === true);
        })
        .catch(function (error) {
          clearNewSecret();
          var failure = document.createElement('p');
          failure.className = 'error';
          failure.textContent = 'Could not confirm secret rotation. Refresh this application before retrying.';
          secretOut.appendChild(failure);
          setStatus(error.message || 'Could not confirm secret rotation.', true);
        })
        .then(function () { rotateButton.disabled = false; });
    });
    prompt.appendChild(detail); prompt.appendChild(confirm); prompt.appendChild(cancel);
    secretOut.appendChild(prompt);
  }

  document.addEventListener('authmgr:view-change', function (event) {
    if (!event.detail || event.detail.name !== 'clients') clearNewSecret();
  });

  function loadClients() {
    clearNewSecret();
    api('GET', '/admin/api/session')
      .then(function (session) { issuer = session.issuer || ''; return api('GET', '/admin/api/registry'); })
      .then(function (data) {
        applyTtlBounds(data.ttlBounds);
        var list = el('clients-list');
        list.textContent = '';
        var rows = data.clients || [];
        if (!rows.length) {
          var p = document.createElement('p');
          p.className = 'notice';
          p.textContent = 'No additional applications registered.';
          list.appendChild(p);
          return;
        }
        rows.forEach(function (client) {
          var card = document.createElement('div');
          card.className = 'panel';
          card.setAttribute('data-client', client.clientId);
          card.setAttribute('data-name', client.name);
          card.setAttribute('data-ttl', String(client.sessionTtlSeconds || ''));
          var title = document.createElement('h3');
          title.textContent = client.name;
          if (!client.enabled) {
            var badge = document.createElement('span');
            badge.className = 'badge';
            badge.textContent = 'disabled';
            title.appendChild(document.createTextNode(' '));
            title.appendChild(badge);
          }
          card.appendChild(title);
          var idLine = document.createElement('div');
          idLine.className = 'notice mono';
          idLine.textContent = client.clientId;
          card.appendChild(idLine);
          var uris = document.createElement('div');
          uris.className = 'notice';
          uris.textContent = (client.redirectUris || []).join(' - ');
          card.appendChild(uris);
          var scopes = document.createElement('div');
          scopes.className = 'notice';
          scopes.textContent = 'scopes: ';
          var code = document.createElement('code');
          code.textContent = client.scope;
          scopes.appendChild(code);
          card.appendChild(scopes);
          var ttl = document.createElement('div');
          ttl.className = 'notice';
          ttl.textContent = 'session ttl: ' + (client.sessionTtlSeconds ? client.sessionTtlSeconds + 's' : 'default') + ' - effective max ' + ttlBounds.max + 's';
          card.appendChild(ttl);
          var actions = document.createElement('div');
          actions.style.cssText = 'display:flex;gap:.5rem;margin-top:.5rem;flex-wrap:wrap';
          var mkBtn = function (label, act) {
            var b = document.createElement('button');
            b.type = 'button';
            b.className = 'secondary';
            b.textContent = label;
            b.setAttribute('data-act', act);
            actions.appendChild(b);
            return b;
          };
          mkBtn('Rotate secret', 'rotate');
          var toggleBtn = mkBtn(client.enabled ? 'Disable' : 'Enable', 'toggle');
          mkBtn('Set session TTL', 'ttl');
          mkBtn('Remove', 'delete');
          card.appendChild(actions);
          var secretOut = document.createElement('div');
          secretOut.className = 'notice';
          secretOut.setAttribute('aria-live', 'polite');
          card.appendChild(secretOut);
          appendGuide(card, client.clientId);
          list.appendChild(card);

          card.querySelector('[data-act="rotate"]').addEventListener('click', function () {
            requestSecretRotation(card, client, card.querySelector('[data-act="rotate"]'), secretOut);
          });
          toggleBtn.addEventListener('click', function () {
            var enable = toggleBtn.textContent === 'Enable';
            api('PATCH', '/admin/api/registry/' + encodeURIComponent(client.clientId), { enabled: enable })
              .then(function (data) {
                return loadClients().then(function () { return data; });
              })
              .then(function (data) {
                setStatus((enable ? 'Enabled ' : 'Disabled ') + client.clientId +
                  (data.client && data.client.mirrorPending ? ' Provider sync is pending.' : '.'),
                  Boolean(data.client && data.client.mirrorPending));
              })
              .catch(function (error) { setStatus(error.message, true); });
          });
          card.querySelector('[data-act="ttl"]').addEventListener('click', function () {
            requestImpact({ title: 'Change session lifetime', description: 'Update the maximum provider-session lifetime for ' + client.clientId + '. Existing sessions are not extended.', inputLabel: 'Lifetime in seconds (' + ttlBounds.min + '-' + ttlBounds.max + ', empty uses the default)', defaultValue: card.getAttribute('data-ttl') || '', confirmLabel: 'Save lifetime' }).then(function (decision) {
              if (!decision.confirmed) return;
              var raw = String(decision.value || '');
              var bodyValue = raw.trim() === '' ? null : parseInt(raw.trim(), 10);
              return api('PATCH', '/admin/api/registry/' + encodeURIComponent(client.clientId), { sessionTtlSeconds: bodyValue })
                .then(loadClients)
                .catch(function (error) { setStatus(error.message, true); });
            });
          });
          card.querySelector('[data-act="delete"]').addEventListener('click', function () {
            requestImpact({ title: 'Remove OIDC application', description: 'Remove ' + client.clientId + '. New authorization requests will fail and the client secret cannot be recovered from the UI.', confirmLabel: 'Remove application', destructive: true, evidence: 'Removal is durably audited. Reversal requires registering the client again and distributing a new secret.' }).then(function (decision) {
              if (!decision.confirmed) return;
              return api('DELETE', '/admin/api/registry/' + encodeURIComponent(client.clientId))
                .then(loadClients)
                .then(function () { setStatus('Removed ' + client.clientId + '.'); })
                .catch(function (error) { setStatus(error.message, true); });
            });
          });
        });
      })
      .catch(function (error) { setStatus(error.message, true); });
  }

  el('client-form').addEventListener('submit', function (event) {
    event.preventDefault();
    var uris = el('client-uris').value.split(/[\\n,]+/).map(function (u) { return u.trim(); }).filter(Boolean);
    var postLogoutUris = el('client-post-logout').value.split(/[\\n,]+/).map(function (u) { return u.trim(); }).filter(Boolean);
    var ttlRaw = el('client-ttl').value.trim();
    var selectedScopes = ['openid'];
    Array.prototype.forEach.call(document.querySelectorAll('input[name="client-scope"]:checked'), function (box) {
      if (selectedScopes.indexOf(box.value) < 0) selectedScopes.push(box.value);
    });
    var payload = {
      name: el('client-name').value.trim(), redirectUris: uris,
      postLogoutRedirectUris: postLogoutUris,
      backchannelLogoutUri: el('client-backchannel').value.trim() || null,
      scope: selectedScopes.join(' ')
    };
    if (ttlRaw !== '') {
      payload.sessionTtlSeconds = parseInt(ttlRaw, 10);
      if (!Number.isFinite(payload.sessionTtlSeconds)) {
        setStatus('Session TTL must be a number of seconds.', true);
        return;
      }
    }
    api('POST', '/admin/api/registry', payload)
      .then(function (data) {
        el('client-form').reset();
        setStatus('Registered ' + data.client.clientId +
          (data.mirrorPending ? ' Provider sync is pending.' : '.'), data.mirrorPending === true);
        return loadClients().then(function () {
          var cards = el('clients-list').querySelectorAll('[data-client]');
          Array.prototype.forEach.call(cards, function (card) {
            if (card.getAttribute('data-client') === data.client.clientId) {
              var out = card.querySelector('.notice:last-of-type');
              if (out) out.textContent = 'Secret (copy now): ' + data.clientSecret;
            }
          });
        });
      })
      .catch(function (error) { setStatus(error.message, true); });
  });

  document.addEventListener('authmgr:show-clients', function () {
    loadClients();
  });
})();

/* ---- Public application directory ---------------------------------------- */
(function () {
  var entries = [];

  function resetForm() {
    el('catalog-form').reset();
    el('catalog-id').value = '';
    el('catalog-sort').value = '0';
    el('btn-catalog-cancel').hidden = true;
  }

  function renderCatalog() {
    var host = el('catalog-list'); host.textContent = '';
    if (!entries.length) {
      var empty = document.createElement('p'); empty.className = 'notice'; empty.textContent = 'No directory entries yet.'; host.appendChild(empty); return;
    }
    entries.forEach(function (entry) {
      var row = document.createElement('div'); row.className = 'block-row';
      var label = document.createElement('div'); label.className = 'label';
      var title = document.createElement('div'); title.className = 'title'; title.textContent = entry.name;
      var hint = document.createElement('div'); hint.className = 'hint'; hint.textContent = entry.launchUrl + ' · ' + entry.kind;
      label.appendChild(title); label.appendChild(hint); row.appendChild(label);
      var state = document.createElement('span'); state.className = 'badge ' + (entry.visibility === 'public' ? 'ok' : ''); state.textContent = entry.visibility; row.appendChild(state);
      var edit = document.createElement('button'); edit.type = 'button'; edit.className = 'secondary mini'; edit.textContent = 'Edit';
      var remove = document.createElement('button'); remove.type = 'button'; remove.className = 'secondary mini'; remove.textContent = 'Remove';
      row.appendChild(edit); row.appendChild(remove); host.appendChild(row);
      edit.addEventListener('click', function () {
        el('catalog-id').value = entry.id; el('catalog-name').value = entry.name; el('catalog-slug').value = entry.slug;
        el('catalog-description').value = entry.description || ''; el('catalog-url').value = entry.launchUrl;
        el('catalog-kind').value = entry.kind; el('catalog-client').value = entry.oidcClientId || '';
        el('catalog-visibility').value = entry.visibility; el('catalog-sort').value = String(entry.sortOrder || 0);
        el('btn-catalog-cancel').hidden = false; el('catalog-name').focus();
      });
      remove.addEventListener('click', function () {
        requestImpact({ title: 'Remove application directory entry', description: 'Remove the public directory entry for ' + entry.name + '. This does not delete its OIDC registration.', confirmLabel: 'Remove entry', destructive: true, evidence: 'The directory change is audited and can be reversed by creating a new curated entry.' }).then(function (decision) {
          if (!decision.confirmed) return;
          return api('DELETE', '/admin/api/catalog/' + encodeURIComponent(entry.id)).then(loadCatalog).catch(function (error) { setStatus(error.message, true); });
        });
      });
    });
  }

  function loadCatalog() {
    return Promise.all([api('GET', '/admin/api/catalog'), api('GET', '/admin/api/registry')]).then(function (results) {
      entries = results[0].entries || [];
      var select = el('catalog-client'); var current = select.value; select.textContent = '';
      var none = document.createElement('option'); none.value = ''; none.textContent = 'None'; select.appendChild(none);
      (results[1].clients || []).forEach(function (client) { var option = document.createElement('option'); option.value = client.clientId; option.textContent = client.name; select.appendChild(option); });
      select.value = current;
      renderCatalog();
    }).catch(function (error) { setStatus(error.message, true); });
  }

  el('catalog-form').addEventListener('submit', function (event) {
    event.preventDefault();
    var id = el('catalog-id').value;
    var body = {
      name: el('catalog-name').value.trim(), slug: el('catalog-slug').value.trim(),
      description: el('catalog-description').value.trim(), launchUrl: el('catalog-url').value.trim(),
      kind: el('catalog-kind').value, oidcClientId: el('catalog-client').value || null,
      visibility: el('catalog-visibility').value, sortOrder: parseInt(el('catalog-sort').value, 10) || 0
    };
    api(id ? 'PATCH' : 'POST', id ? '/admin/api/catalog/' + encodeURIComponent(id) : '/admin/api/catalog', body)
      .then(function () { resetForm(); setStatus(id ? 'Directory entry updated.' : 'Directory entry created.'); return loadCatalog(); })
      .catch(function (error) { setStatus(error.message, true); });
  });
  el('catalog-kind').addEventListener('change', function () {
    if (el('catalog-kind').value === 'external') el('catalog-client').value = '';
  });
  el('btn-catalog-cancel').addEventListener('click', resetForm);
  document.addEventListener('authmgr:show-clients', loadCatalog);
})();

/* ---- Audit trail ----------------------------------------------------------- */
(function () {
  var nextCursor = null;
  var cached = [];

  function filters() {
    var values = {
      q: el('audit-query').value.trim(),
      username: el('audit-user').value.trim(),
      action: el('audit-action').value.trim(),
      ip: el('audit-ip').value.trim(),
      outcome: el('audit-outcome').value,
      riskLevel: el('audit-risk').value,
      from: el('audit-from').value ? new Date(el('audit-from').value).toISOString() : '',
      to: el('audit-to').value ? new Date(el('audit-to').value).toISOString() : ''
    };
    return values;
  }

  function queryString(cursor) {
    var params = new URLSearchParams();
    var current = filters();
    Object.keys(current).forEach(function (key) { if (current[key]) params.set(key, current[key]); });
    params.set('limit', '100');
    if (cursor) params.set('cursor', cursor);
    return params.toString();
  }

  function renderAudit() {
    var host = el('audit-list');
    host.textContent = '';
    if (!cached.length) {
      var p = document.createElement('p');
      p.className = 'notice';
      p.textContent = 'No audit events match these filters.';
      host.appendChild(p);
      el('btn-audit-more').hidden = true;
      return;
    }
    var table = document.createElement('table');
    table.className = 'data-table';
    var thead = document.createElement('thead');
    var headRow = document.createElement('tr');
    ['When', 'Action', 'User / subject', 'Source', 'Outcome', 'Risk', ''].forEach(function (title) {
      var th = document.createElement('th'); th.scope = 'col'; th.textContent = title; headRow.appendChild(th);
    });
    thead.appendChild(headRow); table.appendChild(thead);
    var tbody = document.createElement('tbody');
    cached.forEach(function (row) {
      var tr = document.createElement('tr');
      if (row.riskLevel === 'high') tr.className = 'audit-risk-high';
      else if (row.riskLevel === 'medium') tr.className = 'audit-risk-medium';
      var when = document.createElement('td'); when.className = 'mono'; when.textContent = fmtWhen(row.createdAt);
      var action = document.createElement('td'); action.textContent = row.action;
      var user = document.createElement('td'); user.textContent = row.username || '-';
      if (row.subjectUsername && row.subjectUsername !== row.username) {
        var subject = document.createElement('div'); subject.className = 'cell-muted'; subject.textContent = 'subject: ' + row.subjectUsername; user.appendChild(subject);
      }
      var source = document.createElement('td'); source.className = 'cell-muted'; source.textContent = row.ipAddress || row.clientId || row.actorType || '-';
      var outcome = document.createElement('td'); outcome.textContent = row.outcome || (row.success ? 'success' : 'failure');
      var risk = document.createElement('td'); risk.textContent = row.riskLevel || '-';
      var actions = document.createElement('td');
      var details = document.createElement('button'); details.type = 'button'; details.className = 'secondary mini'; details.textContent = 'Details';
      actions.appendChild(details);
      [when, action, user, source, outcome, risk, actions].forEach(function (cell) { tr.appendChild(cell); });
      tbody.appendChild(tr);
      var detailRow = document.createElement('tr'); detailRow.hidden = true;
      var detailCell = document.createElement('td'); detailCell.colSpan = 7; detailCell.className = 'audit-detail';
      detailCell.textContent = JSON.stringify({
        id: row.id, category: row.category, eventKind: row.eventKind, actorType: row.actorType,
        targetId: row.targetId, clientId: row.clientId, providerSid: row.providerSid,
        ipAddress: row.ipAddress, userAgent: row.userAgent, details: row.details
      }, null, 2);
      detailRow.appendChild(detailCell); tbody.appendChild(detailRow);
      details.addEventListener('click', function () {
        detailRow.hidden = !detailRow.hidden;
        details.textContent = detailRow.hidden ? 'Details' : 'Hide';
      });
    });
    table.appendChild(tbody); host.appendChild(table);
    el('btn-audit-more').hidden = !nextCursor;
  }

  function loadAudit(append) {
    var cursor = append ? nextCursor : null;
    if (!append) { cached = []; nextCursor = null; }
    api('GET', '/admin/api/audit?' + queryString(cursor))
      .then(function (data) {
        cached = cached.concat(data.events || []);
        nextCursor = data.nextCursor || null;
        renderAudit();
      })
      .catch(function (error) { setStatus(error.message, true); });
  }

  function exportAudit(format) {
    fetch('/admin/api/audit/export', {
      method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ format: format, filters: filters() })
    }).then(function (response) {
      if (!response.ok) return response.json().then(function (data) { throw new Error(data.detail || data.error || 'Export failed'); });
      return response.blob().then(function (blob) {
        var url = URL.createObjectURL(blob); var link = document.createElement('a');
        link.href = url; link.download = 'cal-poly-soc-idp-audit.' + (format === 'csv' ? 'csv' : 'ndjson');
        document.body.appendChild(link); link.click(); link.remove(); URL.revokeObjectURL(url);
      });
    }).catch(function (error) { setStatus(error.message, true); });
  }

  el('btn-audit-refresh').addEventListener('click', function () { loadAudit(false); });
  el('btn-audit-more').addEventListener('click', function () { if (nextCursor) loadAudit(true); });
  el('btn-audit-csv').addEventListener('click', function () { exportAudit('csv'); });
  el('btn-audit-ndjson').addEventListener('click', function () { exportAudit('ndjson'); });
  document.addEventListener('authmgr:show-audit', function () { loadAudit(false); });
})();

/* ---- Sign-in appearance (branding editor) ---------------------------------- */
(function () {
  var THEME_FIELDS = [
    ['pageBackground', 'Page background', '#ffffff'],
    ['cardBackground', 'Card background', '#ffffff'],
    ['borderColor', 'Borders', '#e4e4e7'],
    ['textColor', 'Text', '#09090b'],
    ['mutedTextColor', 'Muted text', '#71717a'],
    ['accentColor', 'Accent', '#18181b'],
    ['accentText', 'Accent text', '#fafafa']
  ];
  var PALETTE = [
    ['logo', 'Logo'],
    ['heading', 'Heading'],
    ['markdown', 'Text (Markdown)'],
    ['divider', 'Divider'],
    ['footer', 'Footer note']
  ];
  var BLOCK_LABELS = {
    logo: 'Logo', heading: 'Heading', markdown: 'Text (Markdown)',
    loginForm: 'Sign-in Form', divider: 'Divider', footer: 'Footer note'
  };

  var state = { clients: [], profiles: [], current: 'default', doc: null, selected: null };
  var previewTimer = null;
  var CONTRAST_DEFAULTS = {
    light: { cardBackground: '#ffffff', textColor: '#09090b', mutedTextColor: '#71717a', accentColor: '#18181b', accentText: '#fafafa' },
    dark: { cardBackground: '#09090b', textColor: '#fafafa', mutedTextColor: '#a1a1aa', accentColor: '#fafafa', accentText: '#09090b' }
  };

  function expandHex(value) {
    return value.length === 4 ? '#' + value[1] + value[1] + value[2] + value[2] + value[3] + value[3] : value;
  }
  function contrastRatio(foreground, background) {
    var luminance = function (value) {
      var hex = expandHex(value).slice(1);
      var channels = [0, 2, 4].map(function (offset) {
        var channel = parseInt(hex.slice(offset, offset + 2), 16) / 255;
        return channel <= 0.04045 ? channel / 12.92 : Math.pow((channel + 0.055) / 1.055, 2.4);
      });
      return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
    };
    var a = luminance(foreground), b = luminance(background);
    return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
  }
  function contrastWarnings() {
    var theme = state.doc.theme || {};
    var warnings = [];
    ['light', 'dark'].forEach(function (mode) {
      var defaults = CONTRAST_DEFAULTS[mode];
      var card = theme.cardBackground || defaults.cardBackground;
      [
        ['Text', theme.textColor || defaults.textColor, card],
        ['Muted text', theme.mutedTextColor || defaults.mutedTextColor, card],
        ['Accent text', theme.accentText || defaults.accentText, theme.accentColor || defaults.accentColor]
      ].forEach(function (pair) {
        var ratio = contrastRatio(pair[1], pair[2]);
        if (ratio < 4.5) warnings.push(pair[0] + ' is ' + ratio.toFixed(2) + ':1 in ' + mode + ' mode. At least 4.5:1 is required.');
      });
    });
    return warnings;
  }
  function renderContrastNotice(host) {
    var existing = host.querySelector('[data-contrast-notice]');
    if (existing) existing.remove();
    var notice = document.createElement('p');
    notice.setAttribute('data-contrast-notice', 'true');
    var warnings = contrastWarnings();
    if (warnings.length) {
      notice.className = 'error'; notice.setAttribute('role', 'alert');
      notice.textContent = 'Cannot publish: ' + warnings.join(' ');
    } else {
      notice.className = 'notice';
      notice.textContent = 'Text and button colors meet 4.5:1 contrast in light and dark modes.';
    }
    host.appendChild(notice);
  }

  function newId(type) {
    var random = '';
    for (var i = 0; i < 10; i++) random += Math.floor(Math.random() * 16).toString(16);
    return 'blk-' + type.slice(0, 4) + '-' + random;
  }

  function makeBlock(type) {
    switch (type) {
      case 'heading': return { id: newId(type), type: type, text: 'New heading' };
      case 'markdown': return { id: newId(type), type: type, markdown: 'New text.' };
      case 'footer': return { id: newId(type), type: type, text: 'Footer note.' };
      case 'logo': return { id: newId(type), type: type, url: '', alt: 'Application logo', heightPx: 48 };
      default: return { id: newId(type), type: 'divider' };
    }
  }

  function ensureLoginForm() {
    var hasForm = state.doc.blocks.some(function (block) { return block.type === 'loginForm'; });
    if (!hasForm) state.doc.blocks.push({ id: newId('login'), type: 'loginForm' });
  }

  function renderProfileSelect() {
    var select = el('profile-select');
    select.textContent = '';
    state.clients.forEach(function (clientId) {
      var option = document.createElement('option');
      option.value = clientId;
      option.textContent = clientId === 'default' ? 'Default (all apps)' : clientId +
        (state.profiles.indexOf(clientId) >= 0 ? '' : ' (not customized)');
      select.appendChild(option);
    });
    select.value = state.current;
  }

  function blockHint(block) {
    switch (block.type) {
      case 'heading': return block.text;
      case 'markdown': return block.markdown.replace(/\\s+/g, ' ').slice(0, 70);
      case 'footer': return block.text;
      case 'logo': return block.alt || '(no alt text)';
      case 'loginForm': return 'Username - password - verification - submit';
      default: return '';
    }
  }

  function renderCanvas() {
    var canvas = el('canvas');
    canvas.textContent = '';
    state.doc.blocks.forEach(function (block, index) {
      var row = document.createElement('div');
      row.className = 'block-row' + (block.id === state.selected ? ' selected' : '');
      row.draggable = true;
      row.setAttribute('data-id', block.id);

      var label = document.createElement('div');
      label.className = 'label';
      var title = document.createElement('div');
      title.className = 'title';
      title.textContent = BLOCK_LABELS[block.type] || block.type;
      var hint = document.createElement('div');
      hint.className = 'hint';
      hint.textContent = blockHint(block);
      label.appendChild(title);
      label.appendChild(hint);

      var remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'remove';
      remove.setAttribute('aria-label', 'Delete ' + title.textContent);
      remove.textContent = '\\u00d7';
      if (block.type === 'loginForm') {
        remove.hidden = true;
        var tag = document.createElement('span');
        tag.className = 'required-tag';
        tag.textContent = 'fixed';
        row.appendChild(label);
        row.appendChild(tag);
      } else {
        row.appendChild(label);
        row.appendChild(remove);
        remove.addEventListener('click', function (event) {
          event.stopPropagation();
          state.doc.blocks.splice(index, 1);
          if (state.selected === block.id) state.selected = null;
          renderAll();
        });
      }

      row.addEventListener('click', function () {
        state.selected = block.id;
        renderAll();
      });
      row.addEventListener('dragstart', function (event) {
        row.classList.add('dragging');
        event.dataTransfer.setData('text/plain', block.id);
        event.dataTransfer.effectAllowed = 'move';
      });
      row.addEventListener('dragend', function () { row.classList.remove('dragging'); });
      row.addEventListener('dragover', function (event) {
        event.preventDefault();
        event.dataTransfer.dropEffect = 'move';
      });
      row.addEventListener('drop', function (event) {
        event.preventDefault();
        var draggedId = event.dataTransfer.getData('text/plain');
        if (!draggedId || draggedId === block.id) return;
        var fromIndex = state.doc.blocks.findIndex(function (b) { return b.id === draggedId; });
        if (fromIndex < 0) return;
        var moved = state.doc.blocks.splice(fromIndex, 1)[0];
        var targetIndex = state.doc.blocks.findIndex(function (b) { return b.id === block.id; });
        state.doc.blocks.splice(targetIndex + (fromIndex < index ? 1 : 0), 0, moved);
        renderAll();
      });

      canvas.appendChild(row);
    });
    var loginCount = state.doc.blocks.filter(function (b) { return b.type === 'loginForm'; }).length;
    el('form-warning').hidden = loginCount === 1;
  }

  function field(labelText, input) {
    var wrap = document.createElement('div');
    wrap.className = 'field';
    var label = document.createElement('label');
    label.textContent = labelText;
    wrap.appendChild(label);
    wrap.appendChild(input);
    return wrap;
  }

  function textInput(value, maxLength, onInput) {
    var input = document.createElement('input');
    input.type = 'text';
    input.value = value || '';
    input.maxLength = maxLength;
    input.addEventListener('input', function () { onInput(input.value); });
    return input;
  }

  function renderProps() {
    var host = el('props');
    host.textContent = '';
    var title = el('props-title');
    var block = state.doc.blocks.find(function (b) { return b.id === state.selected; }) || null;

    if (!block) {
      title.textContent = 'Properties';
      host.appendChild(Object.assign(document.createElement('p'), { className: 'notice', textContent: 'Select a block to edit it.' }));
      renderThemeControls(host);
      return;
    }

    title.textContent = BLOCK_LABELS[block.type] || block.type;

    if (block.type === 'loginForm') {
      host.appendChild(Object.assign(document.createElement('p'), {
        className: 'notice',
        textContent: 'The sign-in form is fixed for security. Position it in the layout; its fields cannot be changed.'
      }));
    } else if (block.type === 'divider') {
      host.appendChild(Object.assign(document.createElement('p'), { className: 'notice', textContent: 'A horizontal rule between content.' }));
    } else if (block.type === 'heading') {
      host.appendChild(field('Heading text', textInput(block.text, 120, function (value) { block.text = value.trim(); refreshRow(); })));
    } else if (block.type === 'footer') {
      var footerArea = document.createElement('textarea');
      footerArea.rows = 2;
      footerArea.maxLength = 200;
      footerArea.value = block.text;
      footerArea.addEventListener('input', function () { block.text = footerArea.value.trim(); refreshRow(); });
      host.appendChild(field('Footer note', footerArea));
    } else if (block.type === 'markdown') {
      var area = document.createElement('textarea');
      area.rows = 6;
      area.maxLength = 2000;
      area.value = block.markdown;
      area.addEventListener('input', function () { block.markdown = area.value; refreshRow(); });
      host.appendChild(field('Text (Markdown)', area));
      host.appendChild(Object.assign(document.createElement('p'), {
        className: 'notice',
        textContent: 'Bold, italics, links, and simple lists are supported. Scripts and images are stripped.'
      }));
    } else if (block.type === 'logo') {
      host.appendChild(field('Image URL (https)', textInput(block.url, 2048, function (value) { block.url = value.trim(); refreshRow(); })));
      host.appendChild(field('Alt text', textInput(block.alt, 160, function (value) { block.alt = value; refreshRow(); })));
      var height = document.createElement('input');
      height.type = 'number';
      height.min = '16'; height.max = '128';
      height.value = String(block.heightPx);
      height.addEventListener('input', function () {
        var parsed = parseInt(height.value, 10);
        if (Number.isFinite(parsed)) block.heightPx = Math.min(128, Math.max(16, parsed));
      });
      host.appendChild(field('Height (px, 16\\u2013128)', height));
    }

    function refreshRow() { renderCanvas(); schedulePreview(); }
    renderThemeControls(host);
  }

  function renderThemeControls(host) {
    var theme = state.doc.theme || {};
    var heading = document.createElement('h2');
    heading.textContent = 'Theme colors';
    heading.style.marginTop = '1rem';
    host.appendChild(heading);

    THEME_FIELDS.forEach(function (entry) {
      var key = entry[0], labelText = entry[1], fallback = entry[2];
      var row = document.createElement('div');
      row.className = 'color-row';
      var label = document.createElement('span');
      label.textContent = labelText;
      var picker = document.createElement('input');
      picker.type = 'color';
      var current = theme[key] || fallback;
      picker.value = current.length === 4 ? '#' + current[1] + current[1] + current[2] + current[2] + current[3] + current[3] : current;
      picker.addEventListener('input', function () {
        state.doc.theme = state.doc.theme || {};
        state.doc.theme[key] = picker.value.toLowerCase();
        renderContrastNotice(host);
        schedulePreview();
      });
      var clear = document.createElement('button');
      clear.type = 'button';
      clear.className = 'secondary';
      clear.style.padding = '.25rem .5rem';
      clear.style.fontSize = '.72rem';
      clear.textContent = 'default';
      clear.addEventListener('click', function () {
        if (state.doc.theme) delete state.doc.theme[key];
        picker.value = fallback;
        renderContrastNotice(host);
        schedulePreview();
      });
      row.appendChild(label);
      row.appendChild(picker);
      row.appendChild(clear);
      host.appendChild(row);
    });

    var radiusRow = document.createElement('div');
    radiusRow.className = 'color-row';
    var radiusLabel = document.createElement('span');
    radiusLabel.textContent = 'Corner radius';
    var radiusSelect = document.createElement('select');
    ['none', 'sm', 'md', 'lg'].forEach(function (value) {
      var option = document.createElement('option');
      option.value = value;
      option.textContent = value;
      radiusSelect.appendChild(option);
    });
    radiusSelect.value = theme.radius || 'md';
    radiusSelect.addEventListener('change', function () {
      state.doc.theme = state.doc.theme || {};
      state.doc.theme.radius = radiusSelect.value;
      schedulePreview();
    });
    radiusRow.appendChild(radiusLabel);
    radiusRow.appendChild(radiusSelect);
    host.appendChild(radiusRow);
    renderContrastNotice(host);
  }

  function renderPalette() {
    var host = el('palette');
    host.textContent = '';
    PALETTE.forEach(function (entry) {
      var button = document.createElement('button');
      button.type = 'button';
      button.textContent = '+ ' + entry[1];
      button.addEventListener('click', function () {
        var block = makeBlock(entry[0]);
        var formIndex = state.doc.blocks.findIndex(function (b) { return b.type === 'loginForm'; });
        if (formIndex >= 0) state.doc.blocks.splice(formIndex, 0, block);
        else state.doc.blocks.push(block);
        state.selected = block.id;
        renderAll();
      });
      host.appendChild(button);
    });
  }

  function renderAll() {
    renderPalette();
    renderCanvas();
    renderProps();
    renderProfileSelect();
    el('branding-template').value = state.doc.template || 'split';
    renderStateCopy();
    schedulePreview();
  }

  function selectedStateCopy() {
    state.doc.stateCopy = state.doc.stateCopy || {};
    var kind = el('preview-kind').value || 'login';
    state.doc.stateCopy[kind] = state.doc.stateCopy[kind] || {};
    return state.doc.stateCopy[kind];
  }

  function renderStateCopy() {
    var copy = selectedStateCopy();
    el('state-copy-heading').value = copy.heading || '';
    el('state-copy-body').value = copy.body || '';
  }

  function loadRevisions() {
    return api('GET', '/admin/api/profile/' + encodeURIComponent(state.current) + '/revisions').then(function (data) {
      var host = el('branding-revisions'); host.textContent = '';
      var rows = data.revisions || [];
      if (!rows.length) { var empty = document.createElement('p'); empty.className = 'notice'; empty.textContent = 'No published revisions yet.'; host.appendChild(empty); return; }
      rows.forEach(function (revision, index) {
        var row = document.createElement('div'); row.className = 'block-row';
        var label = document.createElement('div'); label.className = 'label';
        var title = document.createElement('div'); title.className = 'title'; title.textContent = 'Revision ' + revision.revision;
        var hint = document.createElement('div'); hint.className = 'hint'; hint.textContent = fmtWhen(revision.publishedAt || revision.createdAt) + ' · ' + revision.createdBy;
        label.appendChild(title); label.appendChild(hint); row.appendChild(label);
        var stateTag = document.createElement('span'); stateTag.className = 'badge ' + (revision.status === 'published' ? 'ok' : ''); stateTag.textContent = revision.status; row.appendChild(stateTag);
        if (index > 0) {
          var restore = document.createElement('button'); restore.type = 'button'; restore.className = 'secondary mini'; restore.textContent = 'Restore'; row.appendChild(restore);
          restore.addEventListener('click', function () {
            requestImpact({ title: 'Republish sign-in appearance', description: 'Publish revision ' + revision.revision + ' again for the selected application. This replaces the currently published appearance.', confirmLabel: 'Republish revision', evidence: 'The previous revision remains in immutable history and this publication is audited.' }).then(function (decision) {
              if (!decision.confirmed) return;
              return api('POST', '/admin/api/profile/' + encodeURIComponent(state.current) + '/revisions/' + revision.revision + '/restore', {})
                .then(function () { setStatus('Revision restored.'); return Promise.all([loadProfile(state.current), loadRevisions()]); })
                .catch(function (error) { setStatus(error.message, true); });
            });
          });
        }
        host.appendChild(row);
      });
    }).catch(function (error) { setStatus(error.message, true); });
  }

  /* Preview: the draft is rendered server-side and served from a dedicated
     framed route (srcdoc cannot work under the console CSP). */
  function renderPreview() {
    if (!state.doc) return;
    var loginCount = state.doc.blocks.filter(function (b) { return b.type === 'loginForm'; }).length;
    if (loginCount !== 1) return;
    api('POST', '/admin/api/render', { doc: state.doc, kind: el('preview-kind').value })
      .then(function (data) {
        if (data && data.url) el('preview').setAttribute('src', data.url);
      })
      .catch(function () { /* transient render errors stay silent while editing */ });
  }
  function schedulePreview() {
    if (previewTimer) clearTimeout(previewTimer);
    previewTimer = setTimeout(renderPreview, 700);
  }

  function loadProfile(clientId) {
    state.current = clientId;
    api('GET', '/admin/api/profile/' + encodeURIComponent(clientId))
      .catch(function () { return { error: 'not_found' }; })
      .then(function (data) {
        state.doc = data && data.doc ? data.doc : null;
        if (!state.doc) state.doc = { version: 1, titleSuffix: 'UAR Authentication', template: 'split', theme: {}, blocks: [] };
        el('branding-template').value = state.doc.template || 'split';
        ensureLoginForm();
        state.selected = null;
        renderAll();
        loadRevisions();
        setStatus('Loaded profile "' + clientId + '"' + (data && data.degraded ? ' (stored copy failed validation; showing defaults)' : ''));
      })
      .catch(function (error) { setStatus(error.message, true); });
  }

  el('profile-select').addEventListener('change', function (event) {
    loadProfile(event.target.value);
  });
  el('branding-template').addEventListener('change', function () { state.doc.template = el('branding-template').value; schedulePreview(); });
  el('preview-kind').addEventListener('change', function () { renderStateCopy(); renderPreview(); });
  el('state-copy-heading').addEventListener('input', function () {
    var copy = selectedStateCopy();
    if (el('state-copy-heading').value) copy.heading = el('state-copy-heading').value; else delete copy.heading;
    schedulePreview();
  });
  el('state-copy-body').addEventListener('input', function () {
    var copy = selectedStateCopy();
    if (el('state-copy-body').value) copy.body = el('state-copy-body').value; else delete copy.body;
    schedulePreview();
  });

  el('btn-preview').addEventListener('click', function () {
    renderPreview();
    setStatus('Preview refreshed.');
  });

  el('btn-publish').addEventListener('click', function () {
    var loginCount = state.doc.blocks.filter(function (b) { return b.type === 'loginForm'; }).length;
    if (loginCount !== 1) {
      setStatus('The layout needs exactly one Sign-in Form block.', true);
      return;
    }
    api('PUT', '/admin/api/profile/' + encodeURIComponent(state.current), { doc: state.doc })
      .then(function () {
        setStatus('Published for "' + state.current + '". Live within ~30 seconds.');
        return Promise.all([api('GET', '/admin/api/clients').then(refreshProfileLists).catch(function () {}), loadRevisions()]);
      })
      .catch(function (error) { setStatus(error.message, true); });
  });

  el('btn-reset').addEventListener('click', function () {
    state.doc = { version: 1, titleSuffix: 'UAR Authentication', template: 'split', theme: {}, blocks: [] };
    ensureLoginForm();
    state.selected = null;
    renderAll();
    setStatus('Draft reset to the default layout (not published).');
  });

  function refreshProfileLists(data) {
    state.clients = data.clients || [];
    state.profiles = data.profiles || [];
    renderProfileSelect();
  }

  api('GET', '/admin/api/session')
    .then(function (session) {
      el('whoami').textContent = 'Signed in as ' + session.username;
      return api('GET', '/admin/api/clients');
    })
    .then(function (data) {
      refreshProfileLists(data);
      var preferred = state.profiles.indexOf('default') >= 0 ? 'default' : state.clients[0] || 'default';
      loadProfile(preferred);
    })
    .catch(function (error) { setStatus(error.message, true); });

  document.addEventListener('authmgr:show-branding', function () {
    schedulePreview();
  });
})();
`;
