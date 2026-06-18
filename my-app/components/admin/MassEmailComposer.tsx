'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { fetchWithCsrf } from '@/lib/csrf';
import { usePolling } from '@/hooks/usePolling';
import { useToast } from '@/hooks/useToast';
import { Bold, CheckCircle, Code2, Edit3, Eye, Heading2, Italic, Link, List, Mail, Pilcrow, Play, RefreshCw, Search, Send, Type, Underline, Users, XCircle } from 'lucide-react';

interface GroupOption {
  dn: string;
  name: string;
  description?: string;
}

interface RecipientOption {
  username: string;
  displayName?: string | null;
  email?: string | null;
  accountEnabled?: boolean;
  dn?: string;
}

interface MassEmailRecipient {
  id: string;
  email: string;
  displayName?: string | null;
  adUsername?: string | null;
  status: string;
  sources?: ResolutionSource[] | null;
  sentAt?: string | null;
  lastError?: string | null;
}

interface MassEmailLog {
  id: string;
  createdAt: string;
  level: string;
  eventType: string;
  message: string;
}

interface MassEmailCampaign {
  id: string;
  subject: string;
  html?: string;
  text?: string;
  status: string;
  quickSend: boolean;
  createdAt: string;
  createdBy: string;
  totalRecipients?: number;
  eligibleRecipients: number;
  skippedRecipients: number;
  sentCount: number;
  failedCount: number;
  statusCounts?: Record<string, number>;
  recipients?: MassEmailRecipient[];
  logs?: MassEmailLog[];
  targetSnapshot?: {
    targets?: {
      selectedUsernames?: string[];
      selectedGroups?: Array<{ dn: string; name?: string }>;
      includeAllDomainUsers?: boolean;
    };
    skipped?: Array<{
      email?: string;
      displayName?: string | null;
      adUsername?: string | null;
      reason: string;
      sources?: ResolutionSource[];
    }>;
  } | null;
}

type CampaignAudienceFilter = 'all' | 'eligible' | 'skipped' | 'sent' | 'failed';
type ComposerTab = 'compose' | 'campaigns';
type EditorMode = 'visual' | 'html';

interface CampaignAudienceRow {
  key: string;
  type: 'eligible' | 'skipped';
  displayName?: string | null;
  email?: string | null;
  adUsername?: string | null;
  status: string;
  sourceText: string;
  note?: string;
}

interface CampaignsResponse {
  campaigns: MassEmailCampaign[];
  selectedCampaign: MassEmailCampaign | null;
}

interface ResolutionSource {
  label: string;
  type: string;
}

interface ResolutionListItem {
  email?: string;
  displayName?: string | null;
  adUsername?: string | null;
  accountEnabled?: boolean | null;
  reason?: string;
  sources: ResolutionSource[];
}

interface ResolutionResponse {
  candidates: ResolutionListItem[];
  recipients: ResolutionListItem[];
  skipped: ResolutionListItem[];
  summary: {
    totalCandidates: number;
    eligibleRecipients: number;
    skippedRecipients: number;
    duplicateSourcesMerged: number;
  };
}

function parseUsernames(value: string): string[] {
  return Array.from(new Set(value.split(/[\n,]+/).map((item) => item.trim()).filter(Boolean)));
}

function normalizeUsername(value: string) {
  return value.trim().toLowerCase();
}

function uniqueUsernames(usernames: string[]) {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const username of usernames) {
    const normalized = normalizeUsername(username);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    result.push(username.trim());
  }

  return result;
}

function statusTone(status: string) {
  if (status === 'completed' || status === 'sent') return 'bg-green-100 text-green-800';
  if (status === 'active' || status === 'pending_send' || status === 'sending') return 'bg-blue-100 text-blue-800';
  if (status === 'failed' || status === 'cancelled') return 'bg-red-100 text-red-800';
  if (status === 'skipped') return 'bg-amber-100 text-amber-800';
  return 'bg-gray-100 text-gray-700';
}

function formatReason(reason?: string) {
  return reason ? reason.replace(/_/g, ' ') : '';
}

function stripPortalFooter(rawHtml: string) {
  const html = rawHtml || '';
  const markerIndex = [
    'data-mass-email-footer="true"',
    "data-mass-email-footer='true'",
    'This message was submitted by the Cal Poly SOC UAR Portal.',
    'administrator-selected UAR Portal recipient audience.',
  ]
    .map((marker) => html.indexOf(marker))
    .filter((index) => index !== -1)
    .sort((left, right) => left - right)[0];
  if (markerIndex === -1) return rawHtml || '';

  const contentBeforeMarker = html.slice(0, markerIndex);
  const footerStart = contentBeforeMarker.lastIndexOf('<hr');
  return (footerStart === -1 ? contentBeforeMarker : html.slice(0, footerStart)).trim();
}

function sourceSummary(sources: ResolutionSource[] = []) {
  const labels = Array.from(new Set(sources.map((source) => source.label).filter(Boolean)));
  return labels.length > 0 ? labels.join(', ') : 'No source recorded';
}

function normalizeSources(value: unknown): ResolutionSource[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((source) => ({
      label: typeof source?.label === 'string' ? source.label : '',
      type: typeof source?.type === 'string' ? source.type : '',
    }))
    .filter((source) => source.label || source.type);
}

function campaignAudienceRows(campaign: MassEmailCampaign | null): CampaignAudienceRow[] {
  if (!campaign) return [];

  const eligibleRows = (campaign.recipients || []).map((recipient) => ({
    key: `eligible-${recipient.id}`,
    type: 'eligible' as const,
    displayName: recipient.displayName,
    email: recipient.email,
    adUsername: recipient.adUsername,
    status: recipient.status,
    sourceText: sourceSummary(normalizeSources(recipient.sources)),
    note: recipient.lastError || (recipient.sentAt ? `Sent ${new Date(recipient.sentAt).toLocaleString()}` : undefined),
  }));

  const skippedRows = (campaign.targetSnapshot?.skipped || []).map((recipient, index) => ({
    key: `skipped-${recipient.email || recipient.adUsername || index}`,
    type: 'skipped' as const,
    displayName: recipient.displayName,
    email: recipient.email || null,
    adUsername: recipient.adUsername || null,
    status: 'skipped',
    sourceText: sourceSummary(normalizeSources(recipient.sources)),
    note: formatReason(recipient.reason),
  }));

  return [...eligibleRows, ...skippedRows];
}

function campaignAudienceMatches(row: CampaignAudienceRow, query: string) {
  if (!query) return true;
  const haystack = [row.displayName, row.email, row.adUsername, row.status, row.sourceText, row.note]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
  return haystack.includes(query);
}

function resolutionItemMatches(item: ResolutionListItem, query: string) {
  if (!query) return true;
  const haystack = [
    item.displayName,
    item.email,
    item.adUsername,
    item.reason,
    sourceSummary(item.sources),
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
  return haystack.includes(query);
}

function DryRunRecipientList({
  items,
  emptyMessage,
  tone,
}: {
  items: ResolutionListItem[];
  emptyMessage: string;
  tone: 'candidate' | 'eligible' | 'skipped';
}) {
  if (items.length === 0) {
    return <p className="rounded-md border border-dashed px-3 py-4 text-sm text-gray-500">{emptyMessage}</p>;
  }

  const toneClass = tone === 'eligible'
    ? 'bg-green-50 text-green-700'
    : tone === 'skipped'
      ? 'bg-red-50 text-red-700'
      : 'bg-gray-100 text-gray-700';

  return (
    <div className="max-h-120 overflow-auto rounded-md border">
      <table className="w-full min-w-[720px] text-left text-sm">
        <thead className="sticky top-0 bg-gray-50 text-xs font-medium uppercase text-gray-500">
          <tr>
            <th scope="col" className="border-b px-3 py-2">Recipient</th>
            <th scope="col" className="border-b px-3 py-2">Username</th>
            <th scope="col" className="border-b px-3 py-2">Source</th>
            <th scope="col" className="border-b px-3 py-2">Status</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item, index) => {
            const title = item.displayName || item.email || item.adUsername || 'Unknown recipient';
            const sourceText = sourceSummary(item.sources);
            const badgeText = tone === 'skipped' || item.reason ? formatReason(item.reason) : tone;
            const badgeClass = item.reason ? 'bg-amber-50 text-amber-700' : toneClass;
            return (
              <tr key={`${item.email || item.adUsername || title}-${index}`} className="border-b last:border-b-0 hover:bg-gray-50/70">
                <td className="max-w-[260px] px-3 py-2 align-top">
                  <p className="truncate font-medium text-gray-900">{title}</p>
                  {item.email && <p className="truncate text-xs text-gray-500">{item.email}</p>}
                </td>
                <td className="max-w-40 px-3 py-2 align-top text-xs text-gray-600">
                  <span className="block truncate">{item.adUsername || '-'}</span>
                </td>
                <td className="max-w-72 px-3 py-2 align-top text-xs text-gray-600">
                  <span className="block truncate" title={sourceText}>{sourceText}</span>
                </td>
                <td className="px-3 py-2 align-top">
                  <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${badgeClass}`}>
                    {badgeText || tone}
                  </span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export default function MassEmailComposer() {
  const { showToast } = useToast();
  const htmlTextareaRef = useRef<HTMLTextAreaElement | null>(null);
  const visualEditorRef = useRef<HTMLDivElement | null>(null);
  const [activeComposerTab, setActiveComposerTab] = useState<ComposerTab>('compose');
  const [editorMode, setEditorMode] = useState<EditorMode>('visual');
  const [subject, setSubject] = useState('');
  const [html, setHtml] = useState('<h2>Service Notice</h2>\n<p></p>');
  const [selectedUsernamesText, setSelectedUsernamesText] = useState('');
  const [recipientQuery, setRecipientQuery] = useState('');
  const [recipientResults, setRecipientResults] = useState<RecipientOption[]>([]);
  const [selectedRecipients, setSelectedRecipients] = useState<RecipientOption[]>([]);
  const [includeAllDomainUsers, setIncludeAllDomainUsers] = useState(false);
  const [groupQuery, setGroupQuery] = useState('');
  const [groupResults, setGroupResults] = useState<GroupOption[]>([]);
  const [selectedGroups, setSelectedGroups] = useState<GroupOption[]>([]);
  const [previewHtml, setPreviewHtml] = useState('');
  const [resolution, setResolution] = useState<ResolutionResponse | null>(null);
  const [selectedCampaignId, setSelectedCampaignId] = useState<string | null>(null);
  const [campaignDetailsById, setCampaignDetailsById] = useState<Record<string, MassEmailCampaign>>({});
  const [loadingCampaignId, setLoadingCampaignId] = useState<string | null>(null);
  const [campaignAudienceQuery, setCampaignAudienceQuery] = useState('');
  const [campaignAudienceFilter, setCampaignAudienceFilter] = useState<CampaignAudienceFilter>('all');
  const [dryRunQuery, setDryRunQuery] = useState('');
  const [editingCampaignId, setEditingCampaignId] = useState<string | null>(null);
  const [testEmail, setTestEmail] = useState('');
  const [isWorking, setIsWorking] = useState(false);
  const [isSearchingRecipients, setIsSearchingRecipients] = useState(false);
  const [isSearchingGroups, setIsSearchingGroups] = useState(false);
  const [hasSearchedRecipients, setHasSearchedRecipients] = useState(false);
  const [hasSearchedGroups, setHasSearchedGroups] = useState(false);

  const manualUsernames = useMemo(() => parseUsernames(selectedUsernamesText), [selectedUsernamesText]);
  const targetUsernames = useMemo(() => (
    uniqueUsernames([...manualUsernames, ...selectedRecipients.map((recipient) => recipient.username)])
  ), [manualUsernames, selectedRecipients]);

  const audienceSummary = useMemo(() => {
    const parts = [];
    if (includeAllDomainUsers) parts.push('All AD users');
    if (targetUsernames.length > 0) parts.push(`${targetUsernames.length} recipients`);
    if (selectedGroups.length > 0) parts.push(`${selectedGroups.length} groups`);
    return parts.length > 0 ? parts.join(' + ') : 'No audience selected';
  }, [includeAllDomainUsers, selectedGroups.length, targetUsernames.length]);

  const targets = useMemo(() => ({
    selectedUsernames: targetUsernames,
    selectedGroups: selectedGroups.map((group) => ({ dn: group.dn, name: group.name })),
    includeAllDomainUsers,
  }), [includeAllDomainUsers, selectedGroups, targetUsernames]);

  const dryRunCandidates = useMemo(() => {
    if (!resolution) return [];
    return resolution.candidates?.length > 0 ? resolution.candidates : [...resolution.recipients, ...resolution.skipped];
  }, [resolution]);
  const filteredDryRunCandidates = useMemo(() => {
    const query = dryRunQuery.trim().toLowerCase();
    return dryRunCandidates.filter((item) => resolutionItemMatches(item, query));
  }, [dryRunCandidates, dryRunQuery]);
  const filteredDryRunRecipients = useMemo(() => {
    const query = dryRunQuery.trim().toLowerCase();
    return (resolution?.recipients || []).filter((item) => resolutionItemMatches(item, query));
  }, [dryRunQuery, resolution?.recipients]);
  const filteredDryRunSkipped = useMemo(() => {
    const query = dryRunQuery.trim().toLowerCase();
    return (resolution?.skipped || []).filter((item) => resolutionItemMatches(item, query));
  }, [dryRunQuery, resolution?.skipped]);

  useEffect(() => {
    if (editorMode !== 'visual') return;
    const editor = visualEditorRef.current;
    if (editor && editor.innerHTML !== html) {
      editor.innerHTML = html;
    }
  }, [editorMode, html]);

  const syncHtmlFromVisualEditor = useCallback(() => {
    const nextHtml = visualEditorRef.current?.innerHTML || '<p></p>';
    setHtml(nextHtml);
  }, []);

  const applyVisualCommand = useCallback((command: string, value?: string) => {
    const editor = visualEditorRef.current;
    if (!editor) return;
    editor.focus();
    document.execCommand(command, false, value);
    syncHtmlFromVisualEditor();
  }, [syncHtmlFromVisualEditor]);

  const replaceHtmlRange = (start: number, end: number, replacement: string, selectionStart: number, selectionEnd: number) => {
    setHtml((currentHtml) => `${currentHtml.slice(0, start)}${replacement}${currentHtml.slice(end)}`);
    window.requestAnimationFrame(() => {
      htmlTextareaRef.current?.focus();
      htmlTextareaRef.current?.setSelectionRange(selectionStart, selectionEnd);
    });
  };

  const wrapHtmlSelection = (before: string, after: string, fallback: string) => {
    const textarea = htmlTextareaRef.current;
    const start = textarea?.selectionStart ?? html.length;
    const end = textarea?.selectionEnd ?? html.length;
    const selectedText = html.slice(start, end) || fallback;
    const replacement = `${before}${selectedText}${after}`;
    const nextSelectionStart = start + before.length;
    const nextSelectionEnd = nextSelectionStart + selectedText.length;
    replaceHtmlRange(start, end, replacement, nextSelectionStart, nextSelectionEnd);
  };

  const applyEditorFormat = (before: string, after: string, fallback: string, visualCommand: string, visualValue?: string) => {
    if (editorMode === 'visual') {
      applyVisualCommand(visualCommand, visualValue);
      return;
    }
    wrapHtmlSelection(before, after, fallback);
  };

  const insertHtmlList = () => {
    if (editorMode === 'visual') {
      applyVisualCommand('insertUnorderedList');
      return;
    }

    const textarea = htmlTextareaRef.current;
    const start = textarea?.selectionStart ?? html.length;
    const end = textarea?.selectionEnd ?? html.length;
    const selectedText = html.slice(start, end) || 'List item';
    const items = selectedText
      .split(/\n+/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => `  <li>${line}</li>`)
      .join('\n');
    const replacement = `<ul>\n${items}\n</ul>`;
    replaceHtmlRange(start, end, replacement, start, start + replacement.length);
  };

  const insertHtmlLink = () => {
    const url = window.prompt('Link URL');
    if (url === null) return;
    const trimmedUrl = url.trim();
    if (!/^(https?:\/\/|mailto:)/i.test(trimmedUrl)) {
      showToast('Use an http, https, or mailto link', 'error');
      return;
    }

    if (editorMode === 'visual') {
      applyVisualCommand('createLink', trimmedUrl);
      return;
    }

    wrapHtmlSelection(`<a href="${trimmedUrl.replace(/"/g, '%22')}">`, '</a>', 'link text');
  };

  const applyFontFamily = (fontFamily: string) => {
    if (!fontFamily) return;
    applyEditorFormat(`<span style="font-family: ${fontFamily};">`, '</span>', 'Text', 'fontName', fontFamily);
  };

  const applyFontSize = (fontSize: string) => {
    if (!fontSize) return;
    const visualSize = fontSize === '12px' ? '2' : fontSize === '20px' ? '4' : fontSize === '28px' ? '5' : '3';
    applyEditorFormat(`<span style="font-size: ${fontSize};">`, '</span>', 'Text', 'fontSize', visualSize);
  };

  const applyTextColor = (color: string) => {
    if (!color) return;
    applyEditorFormat(`<span style="color: ${color};">`, '</span>', 'Text', 'foreColor', color);
  };

  const handleHtmlKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    const shortcutKey = event.key.toLowerCase();
    if (!(event.ctrlKey || event.metaKey)) return;

    if (shortcutKey === 'b') {
      event.preventDefault();
      wrapHtmlSelection('<strong>', '</strong>', 'bold text');
    } else if (shortcutKey === 'i') {
      event.preventDefault();
      wrapHtmlSelection('<em>', '</em>', 'italic text');
    } else if (shortcutKey === 'u') {
      event.preventDefault();
      wrapHtmlSelection('<u>', '</u>', 'underlined text');
    }
  };

  const rememberCampaignDetail = useCallback((campaign: MassEmailCampaign | null | undefined) => {
    if (!campaign?.id) return;
    setCampaignDetailsById((current) => ({ ...current, [campaign.id]: campaign }));
  }, []);

  const fetchCampaigns = useCallback(async () => {
    const response = await fetchWithCsrf('/api/admin/mass-email');
    if (!response.ok) throw new Error('Failed to load mass email campaigns');
    return await response.json() as CampaignsResponse;
  }, []);

  const { data: campaignsData, isLoading, refresh, lastUpdated } = usePolling(fetchCampaigns, {
    interval: 15000,
    onError: (error) => console.error('Mass email polling failed:', error),
  });

  const campaigns = campaignsData?.campaigns || [];
  const effectiveSelectedCampaignId = selectedCampaignId || campaignsData?.selectedCampaign?.id || campaigns[0]?.id || null;
  const selectedCampaignSummary = campaigns.find((campaign) => campaign.id === effectiveSelectedCampaignId) || null;
  const selectedCampaignDetail = effectiveSelectedCampaignId ? campaignDetailsById[effectiveSelectedCampaignId] || null : null;
  const selectedCampaign = selectedCampaignDetail || selectedCampaignSummary || null;
  const selectedCampaignHasDetail = Boolean(selectedCampaignDetail);
  const isSelectedCampaignDetailLoading = loadingCampaignId === effectiveSelectedCampaignId && !selectedCampaignHasDetail;
  const selectedCampaignAudience = useMemo(() => campaignAudienceRows(selectedCampaign), [selectedCampaign]);
  const campaignAudienceCounts = useMemo(() => ({
    all: selectedCampaignAudience.length,
    eligible: selectedCampaignAudience.filter((row) => row.type === 'eligible').length,
    skipped: selectedCampaignAudience.filter((row) => row.type === 'skipped').length,
    sent: selectedCampaignAudience.filter((row) => row.status === 'sent').length,
    failed: selectedCampaignAudience.filter((row) => row.status === 'failed').length,
  }), [selectedCampaignAudience]);
  const filteredCampaignAudience = useMemo(() => {
    const query = campaignAudienceQuery.trim().toLowerCase();
    return selectedCampaignAudience.filter((row) => {
      const matchesFilter = campaignAudienceFilter === 'all'
        || (campaignAudienceFilter === 'eligible' && row.type === 'eligible')
        || (campaignAudienceFilter === 'skipped' && row.type === 'skipped')
        || row.status === campaignAudienceFilter;
      return matchesFilter && campaignAudienceMatches(row, query);
    });
  }, [campaignAudienceFilter, campaignAudienceQuery, selectedCampaignAudience]);

  useEffect(() => {
    rememberCampaignDetail(campaignsData?.selectedCampaign);
  }, [campaignsData?.selectedCampaign, rememberCampaignDetail]);

  const fetchCampaignDetail = useCallback(async (campaignId: string) => {
    setLoadingCampaignId(campaignId);
    try {
      const response = await fetchWithCsrf(`/api/admin/mass-email/${encodeURIComponent(campaignId)}`);
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Failed to load campaign details');
      rememberCampaignDetail(data.campaign as MassEmailCampaign);
    } catch (error) {
      console.error('Failed to load mass email campaign details:', error);
    } finally {
      setLoadingCampaignId((current) => current === campaignId ? null : current);
    }
  }, [rememberCampaignDetail]);

  useEffect(() => {
    if (
      !effectiveSelectedCampaignId ||
      campaignDetailsById[effectiveSelectedCampaignId] ||
      loadingCampaignId === effectiveSelectedCampaignId
    ) return;
    void fetchCampaignDetail(effectiveSelectedCampaignId);
  }, [campaignDetailsById, effectiveSelectedCampaignId, fetchCampaignDetail, loadingCampaignId]);

  const selectCampaign = (campaignId: string) => {
    setSelectedCampaignId(campaignId);
    if (!campaignDetailsById[campaignId]) {
      void fetchCampaignDetail(campaignId);
    }
  };

  const callJson = async (url: string, body: Record<string, unknown>, method = 'POST') => {
    const response = await fetchWithCsrf(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || 'Request failed');
    return data;
  };

  const searchGroups = async () => {
    if (groupQuery.trim().length < 2) {
      showToast('Enter at least 2 characters to search groups', 'error');
      return;
    }
    setIsSearchingGroups(true);
    setHasSearchedGroups(true);
    try {
      const response = await fetchWithCsrf(`/api/admin/groups?q=${encodeURIComponent(groupQuery.trim())}`);
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Group search failed');
      setGroupResults(data.groups || []);
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Group search failed', 'error');
    } finally {
      setIsSearchingGroups(false);
    }
  };

  const searchRecipients = async () => {
    const query = recipientQuery.trim();
    if (query.length < 2) {
      showToast('Enter at least 2 characters to search recipients', 'error');
      return;
    }

    setIsSearchingRecipients(true);
    setHasSearchedRecipients(true);
    try {
      const response = await fetchWithCsrf(`/api/admin/users?q=${encodeURIComponent(query)}&limit=12`);
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Recipient search failed');
      const queryLower = query.toLowerCase();
      const users = ((data.users || []) as RecipientOption[])
        .filter((user) => [user.username, user.displayName || '', user.email || ''].some((value) => value.toLowerCase().includes(queryLower)))
        .slice(0, 12);
      setRecipientResults(users);
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Recipient search failed', 'error');
    } finally {
      setIsSearchingRecipients(false);
    }
  };

  const addRecipient = (recipient: RecipientOption) => {
    const username = recipient.username.trim();
    if (!username) return;
    const exists = targetUsernames.some((selectedUsername) => normalizeUsername(selectedUsername) === normalizeUsername(username));
    if (exists) {
      showToast('Recipient already selected', 'error');
      return;
    }
    setSelectedRecipients((current) => [...current, recipient]);
  };

  const removeRecipient = (username: string) => {
    setSelectedRecipients((current) => current.filter((recipient) => normalizeUsername(recipient.username) !== normalizeUsername(username)));
  };

  const addGroup = (group: GroupOption) => {
    setSelectedGroups((current) => current.some((item) => item.dn === group.dn) ? current : [...current, group]);
  };

  const runPreview = async () => {
    setIsWorking(true);
    try {
      const data = await callJson('/api/admin/mass-email/preview', { subject, html });
      setPreviewHtml(data.preview.html);
      showToast('Preview refreshed', 'success');
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Preview failed', 'error');
    } finally {
      setIsWorking(false);
    }
  };

  const runDryRun = async () => {
    setIsWorking(true);
    try {
      const data = await callJson('/api/admin/mass-email/resolve', { targets });
      setResolution(data.resolution);
      showToast(`Resolved ${data.resolution.summary.eligibleRecipients} recipients`, 'success');
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Recipient dry run failed', 'error');
    } finally {
      setIsWorking(false);
    }
  };

  const createDraft = async () => {
    setIsWorking(true);
    try {
      const data = await callJson('/api/admin/mass-email', { subject, html, targets });
      rememberCampaignDetail(data.campaign as MassEmailCampaign);
      setSelectedCampaignId(data.campaign.id);
      setEditingCampaignId(null);
      setActiveComposerTab('campaigns');
      showToast('Mass email draft created', 'success');
      await refresh();
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Draft creation failed', 'error');
    } finally {
      setIsWorking(false);
    }
  };

  const updateDraft = async () => {
    if (!editingCampaignId) return;
    setIsWorking(true);
    try {
      const data = await callJson(`/api/admin/mass-email/${editingCampaignId}`, { subject, html, targets }, 'PUT');
      rememberCampaignDetail(data.campaign as MassEmailCampaign);
      setSelectedCampaignId(data.campaign.id);
      setEditingCampaignId(null);
      setActiveComposerTab('campaigns');
      showToast('Mass email draft updated', 'success');
      await refresh();
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Draft update failed', 'error');
    } finally {
      setIsWorking(false);
    }
  };

  const quickSend = async () => {
    const countText = resolution ? `${resolution.summary.eligibleRecipients} resolved recipients` : 'the resolved recipient audience';
    if (!window.confirm(`Start quick-send to ${countText}?`)) return;
    setIsWorking(true);
    try {
      const data = await callJson('/api/admin/mass-email/quick-send', { subject, html, targets });
      rememberCampaignDetail(data.campaign as MassEmailCampaign);
      setSelectedCampaignId(data.campaign.id);
      setEditingCampaignId(null);
      setActiveComposerTab('campaigns');
      showToast('Quick-send started', 'success');
      await refresh();
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Quick-send failed', 'error');
    } finally {
      setIsWorking(false);
    }
  };

  const sendTest = async () => {
    setIsWorking(true);
    try {
      await callJson('/api/admin/mass-email/test', { to: testEmail, subject, html });
      showToast('Test email sent', 'success');
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Test email failed', 'error');
    } finally {
      setIsWorking(false);
    }
  };

  const campaignAction = async (campaignId: string, action: 'activate' | 'process' | 'cancel') => {
    setIsWorking(true);
    try {
      const data = await callJson(`/api/admin/mass-email/${campaignId}/${action}`, {});
      if (data.campaign) {
        rememberCampaignDetail(data.campaign as MassEmailCampaign);
      } else {
        await fetchCampaignDetail(campaignId);
      }
      showToast(`Campaign ${action} complete`, 'success');
      await refresh();
    } catch (error) {
      showToast(error instanceof Error ? error.message : `Campaign ${action} failed`, 'error');
    } finally {
      setIsWorking(false);
    }
  };

  const loadDraftForEditing = (campaign: MassEmailCampaign) => {
    if (campaign.status !== 'draft') return;
    const targetsSnapshot = campaign.targetSnapshot?.targets;
    setEditingCampaignId(campaign.id);
    setSubject(campaign.subject);
    setHtml(stripPortalFooter(campaign.html || ''));
    setPreviewHtml(campaign.html || '');
    setSelectedUsernamesText((targetsSnapshot?.selectedUsernames || []).join(', '));
    setSelectedRecipients([]);
    setIncludeAllDomainUsers(Boolean(targetsSnapshot?.includeAllDomainUsers));
    setSelectedGroups((targetsSnapshot?.selectedGroups || []).map((group) => ({ dn: group.dn, name: group.name || group.dn })));
    setResolution(null);
    setDryRunQuery('');
    setEditorMode('visual');
    setActiveComposerTab('compose');
  };

  const cancelDraftEdit = () => {
    setEditingCampaignId(null);
    setActiveComposerTab('campaigns');
  };

  return (
    <Tabs value={activeComposerTab} onValueChange={(value) => setActiveComposerTab(value as ComposerTab)} className="space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <TabsList>
          <TabsTrigger value="compose">Compose</TabsTrigger>
          <TabsTrigger value="campaigns">Campaigns</TabsTrigger>
        </TabsList>
        <div className="rounded-full border bg-gray-50 px-3 py-1 text-xs font-medium text-gray-600">
          {audienceSummary}
        </div>
      </div>

      <TabsContent value="compose" className="space-y-6">
        <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(340px,420px)] xl:items-start">
          <div className="space-y-5">
            <section className="space-y-4">
              {editingCampaignId && (
                <div className="flex flex-col gap-2 rounded-md border border-blue-200 bg-blue-50 px-3 py-2 text-sm text-blue-900 sm:flex-row sm:items-center sm:justify-between">
                  <span>Editing draft {selectedCampaign?.subject ? `for ${selectedCampaign.subject}` : ''}</span>
                  <Button type="button" variant="outline" size="sm" onClick={cancelDraftEdit}>
                    Cancel Edit
                  </Button>
                </div>
              )}

              <div className="space-y-2">
                <label className="block text-sm font-medium text-gray-700" htmlFor="mass-email-subject">Subject</label>
                <input
                  id="mass-email-subject"
                  value={subject}
                  onChange={(event) => setSubject(event.target.value)}
                  className="w-full rounded-md border px-3 py-2 focus:outline-hidden focus:ring-2 focus:ring-blue-500"
                  maxLength={500}
                />
              </div>

              <div className="space-y-2">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                  <label className="block text-sm font-medium text-gray-700" htmlFor={editorMode === 'html' ? 'mass-email-html' : 'mass-email-visual-editor'}>Message</label>
                  <div className="inline-flex rounded-md border bg-white p-1 text-xs">
                    <button
                      type="button"
                      onClick={() => setEditorMode('visual')}
                      className={`inline-flex items-center gap-1 rounded-sm px-2 py-1 font-medium ${editorMode === 'visual' ? 'bg-blue-50 text-blue-800' : 'text-gray-600 hover:bg-gray-50'}`}
                      aria-pressed={editorMode === 'visual'}
                    >
                      <Edit3 className="h-3.5 w-3.5" /> Editor
                    </button>
                    <button
                      type="button"
                      onClick={() => setEditorMode('html')}
                      className={`inline-flex items-center gap-1 rounded-sm px-2 py-1 font-medium ${editorMode === 'html' ? 'bg-blue-50 text-blue-800' : 'text-gray-600 hover:bg-gray-50'}`}
                      aria-pressed={editorMode === 'html'}
                    >
                      <Code2 className="h-3.5 w-3.5" /> HTML
                    </button>
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-1 rounded-md border bg-gray-50 p-1">
                  <Button type="button" size="icon-sm" variant="ghost" onClick={() => applyEditorFormat('<strong>', '</strong>', 'bold text', 'bold')} title="Bold (Ctrl+B)" aria-label="Bold">
                    <Bold className="h-4 w-4" />
                  </Button>
                  <Button type="button" size="icon-sm" variant="ghost" onClick={() => applyEditorFormat('<em>', '</em>', 'italic text', 'italic')} title="Italic (Ctrl+I)" aria-label="Italic">
                    <Italic className="h-4 w-4" />
                  </Button>
                  <Button type="button" size="icon-sm" variant="ghost" onClick={() => applyEditorFormat('<u>', '</u>', 'underlined text', 'underline')} title="Underline (Ctrl+U)" aria-label="Underline">
                    <Underline className="h-4 w-4" />
                  </Button>
                  <div className="mx-1 h-6 w-px bg-gray-200" />
                  <Button type="button" size="icon-sm" variant="ghost" onClick={() => applyEditorFormat('<h2>', '</h2>', 'Heading', 'formatBlock', 'h2')} title="Heading" aria-label="Heading">
                    <Heading2 className="h-4 w-4" />
                  </Button>
                  <Button type="button" size="icon-sm" variant="ghost" onClick={() => applyEditorFormat('<p>', '</p>', 'Paragraph text', 'formatBlock', 'p')} title="Paragraph" aria-label="Paragraph">
                    <Pilcrow className="h-4 w-4" />
                  </Button>
                  <Button type="button" size="icon-sm" variant="ghost" onClick={insertHtmlList} title="Bulleted list" aria-label="Bulleted list">
                    <List className="h-4 w-4" />
                  </Button>
                  <Button type="button" size="icon-sm" variant="ghost" onClick={insertHtmlLink} title="Link" aria-label="Link">
                    <Link className="h-4 w-4" />
                  </Button>
                  <div className="mx-1 h-6 w-px bg-gray-200" />
                  <label className="inline-flex h-8 items-center gap-1 rounded-md border bg-white px-2 text-xs text-gray-600">
                    <Type className="h-3.5 w-3.5" />
                    <select
                      value=""
                      onChange={(event) => {
                        applyFontFamily(event.target.value);
                      }}
                      className="bg-transparent text-xs outline-none"
                      aria-label="Font family"
                    >
                      <option value="">Font</option>
                      <option value="Arial, sans-serif">Arial</option>
                      <option value="Georgia, serif">Georgia</option>
                      <option value="Verdana, sans-serif">Verdana</option>
                      <option value="Courier New, monospace">Mono</option>
                    </select>
                  </label>
                  <select
                    value=""
                    onChange={(event) => {
                      applyFontSize(event.target.value);
                    }}
                    className="h-8 rounded-md border bg-white px-2 text-xs text-gray-600 outline-none"
                    aria-label="Font size"
                  >
                    <option value="">Size</option>
                    <option value="12px">Small</option>
                    <option value="16px">Normal</option>
                    <option value="20px">Large</option>
                    <option value="28px">XL</option>
                  </select>
                  <input
                    type="color"
                    className="h-8 w-9 rounded-md border bg-white p-1"
                    title="Text color"
                    aria-label="Text color"
                    onChange={(event) => applyTextColor(event.target.value)}
                  />
                </div>
                {editorMode === 'visual' ? (
                  <div
                    ref={visualEditorRef}
                    id="mass-email-visual-editor"
                    role="textbox"
                    aria-multiline="true"
                    contentEditable
                    suppressContentEditableWarning
                    onInput={syncHtmlFromVisualEditor}
                    onBlur={syncHtmlFromVisualEditor}
                    className="min-h-96 w-full overflow-auto rounded-md border bg-white px-4 py-3 text-sm leading-6 focus:outline-hidden focus:ring-2 focus:ring-blue-500"
                  />
                ) : (
                  <textarea
                    ref={htmlTextareaRef}
                    id="mass-email-html"
                    value={html}
                    onChange={(event) => setHtml(event.target.value)}
                    onKeyDown={handleHtmlKeyDown}
                    className="min-h-96 w-full rounded-md border px-3 py-2 font-mono text-sm focus:outline-hidden focus:ring-2 focus:ring-blue-500"
                  />
                )}
              </div>
            </section>

            <section className="rounded-lg border bg-gray-50/70 p-4">
              <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <h3 className="flex items-center gap-2 text-sm font-semibold text-gray-900">
                    <Users className="h-4 w-4" /> Audience
                  </h3>
                  <p className="text-xs text-gray-500">{audienceSummary}</p>
                </div>
                <label className="flex items-center gap-2 text-sm text-gray-700">
                  <input
                    type="checkbox"
                    checked={includeAllDomainUsers}
                    onChange={(event) => setIncludeAllDomainUsers(event.target.checked)}
                    className="h-4 w-4 rounded border-gray-300"
                  />
                  All configured AD users
                </label>
              </div>

              <Tabs defaultValue="recipients" className="space-y-4">
                <TabsList>
                  <TabsTrigger value="recipients">Recipients</TabsTrigger>
                  <TabsTrigger value="groups">Groups</TabsTrigger>
                </TabsList>

                <TabsContent value="recipients" className="space-y-4">
                  <div className="flex gap-2">
                    <input
                      value={recipientQuery}
                      onChange={(event) => {
                        setRecipientQuery(event.target.value);
                        setHasSearchedRecipients(false);
                      }}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') {
                          event.preventDefault();
                          searchRecipients();
                        }
                      }}
                      className="min-w-0 flex-1 rounded-md border bg-white px-3 py-2 text-sm focus:outline-hidden focus:ring-2 focus:ring-blue-500"
                      placeholder="Search username, name, or email"
                    />
                    <Button type="button" variant="outline" onClick={searchRecipients} disabled={isSearchingRecipients} aria-label="Search recipients">
                      <Search className="h-4 w-4" />
                    </Button>
                  </div>

                  <div className="max-h-44 space-y-2 overflow-y-auto">
                    {isSearchingRecipients && (
                      <p className="rounded-md border border-dashed bg-white px-3 py-4 text-center text-sm text-gray-500">Searching recipients...</p>
                    )}
                    {recipientResults.map((recipient) => (
                      <button
                        key={recipient.dn || recipient.username}
                        type="button"
                        onClick={() => addRecipient(recipient)}
                        className="block w-full rounded-md border bg-white px-3 py-2 text-left text-sm hover:bg-gray-50"
                      >
                        <span className="font-medium text-gray-900">{recipient.displayName || recipient.username}</span>
                        <span className="block truncate text-xs text-gray-500">
                          {recipient.username}{recipient.email ? ` · ${recipient.email}` : ''}
                        </span>
                      </button>
                    ))}
                    {!isSearchingRecipients && hasSearchedRecipients && recipientResults.length === 0 && (
                      <p className="rounded-md border border-dashed bg-white px-3 py-4 text-center text-sm text-gray-500">No recipients found.</p>
                    )}
                  </div>

                  <div className="flex flex-wrap gap-2">
                    {selectedRecipients.map((recipient) => (
                      <span key={recipient.username} className="inline-flex items-center gap-1 rounded-full bg-blue-50 px-2 py-1 text-xs font-medium text-blue-800">
                        {recipient.displayName || recipient.username}
                        <button type="button" onClick={() => removeRecipient(recipient.username)} aria-label={`Remove ${recipient.username}`}>
                          <XCircle className="h-3 w-3" />
                        </button>
                      </span>
                    ))}
                  </div>

                  <div className="space-y-2">
                    <label className="block text-xs font-medium uppercase tracking-wide text-gray-500" htmlFor="mass-email-usernames">Manual recipients</label>
                    <textarea
                      id="mass-email-usernames"
                      value={selectedUsernamesText}
                      onChange={(event) => setSelectedUsernamesText(event.target.value)}
                      placeholder="username1, user@cpp.edu"
                      className="min-h-20 w-full rounded-md border bg-white px-3 py-2 text-sm focus:outline-hidden focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                </TabsContent>

                <TabsContent value="groups" className="space-y-4">
                  <div className="flex gap-2">
                    <input
                      value={groupQuery}
                      onChange={(event) => {
                        setGroupQuery(event.target.value);
                        setHasSearchedGroups(false);
                      }}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') {
                          event.preventDefault();
                          searchGroups();
                        }
                      }}
                      className="min-w-0 flex-1 rounded-md border bg-white px-3 py-2 text-sm focus:outline-hidden focus:ring-2 focus:ring-blue-500"
                      placeholder="Search AD groups"
                    />
                    <Button type="button" variant="outline" onClick={searchGroups} disabled={isSearchingGroups} aria-label="Search groups">
                      <Search className="h-4 w-4" />
                    </Button>
                  </div>
                  <div className="max-h-44 space-y-2 overflow-y-auto">
                    {isSearchingGroups && (
                      <p className="rounded-md border border-dashed bg-white px-3 py-4 text-center text-sm text-gray-500">Searching groups...</p>
                    )}
                    {groupResults.map((group) => (
                      <button
                        key={group.dn}
                        type="button"
                        onClick={() => addGroup(group)}
                        className="block w-full rounded-md border bg-white px-3 py-2 text-left text-sm hover:bg-gray-50"
                      >
                        <span className="font-medium text-gray-900">{group.name}</span>
                        <span className="block truncate text-xs text-gray-500">{group.description || group.dn}</span>
                      </button>
                    ))}
                    {!isSearchingGroups && hasSearchedGroups && groupResults.length === 0 && (
                      <p className="rounded-md border border-dashed bg-white px-3 py-4 text-center text-sm text-gray-500">No groups found.</p>
                    )}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {selectedGroups.map((group) => (
                      <span key={group.dn} className="inline-flex items-center gap-1 rounded-full bg-blue-50 px-2 py-1 text-xs font-medium text-blue-800">
                        {group.name}
                        <button type="button" onClick={() => setSelectedGroups((current) => current.filter((item) => item.dn !== group.dn))} aria-label={`Remove ${group.name}`}>
                          <XCircle className="h-3 w-3" />
                        </button>
                      </span>
                    ))}
                  </div>
                </TabsContent>
              </Tabs>
            </section>
          </div>

          <aside className="space-y-4 xl:sticky xl:top-4">
            <section className="rounded-lg border bg-white p-4 shadow-sm">
              <div className="mb-3 flex items-center justify-between gap-3">
                <h3 className="font-semibold text-gray-900">Review</h3>
                <span className="text-xs text-gray-500">Sandboxed preview</span>
              </div>

              <iframe
                title="Mass email preview"
                sandbox=""
                srcDoc={previewHtml || '<p style="font-family:Arial,sans-serif;color:#6b7280;">Preview pending.</p>'}
                className="h-104 w-full rounded-md border bg-white"
              />

              <div className="mt-4 grid grid-cols-2 gap-2">
                <Button type="button" variant="outline" onClick={runPreview} disabled={isWorking} className="gap-2">
                  <Eye className="h-4 w-4" /> Preview
                </Button>
                <Button type="button" variant="outline" onClick={runDryRun} disabled={isWorking} className="gap-2">
                  <Users className="h-4 w-4" /> Dry Run
                </Button>
              </div>
            </section>

            <section className="rounded-lg border bg-white p-4 shadow-sm">
              <h3 className="mb-3 font-semibold text-gray-900">Send</h3>
              <div className="flex flex-col gap-2">
                <div className="flex flex-col gap-2 sm:flex-row xl:flex-col">
                  <input
                    value={testEmail}
                    onChange={(event) => setTestEmail(event.target.value)}
                    className="min-w-0 flex-1 rounded-md border px-3 py-2 text-sm focus:outline-hidden focus:ring-2 focus:ring-blue-500"
                    placeholder="test@example.edu"
                  />
                  <Button type="button" variant="outline" onClick={sendTest} disabled={isWorking || !testEmail} className="gap-2">
                    <Send className="h-4 w-4" /> Test
                  </Button>
                </div>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-1">
                  <Button type="button" onClick={editingCampaignId ? updateDraft : createDraft} disabled={isWorking} className="gap-2">
                    <Mail className="h-4 w-4" /> {editingCampaignId ? 'Save Changes' : 'Save Draft'}
                  </Button>
                  <Button type="button" onClick={quickSend} disabled={isWorking || Boolean(editingCampaignId)} className="gap-2 bg-red-600 text-white hover:bg-red-700">
                    <Send className="h-4 w-4" /> Quick Send
                  </Button>
                </div>
              </div>
            </section>
          </aside>
        </div>

        <section className="rounded-lg border bg-white p-4 shadow-sm">
          <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <h3 className="font-semibold text-gray-900">Dry Run</h3>
              {resolution && (
                <p className="text-xs text-gray-500">
                  Showing resolved audience details from the latest dry run
                </p>
              )}
            </div>
            {resolution && (
              <div className="relative w-full lg:max-w-md">
                <Search className="absolute left-3 top-2.5 h-4 w-4 text-gray-400" />
                <input
                  value={dryRunQuery}
                  onChange={(event) => setDryRunQuery(event.target.value)}
                  className="w-full rounded-md border bg-white py-2 pl-9 pr-3 text-sm focus:outline-hidden focus:ring-2 focus:ring-blue-500"
                  placeholder="Search name, email, username, source, or reason"
                />
              </div>
            )}
          </div>

          {resolution ? (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3 text-sm md:grid-cols-4">
                <div className="rounded-md border p-3"><p className="text-gray-500">Candidates</p><p className="font-semibold">{resolution.summary.totalCandidates}</p></div>
                <div className="rounded-md border p-3"><p className="text-gray-500">Eligible</p><p className="font-semibold text-green-700">{resolution.summary.eligibleRecipients}</p></div>
                <div className="rounded-md border p-3"><p className="text-gray-500">Skipped</p><p className="font-semibold text-red-700">{resolution.summary.skippedRecipients}</p></div>
                <div className="rounded-md border p-3"><p className="text-gray-500">Merged</p><p className="font-semibold">{resolution.summary.duplicateSourcesMerged}</p></div>
              </div>

              <Tabs defaultValue="candidates" className="space-y-3">
                <TabsList className="grid w-full grid-cols-3 lg:w-auto lg:inline-grid">
                  <TabsTrigger value="candidates" className="gap-2">
                    Candidates <span className="text-[11px] text-gray-500">{filteredDryRunCandidates.length}/{dryRunCandidates.length}</span>
                  </TabsTrigger>
                  <TabsTrigger value="eligible" className="gap-2">
                    Eligible <span className="text-[11px] text-gray-500">{filteredDryRunRecipients.length}/{resolution.recipients.length}</span>
                  </TabsTrigger>
                  <TabsTrigger value="skipped" className="gap-2">
                    Skipped <span className="text-[11px] text-gray-500">{filteredDryRunSkipped.length}/{resolution.skipped.length}</span>
                  </TabsTrigger>
                </TabsList>
                <TabsContent value="candidates">
                  <DryRunRecipientList
                    items={filteredDryRunCandidates}
                    emptyMessage={dryRunQuery.trim() ? 'No candidates match the current search.' : 'No candidates resolved.'}
                    tone="candidate"
                  />
                </TabsContent>
                <TabsContent value="eligible">
                  <DryRunRecipientList
                    items={filteredDryRunRecipients}
                    emptyMessage={dryRunQuery.trim() ? 'No eligible recipients match the current search.' : 'No eligible recipients.'}
                    tone="eligible"
                  />
                </TabsContent>
                <TabsContent value="skipped">
                  <DryRunRecipientList
                    items={filteredDryRunSkipped}
                    emptyMessage={dryRunQuery.trim() ? 'No skipped recipients match the current search.' : 'No skipped recipients.'}
                    tone="skipped"
                  />
                </TabsContent>
              </Tabs>
            </div>
          ) : (
            <p className="rounded-md border border-dashed px-3 py-4 text-sm text-gray-500">Run a dry run to resolve the selected audience.</p>
          )}
        </section>
      </TabsContent>

      <TabsContent value="campaigns" className="space-y-4">
        <section className="rounded-lg border bg-white p-4 shadow-sm">
          <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h3 className="font-semibold text-gray-900">Campaigns</h3>
              <p className="text-xs text-gray-500">{lastUpdated ? `Updated ${lastUpdated.toLocaleTimeString()}` : 'Loading campaigns'}</p>
            </div>
            <Button type="button" variant="outline" onClick={refresh} disabled={isLoading} className="gap-2">
              <RefreshCw className="h-4 w-4" /> Refresh
            </Button>
          </div>

          <div className="grid grid-cols-1 gap-4 xl:grid-cols-[300px_minmax(0,1fr)]">
            <div className="max-h-136 space-y-2 overflow-y-auto">
              {campaigns.map((campaign) => (
                <button
                  key={campaign.id}
                  type="button"
                  onClick={() => selectCampaign(campaign.id)}
                  className={`w-full rounded-md border px-3 py-2 text-left ${effectiveSelectedCampaignId === campaign.id ? 'border-blue-300 bg-blue-50' : 'hover:bg-gray-50'}`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate text-sm font-medium text-gray-900">{campaign.subject}</span>
                    <span className={`rounded-full px-2 py-0.5 text-xs ${statusTone(campaign.status)}`}>{campaign.status}</span>
                  </div>
                  <p className="mt-1 text-xs text-gray-500">{campaign.sentCount}/{campaign.eligibleRecipients} sent</p>
                </button>
              ))}
              {campaigns.length === 0 && <p className="rounded-md border border-dashed px-3 py-6 text-center text-sm text-gray-500">No mass email campaigns yet.</p>}
            </div>

            <div className="min-w-0 space-y-4">
              {selectedCampaign ? (
                <>
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <h4 className="font-semibold text-gray-900">{selectedCampaign.subject}</h4>
                      <p className="text-sm text-gray-500">
                        {selectedCampaign.sentCount} sent, {selectedCampaign.failedCount} failed, {selectedCampaign.skippedRecipients} skipped
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {selectedCampaign.status === 'draft' && (
                        <>
                          <Button
                            type="button"
                            variant="outline"
                            onClick={() => loadDraftForEditing(selectedCampaign)}
                            disabled={isWorking || isSelectedCampaignDetailLoading || !selectedCampaign.html}
                            className="gap-2"
                          >
                            <Edit3 className="h-4 w-4" /> Edit Draft
                          </Button>
                          <Button type="button" onClick={() => campaignAction(selectedCampaign.id, 'activate')} disabled={isWorking} className="gap-2">
                            <Play className="h-4 w-4" /> Activate
                          </Button>
                        </>
                      )}
                      {selectedCampaign.status === 'active' && (
                        <Button type="button" variant="outline" onClick={() => campaignAction(selectedCampaign.id, 'process')} disabled={isWorking} className="gap-2">
                          <Play className="h-4 w-4" /> Process Batch
                        </Button>
                      )}
                      {(selectedCampaign.status === 'draft' || selectedCampaign.status === 'active') && (
                        <Button type="button" variant="outline" onClick={() => campaignAction(selectedCampaign.id, 'cancel')} disabled={isWorking} className="gap-2 text-red-700">
                          <XCircle className="h-4 w-4" /> Cancel
                        </Button>
                      )}
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
                    <div className="rounded-md border p-3"><p className="text-gray-500">Eligible</p><p className="font-semibold">{selectedCampaign.eligibleRecipients}</p></div>
                    <div className="rounded-md border p-3"><p className="text-gray-500">Sent</p><p className="font-semibold text-green-700">{selectedCampaign.sentCount}</p></div>
                    <div className="rounded-md border p-3"><p className="text-gray-500">Failed</p><p className="font-semibold text-red-700">{selectedCampaign.failedCount}</p></div>
                    <div className="rounded-md border p-3"><p className="text-gray-500">Skipped</p><p className="font-semibold">{selectedCampaign.skippedRecipients}</p></div>
                  </div>

                  <section className="rounded-md border">
                    <div className="flex flex-col gap-2 border-b px-3 py-3 sm:flex-row sm:items-center sm:justify-between">
                      <div>
                        <h5 className="text-sm font-semibold text-gray-900">Message</h5>
                        <p className="text-xs text-gray-500">{selectedCampaign.subject}</p>
                      </div>
                      <span className={`w-fit rounded-full px-2 py-0.5 text-xs ${statusTone(selectedCampaign.status)}`}>{selectedCampaign.status}</span>
                    </div>
                    {isSelectedCampaignDetailLoading ? (
                      <p className="px-3 py-4 text-sm text-gray-500">Loading campaign message...</p>
                    ) : selectedCampaign.html ? (
                      <iframe
                        title="Mass email campaign message"
                        sandbox=""
                        srcDoc={selectedCampaign.html}
                        className="h-80 w-full border-0 bg-white"
                      />
                    ) : (
                      <p className="px-3 py-4 text-sm text-gray-500">No message details loaded for this campaign.</p>
                    )}
                  </section>

                  <section className="rounded-md border">
                    <div className="space-y-3 border-b px-3 py-3">
                      <div className="flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
                        <div>
                          <h5 className="text-sm font-semibold text-gray-900">Audience</h5>
                          <p className="text-xs text-gray-500">
                            Showing {filteredCampaignAudience.length} of {selectedCampaignAudience.length} loaded audience records
                          </p>
                        </div>
                        <div className="relative w-full xl:max-w-sm">
                          <Search className="absolute left-3 top-2.5 h-4 w-4 text-gray-400" />
                          <input
                            value={campaignAudienceQuery}
                            onChange={(event) => setCampaignAudienceQuery(event.target.value)}
                            className="w-full rounded-md border bg-white py-2 pl-9 pr-3 text-sm focus:outline-hidden focus:ring-2 focus:ring-blue-500"
                            placeholder="Search name, email, username, source, or reason"
                          />
                        </div>
                      </div>

                      <div className="flex flex-wrap gap-2">
                        {([
                          ['all', 'All', campaignAudienceCounts.all],
                          ['eligible', 'Eligible', campaignAudienceCounts.eligible],
                          ['skipped', 'Skipped', campaignAudienceCounts.skipped],
                          ['sent', 'Sent', campaignAudienceCounts.sent],
                          ['failed', 'Failed', campaignAudienceCounts.failed],
                        ] as Array<[CampaignAudienceFilter, string, number]>).map(([filter, label, count]) => (
                          <button
                            key={filter}
                            type="button"
                            onClick={() => setCampaignAudienceFilter(filter)}
                            aria-pressed={campaignAudienceFilter === filter}
                            className={`inline-flex items-center gap-2 rounded-md border px-3 py-1.5 text-xs font-medium ${campaignAudienceFilter === filter ? 'border-blue-300 bg-blue-50 text-blue-800' : 'bg-white text-gray-700 hover:bg-gray-50'}`}
                          >
                            {label}
                            <span className="rounded-full bg-gray-100 px-1.5 py-0.5 text-[11px] text-gray-600">{count}</span>
                          </button>
                        ))}
                      </div>
                    </div>

                    {isSelectedCampaignDetailLoading ? (
                      <p className="px-3 py-4 text-sm text-gray-500">Loading campaign audience...</p>
                    ) : selectedCampaignAudience.length > 0 ? (
                      <div className="max-h-136 overflow-auto">
                        <table className="w-full min-w-[820px] text-left text-sm">
                          <thead className="sticky top-0 bg-gray-50 text-xs font-medium uppercase text-gray-500">
                            <tr>
                              <th scope="col" className="border-b px-3 py-2">Recipient</th>
                              <th scope="col" className="border-b px-3 py-2">Username</th>
                              <th scope="col" className="border-b px-3 py-2">Status</th>
                              <th scope="col" className="border-b px-3 py-2">Source</th>
                              <th scope="col" className="border-b px-3 py-2">Notes</th>
                            </tr>
                          </thead>
                          <tbody>
                            {filteredCampaignAudience.map((row) => (
                              <tr key={row.key} className="border-b last:border-b-0 hover:bg-gray-50/70">
                                <td className="max-w-[260px] px-3 py-2 align-top">
                                  <p className="truncate font-medium text-gray-900">{row.displayName || row.email || row.adUsername || 'Unknown recipient'}</p>
                                  {row.email && <p className="truncate text-xs text-gray-500">{row.email}</p>}
                                </td>
                                <td className="max-w-40 px-3 py-2 align-top text-xs text-gray-600">
                                  <span className="block truncate">{row.adUsername || '-'}</span>
                                </td>
                                <td className="px-3 py-2 align-top">
                                  <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${statusTone(row.status)}`}>
                                    {formatReason(row.status)}
                                  </span>
                                </td>
                                <td className="max-w-[220px] px-3 py-2 align-top text-xs text-gray-600">
                                  <span className="block truncate" title={row.sourceText}>{row.sourceText}</span>
                                </td>
                                <td className="max-w-60 px-3 py-2 align-top text-xs text-gray-600">
                                  <span className="block truncate" title={row.note || undefined}>{row.note || '-'}</span>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                        {filteredCampaignAudience.length === 0 && (
                          <p className="px-3 py-6 text-center text-sm text-gray-500">No audience records match the current filters.</p>
                        )}
                      </div>
                    ) : (
                      <p className="px-3 py-4 text-sm text-gray-500">No audience details loaded for this campaign.</p>
                    )}
                  </section>

                  <details className="rounded-md border">
                    <summary className="cursor-pointer px-3 py-2 text-sm font-medium text-gray-700">Activity log</summary>
                    <div className="border-t">
                      {isSelectedCampaignDetailLoading ? (
                        <p className="px-3 py-4 text-sm text-gray-500">Loading campaign activity...</p>
                      ) : (selectedCampaign.logs || []).length > 0 ? (
                        (selectedCampaign.logs || []).slice(0, 6).map((log) => (
                          <div key={log.id} className="flex items-start gap-2 border-b px-3 py-2 text-xs last:border-b-0">
                            {log.level === 'error' ? <XCircle className="mt-0.5 h-3 w-3 text-red-600" /> : <CheckCircle className="mt-0.5 h-3 w-3 text-green-600" />}
                            <div>
                              <p className="font-medium text-gray-900">{log.message}</p>
                              <p className="text-gray-500">{new Date(log.createdAt).toLocaleString()}</p>
                            </div>
                          </div>
                        ))
                      ) : (
                        <p className="px-3 py-4 text-sm text-gray-500">No activity recorded for this campaign.</p>
                      )}
                    </div>
                  </details>
                </>
              ) : (
                <p className="rounded-md border border-dashed px-3 py-8 text-center text-sm text-gray-500">Select a campaign to view progress.</p>
              )}
            </div>
          </div>
        </section>
      </TabsContent>
    </Tabs>
  );
}