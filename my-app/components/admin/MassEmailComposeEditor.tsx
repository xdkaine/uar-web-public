import type { Dispatch, SetStateAction } from 'react';
import { Bold, Code2, Edit3, Heading2, Italic, Link, List, Pilcrow, Type, Underline } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { EditorMode } from './MassEmailTypes';
import { useMassEmailEditorMechanics } from './MassEmailEditorMechanics';

interface MassEmailComposeEditorProps {
  editingCampaignId: string | null;
  editingCampaignSubject?: string;
  subject: string;
  html: string;
  editorMode: EditorMode;
  onCancelEdit: () => void;
  onSubjectChange: (value: string) => void;
  onEditorModeChange: (mode: EditorMode) => void;
  onHtmlChange: Dispatch<SetStateAction<string>>;
  showToast: (message: string, variant: 'success' | 'error' | 'warning') => void;
}

export function MassEmailComposeEditor({
  editingCampaignId,
  editingCampaignSubject,
  subject,
  html,
  editorMode,
  onCancelEdit,
  onSubjectChange,
  onEditorModeChange,
  onHtmlChange,
  showToast,
}: MassEmailComposeEditorProps) {
  const { htmlTextareaRef, visualEditorRef, syncHtmlFromVisualEditor, applyEditorFormat, insertHtmlList, insertHtmlLink, applyFontFamily, applyFontSize, applyTextColor, handleHtmlKeyDown } = useMassEmailEditorMechanics({ html, editorMode, setHtml: onHtmlChange, showToast });
  return (
    <section className="space-y-4">
      {editingCampaignId && (
        <div className="flex flex-col gap-2 rounded-md border border-blue-200 dark:border-blue-900 bg-blue-50 dark:bg-blue-950/40 px-3 py-2 text-sm text-blue-900 sm:flex-row sm:items-center sm:justify-between">
          <span>Editing draft {editingCampaignSubject ? `for ${editingCampaignSubject}` : ''}</span>
          <Button type="button" variant="outline" size="sm" onClick={onCancelEdit}>
            Cancel Edit
          </Button>
        </div>
      )}

      <div className="space-y-2">
        <label className="block text-sm font-medium text-muted-foreground" htmlFor="mass-email-subject">Subject</label>
        <input
          id="mass-email-subject"
          value={subject}
          onChange={(event) => onSubjectChange(event.target.value)}
          className="w-full rounded-md border px-3 py-2 focus:outline-hidden focus:ring-2 focus:ring-blue-500"
          maxLength={500}
        />
      </div>

      <div className="space-y-2">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <label className="block text-sm font-medium text-muted-foreground" htmlFor={editorMode === 'html' ? 'mass-email-html' : 'mass-email-visual-editor'}>Message</label>
          <div className="inline-flex rounded-md border bg-card p-1 text-xs">
            <button type="button" onClick={() => onEditorModeChange('visual')} className={`inline-flex items-center gap-1 rounded-sm px-2 py-1 font-medium ${editorMode === 'visual' ? 'bg-blue-50 dark:bg-blue-950/40 text-blue-800' : 'text-muted-foreground hover:bg-muted/50'}`} aria-pressed={editorMode === 'visual'}>
              <Edit3 className="h-3.5 w-3.5" /> Editor
            </button>
            <button type="button" onClick={() => onEditorModeChange('html')} className={`inline-flex items-center gap-1 rounded-sm px-2 py-1 font-medium ${editorMode === 'html' ? 'bg-blue-50 dark:bg-blue-950/40 text-blue-800' : 'text-muted-foreground hover:bg-muted/50'}`} aria-pressed={editorMode === 'html'}>
              <Code2 className="h-3.5 w-3.5" /> HTML
            </button>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-1 rounded-md border bg-muted/50 p-1">
          <Button type="button" size="icon-sm" variant="ghost" onClick={() => applyEditorFormat('<strong>', '</strong>', 'bold text', 'bold')} title="Bold (Ctrl+B)" aria-label="Bold"><Bold className="h-4 w-4" /></Button>
          <Button type="button" size="icon-sm" variant="ghost" onClick={() => applyEditorFormat('<em>', '</em>', 'italic text', 'italic')} title="Italic (Ctrl+I)" aria-label="Italic"><Italic className="h-4 w-4" /></Button>
          <Button type="button" size="icon-sm" variant="ghost" onClick={() => applyEditorFormat('<u>', '</u>', 'underlined text', 'underline')} title="Underline (Ctrl+U)" aria-label="Underline"><Underline className="h-4 w-4" /></Button>
          <div className="mx-1 h-6 w-px bg-muted" />
          <Button type="button" size="icon-sm" variant="ghost" onClick={() => applyEditorFormat('<h2>', '</h2>', 'Heading', 'formatBlock', 'h2')} title="Heading" aria-label="Heading"><Heading2 className="h-4 w-4" /></Button>
          <Button type="button" size="icon-sm" variant="ghost" onClick={() => applyEditorFormat('<p>', '</p>', 'Paragraph text', 'formatBlock', 'p')} title="Paragraph" aria-label="Paragraph"><Pilcrow className="h-4 w-4" /></Button>
          <Button type="button" size="icon-sm" variant="ghost" onClick={insertHtmlList} title="Bulleted list" aria-label="Bulleted list"><List className="h-4 w-4" /></Button>
          <Button type="button" size="icon-sm" variant="ghost" onClick={insertHtmlLink} title="Link" aria-label="Link"><Link className="h-4 w-4" /></Button>
          <div className="mx-1 h-6 w-px bg-muted" />
          <label className="inline-flex h-8 items-center gap-1 rounded-md border bg-card px-2 text-xs text-muted-foreground">
            <Type className="h-3.5 w-3.5" />
            <select value="" onChange={(event) => applyFontFamily(event.target.value)} className="bg-transparent text-xs outline-none" aria-label="Font family">
              <option value="">Font</option><option value="Arial, sans-serif">Arial</option><option value="Georgia, serif">Georgia</option><option value="Verdana, sans-serif">Verdana</option><option value="Courier New, monospace">Mono</option>
            </select>
          </label>
          <select value="" onChange={(event) => applyFontSize(event.target.value)} className="h-8 rounded-md border bg-card px-2 text-xs text-muted-foreground outline-none" aria-label="Font size">
            <option value="">Size</option><option value="12px">Small</option><option value="16px">Normal</option><option value="20px">Large</option><option value="28px">XL</option>
          </select>
          <input type="color" className="h-8 w-9 rounded-md border bg-card p-1" title="Text color" aria-label="Text color" onChange={(event) => applyTextColor(event.target.value)} />
        </div>
        {editorMode === 'visual' ? (
          <div ref={visualEditorRef} id="mass-email-visual-editor" role="textbox" aria-multiline="true" contentEditable suppressContentEditableWarning onInput={syncHtmlFromVisualEditor} onBlur={syncHtmlFromVisualEditor} className="min-h-96 w-full overflow-auto rounded-md border bg-card px-4 py-3 text-sm leading-6 focus:outline-hidden focus:ring-2 focus:ring-blue-500" />
        ) : (
          <textarea ref={htmlTextareaRef} id="mass-email-html" value={html} onChange={(event) => onHtmlChange(event.target.value)} onKeyDown={handleHtmlKeyDown} className="min-h-96 w-full rounded-md border px-3 py-2 font-mono text-sm focus:outline-hidden focus:ring-2 focus:ring-blue-500" />
        )}
      </div>
    </section>
  );
}
