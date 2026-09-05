'use client';

import { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import {
  Loader2,
  Plus,
  Save,
  Trash2,
  ArrowUp,
  ArrowDown,
  RotateCcw,
  Palette,
  PanelTop,
  FileText,
  History,
  Eye,
} from 'lucide-react';
import PortalNav, { type PortalNavSessionState } from '@/components/PortalNav';
import { PublicRequestShellPreview } from '@/components/request/PublicRequestShell';
import {
  DEFAULT_NAV_LINKS,
  DEFAULT_REQUEST_EXTERNAL_CONTENT,
  DEFAULT_REQUEST_INTERNAL_CONTENT,
  type NavLinkConfig,
  type PageContentConfig,
  PAGE_APPEARANCE_IDS,
  PAGE_APPEARANCE_REGISTRY,
  type PageAppearanceId,
} from '@/lib/appearance';
import { EMPTY_MANAGED_PAGE, type ManagedPageBlock, type ManagedPageDocument } from '@/lib/appearance-pages';
import { ManagedPageRegion } from '@/components/appearance/ManagedPageRegion';
import { CodeEditor } from './CodeEditor';
import { cn } from '@/lib/utils';
import AppearanceHistorySection from './AppearanceHistorySection';
import { useAppearancePanelController } from './AppearancePanelController';
import { NAVBAR_PREVIEW_OPTIONS } from './AppearancePanelState';
import AppearanceThemeSection from './AppearanceThemeSection';

function PageWorkspace({ document, onChange }: { document: ManagedPageDocument; onChange: (value: ManagedPageDocument) => void }) {
  const [advancedTab, setAdvancedTab] = useState<'html' | 'css' | 'javascript'>('html');
  const addBlock = (type: ManagedPageBlock['type']) => {
    const id = crypto.randomUUID();
    let block: ManagedPageBlock;
    if (type === 'notice') block = { id, type, body: 'Important operational information.', tone: 'info' };
    else if (type === 'actionCards') block = { id, type, title: 'Actions', items: [{ label: 'Open service', href: '/', description: 'Continue in the portal.' }] };
    else if (type === 'workflowShowcase') block = { id, type, title: 'How it works', steps: ['Start', 'Review', 'Complete'] };
    else if (type === 'faq') block = { id, type, title: 'Questions', items: [{ question: 'What happens next?', answer: 'The portal records the next step.' }] };
    else block = { id, type, title: type === 'serviceStory' ? 'Service story' : undefined, body: 'Add page content here.' } as ManagedPageBlock;
    onChange({ ...document, blocks: [...document.blocks, block] });
  };
  const updateBlock = (index: number, patch: Record<string, unknown>) => onChange({ ...document, blocks: document.blocks.map((block, current) => current === index ? { ...block, ...patch } as ManagedPageBlock : block) });
  return (
    <div className="grid min-h-[620px] gap-0 overflow-hidden rounded-lg border border-border xl:grid-cols-[230px_minmax(360px,1fr)_minmax(360px,1.1fr)]">
      <aside className="border-b bg-muted/30 p-3 xl:border-b-0 xl:border-r">
        <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Insert block</p>
        <div className="grid grid-cols-2 gap-1 xl:grid-cols-1">{(['richText','notice','actionCards','workflowShowcase','serviceStory','faq'] as const).map((type) => <Button key={type} variant="ghost" size="sm" className="justify-start" onClick={() => addBlock(type)}>{type.replace(/([A-Z])/g, ' $1')}</Button>)}</div>
        <p className="mt-5 text-xs text-muted-foreground">Transactional forms remain portal-owned. Managed content renders only in the approved intro region.</p>
      </aside>
      <section className="border-b p-4 xl:border-b-0 xl:border-r">
        <div className="mb-4 inline-flex rounded-md border p-0.5">{(['basic','advanced'] as const).map((mode) => <button key={mode} type="button" onClick={() => onChange({ ...document, mode })} className={cn('rounded px-3 py-1.5 text-sm capitalize', document.mode === mode ? 'bg-foreground text-background' : 'text-muted-foreground')}>{mode}</button>)}</div>
        {document.mode === 'basic' ? <div className="space-y-3">{document.blocks.map((block, index) => <div key={block.id} className="border-l-4 border-violet-500 bg-muted/30 p-3"><div className="mb-2 flex items-center justify-between"><Badge variant="outline">{block.type}</Badge><Button size="icon-sm" variant="ghost" aria-label={`Remove ${block.type} block`} onClick={() => onChange({ ...document, blocks: document.blocks.filter((_, current) => current !== index) })}><Trash2 className="h-4 w-4" /></Button></div>{'title' in block && <Input aria-label={`${block.type} title`} className="mb-2" value={block.title} onChange={(event) => updateBlock(index, { title: event.target.value })} placeholder="Section title" />}{'body' in block && <textarea aria-label={`${block.type} body`} className="min-h-24 w-full rounded-md border bg-background p-2 text-sm" value={block.body} onChange={(event) => updateBlock(index, { body: event.target.value })} />}{'steps' in block && <Input aria-label={`${block.type} steps`} value={block.steps.join(' → ')} onChange={(event) => updateBlock(index, { steps: event.target.value.split('→').map((step) => step.trim()).filter(Boolean) })} />}</div>)}{document.blocks.length === 0 && <div className="grid min-h-52 place-items-center border border-dashed text-sm text-muted-foreground">Choose a portal-native block.</div>}</div> : <div className="space-y-3"><div className="inline-flex rounded-md border p-0.5">{(['html','css','javascript'] as const).map((tab) => <button key={tab} type="button" onClick={() => setAdvancedTab(tab)} className={cn('rounded px-2.5 py-1 text-xs uppercase', advancedTab === tab ? 'bg-muted font-semibold' : 'text-muted-foreground')}>{tab}</button>)}</div><CodeEditor value={document[advancedTab]} onChange={(value) => onChange({ ...document, [advancedTab]: value })} language={advancedTab} ariaLabel={`Page ${advancedTab} source`} minHeight={450} /><p className="text-xs text-muted-foreground">Runs in a unique-origin iframe with no portal cookies, storage, forms, APIs, or network access.</p></div>}
      </section>
      <section className="bg-slate-100 p-4 dark:bg-slate-950"><div className="mb-3 flex items-center justify-between"><span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Exact managed region</span><Eye className="h-4 w-4 text-muted-foreground" /></div><div className="rounded-lg bg-background p-4 shadow-sm"><ManagedPageRegion document={document} preview /></div></section>
    </div>
  );
}

/** Canonical key order so value-equality checks are not confused by key insertion order. */
function normalizeLinks(list: NavLinkConfig[]): NavLinkConfig[] {
  return list.map((link) => ({
    label: link.label,
    href: link.href,
    section: link.section === 'services' ? 'services' : 'main',
    requiresAuth: link.requiresAuth === true,
    requiresAdmin: link.requiresAdmin === true,
  }));
}

function StateBadge({ customized }: { customized: boolean }) {
  return (
    <Badge variant={customized ? 'default' : 'secondary'}>{customized ? 'Customized' : 'Default'}</Badge>
  );
}

/** True live preview: renders the real PortalNav chrome from the CURRENT editor state. */
function NavbarPreview({ links }: { links: NavLinkConfig[] }) {
  const [sessionState, setSessionState] = useState<PortalNavSessionState>('anonymous');
  const serviceCount = links.filter((link) => link.section === 'services').length;

  return (
    <div className="space-y-2">
      <div
        className="inline-flex rounded-lg border border-border bg-muted p-0.5"
        role="group"
        aria-label="Preview as visitor type"
      >
        {NAVBAR_PREVIEW_OPTIONS.map((option) => (
          <button
            key={option.value}
            type="button"
            onClick={() => setSessionState(option.value)}
            aria-pressed={sessionState === option.value}
            className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
              sessionState === option.value
                ? 'bg-background text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            {option.label}
          </button>
        ))}
      </div>
      <div className="overflow-hidden rounded-lg border border-border">
        <PortalNav
          links={links}
          sessionState={sessionState}
          displayName="Preview User"
          interactive={false}
        />
      </div>
      <p className="text-[11px] text-muted-foreground flex flex-wrap items-center gap-x-3 gap-y-1">
        <span>
          Live preview — the real navigation bar, updating as you edit. Switch visitor type above to
          verify visibility rules ({serviceCount} link{serviceCount === 1 ? '' : 's'} in the Services
          dropdown).
        </span>
      </p>
    </div>
  );
}

function RequestPagePreview({
  content,
  page,
}: {
  content: PageContentConfig;
  page: PageAppearanceId;
}) {
  return (
    <div className="rounded-lg bg-muted/30 p-3">
      <p className="mb-2 text-center text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
        Live request shell
      </p>
      <PublicRequestShellPreview content={content} kind={page === 'requestExternal' ? 'external' : 'internal'} />
    </div>
  );
}

function ContentEditor({
  heading,
  page,
  route,
  description,
  value,
  defaultValue,
  onChange,
  onReset,
}: {
  heading: string;
  page: PageAppearanceId;
  route: string;
  description: string;
  value: PageContentConfig;
  defaultValue: PageContentConfig;
  onChange: (next: PageContentConfig) => void;
  onReset: () => void;
}) {
  const customized = JSON.stringify(value) !== JSON.stringify(defaultValue);
  return (
    <div className={cn('space-y-3 rounded-lg border p-4', page === 'home' && 'lg:col-span-2')}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="flex items-center gap-2 font-medium">
            {heading} <StateBadge customized={customized} />
          </h3>
          <p className="text-xs text-muted-foreground">{description}</p>
        </div>
        <Button variant="ghost" size="sm" onClick={onReset}>
          <RotateCcw className="mr-2 h-4 w-4" /> Reset to defaults
        </Button>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor={`${route}-title`}>Title</Label>
        <Input
          id={`${route}-title`}
          value={value.title}
          maxLength={120}
          onChange={(e) => onChange({ ...value, title: e.target.value })}
          placeholder={defaultValue.title}
        />
        <p className="text-[11px] text-muted-foreground">Big centered heading at the top of the page.</p>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor={`${route}-subtitle`}>Subtitle</Label>
        <Input
          id={`${route}-subtitle`}
          value={value.subtitle}
          maxLength={400}
          onChange={(e) => onChange({ ...value, subtitle: e.target.value })}
          placeholder={defaultValue.subtitle}
        />
        <p className="text-[11px] text-muted-foreground">One-sentence explainer shown under the heading.</p>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor={`${route}-notice`}>Notice box (optional)</Label>
        <textarea
          id={`${route}-notice`}
          value={value.notice ?? ''}
          maxLength={800}
          rows={3}
          onChange={(e) => onChange({ ...value, notice: e.target.value || undefined })}
          placeholder={defaultValue.notice ?? ''}
          className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:ring-2 focus:ring-ring"
        />
        <p className="text-[11px] text-muted-foreground">
          Highlighted box above the form. Leave empty to show the built-in notice.
        </p>
      </div>
      <RequestPagePreview content={value} page={page} />
    </div>
  );
}

/** Configuration ▸ Appearance & Pages: navbar + access-request page copy. */
export default function AppearancePanel() {
  const controller = useAppearancePanelController();
  const {
    addLink,
    loadAppearanceHistory,
    moveLink,
    removeLink,
    resetLinks,
    restoreManagedPage,
    restoreRevision,
    save,
    saveManagedPage,
    setManagedDraft,
    setPageContent,
    setRequestExternal,
    setRequestInternal,
    setSection,
    setSelectedPage,
    setTheme,
    updateLink,
  } = controller;
  const {
    appearanceHistory,
    appearanceHistoryPage,
    links,
    loading,
    managedDrafts,
    managedRevisions,
    message,
    pageContent,
    requestExternal,
    requestInternal,
    saving,
    section,
    selectedPage,
    theme,
  } = controller.state;

  const navCustomized = JSON.stringify(normalizeLinks(links)) !== JSON.stringify(normalizeLinks(DEFAULT_NAV_LINKS));

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="h-6 w-6 animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {message && (
        <Alert variant={message.type === 'error' ? 'destructive' : 'default'}>
          <AlertDescription>{message.text}</AlertDescription>
        </Alert>
      )}

      <nav className="flex gap-1 overflow-x-auto border-b border-border" aria-label="Appearance configuration sections">
        {([
          ['theme', 'Theme', Palette], ['navigation', 'Navigation', PanelTop], ['pages', 'Pages', FileText], ['history', 'History', History],
        ] as const).map(([id, label, Icon]) => (
          <button key={id} type="button" onClick={() => setSection(id)} className={cn('flex items-center gap-2 border-b-2 px-4 py-3 text-sm font-medium', section === id ? 'border-[var(--brand-accent)] text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground')}><Icon className="h-4 w-4" />{label}</button>
        ))}
      </nav>

      {section === 'theme' && <AppearanceThemeSection links={links} theme={theme} onThemeChange={setTheme} />}

      {section === 'navigation' && <Card>
        <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-2 space-y-0">
          <div className="space-y-1.5">
            <CardTitle className="flex items-center gap-2">
              Navigation bar <StateBadge customized={navCustomized} />
            </CardTitle>
            <CardDescription>
              Configure which links appear in the portal navigation. Internal paths start with / and stay in the
              portal; https:// service links open in a new tab.
            </CardDescription>
          </div>
          <Button
            variant="ghost"
            size="sm"
            disabled={!navCustomized}
            onClick={resetLinks}
          >
            <RotateCcw className="mr-2 h-4 w-4" /> Reset to defaults
          </Button>
        </CardHeader>
        <CardContent className="space-y-4">
          <NavbarPreview links={links} />

          <div className="space-y-3 border-t pt-4">
            {links.map((link, index) => (
              <div key={link.editorKey} className="flex flex-wrap items-end gap-2 rounded-lg border p-3">
                <div className="space-y-1.5 flex-1 min-w-[140px]">
                  <Label htmlFor={`link-label-${link.editorKey}`}>Label</Label>
                  <Input
                    id={`link-label-${link.editorKey}`}
                    value={link.label}
                    maxLength={60}
                    onChange={(e) => updateLink(link.editorKey, { label: e.target.value })}
                  />
                  <p className="text-[11px] text-muted-foreground">Text visitors see in the bar.</p>
                </div>
                <div className="space-y-1.5 flex-1 min-w-[200px]">
                  <Label htmlFor={`link-href-${link.editorKey}`}>Target</Label>
                  <Input
                    id={`link-href-${link.editorKey}`}
                    value={link.href}
                    maxLength={400}
                    onChange={(e) => updateLink(link.editorKey, { href: e.target.value })}
                    placeholder="/path or https://host"
                  />
                  <p className="text-[11px] text-muted-foreground">
                    /path stays in this portal · https:// opens in a new tab.
                  </p>
                </div>
                <div className="space-y-1.5 w-[130px]">
                  <Label htmlFor={`link-section-${link.editorKey}`}>Section</Label>
                  <select
                    id={`link-section-${link.editorKey}`}
                    value={link.section}
                    onChange={(e) => updateLink(link.editorKey, { section: e.target.value === 'services' ? 'services' : 'main' })}
                    className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                  >
                    <option value="main">Main bar</option>
                    <option value="services">Services dropdown</option>
                  </select>
                  <p className="text-[11px] text-muted-foreground">Where the link sits.</p>
                </div>
                <div className="flex flex-col gap-1 pb-1 text-sm">
                  <label className="flex items-center gap-1.5">
                    <input
                      type="checkbox"
                      checked={link.requiresAuth === true}
                      onChange={(e) => updateLink(link.editorKey, { requiresAuth: e.target.checked })}
                      className="h-4 w-4"
                    />
                    Signed-in only
                  </label>
                  <label className="flex items-center gap-1.5">
                    <input
                      type="checkbox"
                      checked={link.requiresAdmin === true}
                      onChange={(e) => updateLink(link.editorKey, { requiresAdmin: e.target.checked })}
                      className="h-4 w-4"
                    />
                    Admins only
                  </label>
                  <p className="text-[11px] leading-tight text-muted-foreground">
                    Signed-in hides it from logged-out visitors; Admins further restricts it to administrators.
                  </p>
                </div>
                <div className="flex gap-1 pb-0.5">
                  <Button variant="ghost" size="icon" aria-label="Move up" disabled={index === 0} onClick={() => moveLink(link.editorKey, -1)}>
                    <ArrowUp className="h-4 w-4" />
                  </Button>
                  <Button variant="ghost" size="icon" aria-label="Move down" disabled={index === links.length - 1} onClick={() => moveLink(link.editorKey, 1)}>
                    <ArrowDown className="h-4 w-4" />
                  </Button>
                  <Button variant="ghost" size="icon" aria-label="Remove link" onClick={() => removeLink(link.editorKey)}>
                    <Trash2 className="h-4 w-4 text-destructive" />
                  </Button>
                </div>
              </div>
            ))}
            <Button
              variant="outline"
              size="sm"
              disabled={links.length >= 24}
              onClick={addLink}
            >
              <Plus className="mr-2 h-4 w-4" /> Add link
            </Button>
          </div>
        </CardContent>
      </Card>}

      {section === 'pages' && <>
      <div className="grid gap-4 lg:grid-cols-[230px_1fr]">
        <aside className="rounded-lg border bg-muted/20 p-2">{PAGE_APPEARANCE_IDS.map((id) => { const published = managedRevisions.find((item) => item.pageKey === id && item.status === 'published'); const draft = managedRevisions.find((item) => item.pageKey === id && item.status === 'draft'); return <button key={id} type="button" onClick={() => setSelectedPage(id)} className={cn('mb-1 w-full border-l-4 px-3 py-2 text-left', selectedPage === id ? 'border-violet-500 bg-background' : 'border-transparent hover:bg-muted')}><span className="block text-sm font-medium">{PAGE_APPEARANCE_REGISTRY[id].label}</span><span className="text-xs text-muted-foreground">{draft ? `Draft v${draft.version}` : published ? `Published v${published.version}` : 'Code default'}</span></button>; })}</aside>
        <div className="space-y-3"><div className="flex flex-wrap items-center justify-between gap-3"><div><h3 className="font-semibold">{PAGE_APPEARANCE_REGISTRY[selectedPage].label}</h3><p className="text-xs text-muted-foreground">{PAGE_APPEARANCE_REGISTRY[selectedPage].route} · approved intro region</p></div><div className="flex gap-2"><Button variant="outline" disabled={saving} onClick={() => void saveManagedPage('save')}>Save draft</Button><Button disabled={saving || !managedRevisions.some((item) => item.pageKey === selectedPage && item.status === 'draft')} onClick={() => void saveManagedPage('publish')}>Publish</Button></div></div><PageWorkspace document={managedDrafts[selectedPage] ?? EMPTY_MANAGED_PAGE} onChange={(document) => setManagedDraft(selectedPage, document)} /></div>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Additional portal pages</CardTitle>
          <CardDescription>
            These previews and live pages use the same heading component, so spacing, typography, and notices do not drift.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 lg:grid-cols-2">
          {PAGE_APPEARANCE_IDS.filter((id) => id !== 'requestInternal' && id !== 'requestExternal').map((id) => {
            const registration = PAGE_APPEARANCE_REGISTRY[id];
            return (
              <ContentEditor
                key={id}
                heading={registration.label}
                page={id}
                route={id}
                description={`Shown at ${registration.route}.`}
                value={pageContent[id]}
                defaultValue={registration.defaultContent}
                onChange={(value) => setPageContent(id, value)}
                onReset={() => setPageContent(id, { ...registration.defaultContent })}
              />
            );
          })}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Access request pages</CardTitle>
          <CardDescription>Headline copy shown above the real request forms. Forms and authorization controls remain code-owned.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 lg:grid-cols-2">
          <ContentEditor heading="Internal request" page="requestInternal" route="request-internal" description="Shown at /request/internal." value={requestInternal} defaultValue={DEFAULT_REQUEST_INTERNAL_CONTENT} onChange={setRequestInternal} onReset={() => setRequestInternal({ ...DEFAULT_REQUEST_INTERNAL_CONTENT })} />
          <ContentEditor heading="External request" page="requestExternal" route="request-external" description="Shown at /request/external." value={requestExternal} defaultValue={DEFAULT_REQUEST_EXTERNAL_CONTENT} onChange={setRequestExternal} onReset={() => setRequestExternal({ ...DEFAULT_REQUEST_EXTERNAL_CONTENT })} />
        </CardContent>
      </Card>
      </>}

      {section === 'history' && <AppearanceHistorySection history={appearanceHistory} pageInfo={appearanceHistoryPage} saving={saving} onLoadMore={(cursor) => void loadAppearanceHistory(cursor)} onRestoreManaged={(page, version) => void restoreManagedPage(page, version)} onRestoreRevision={(revisionId) => void restoreRevision(revisionId)} />}

      {(section === 'theme' || section === 'navigation' || section === 'pages') && <div className="flex justify-end">
        <Button onClick={save} disabled={saving}>
          {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
          Save appearance
        </Button>
      </div>}
    </div>
  );
}
