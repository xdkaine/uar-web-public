import { useCallback, useEffect, useRef, type Dispatch, type KeyboardEvent, type SetStateAction } from 'react';
import { requestActionImpact } from '@/components/admin/actionImpactRequest';
import type { EditorMode } from './MassEmailTypes';

interface MassEmailEditorMechanicsProps {
  html: string;
  editorMode: EditorMode;
  setHtml: Dispatch<SetStateAction<string>>;
  showToast: (message: string, variant: 'success' | 'error' | 'warning') => void;
}

export function useMassEmailEditorMechanics({ html, editorMode, setHtml, showToast }: MassEmailEditorMechanicsProps) {
  const htmlTextareaRef = useRef<HTMLTextAreaElement | null>(null);
  const visualEditorRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (editorMode !== 'visual') return;
    const editor = visualEditorRef.current;
    if (editor && editor.innerHTML !== html) editor.innerHTML = html;
  }, [editorMode, html]);

  const syncHtmlFromVisualEditor = useCallback(() => setHtml(visualEditorRef.current?.innerHTML || '<p></p>'), [setHtml]);
  const applyVisualCommand = useCallback((command: string, value?: string) => {
    const editor = visualEditorRef.current;
    if (!editor) return;
    editor.focus();
    document.execCommand(command, false, value);
    syncHtmlFromVisualEditor();
  }, [syncHtmlFromVisualEditor]);
  const replaceHtmlRange = useCallback((start: number, end: number, replacement: string, selectionStart: number, selectionEnd: number) => {
    setHtml((currentHtml) => `${currentHtml.slice(0, start)}${replacement}${currentHtml.slice(end)}`);
    window.requestAnimationFrame(() => {
      htmlTextareaRef.current?.focus();
      htmlTextareaRef.current?.setSelectionRange(selectionStart, selectionEnd);
    });
  }, [setHtml]);
  const wrapHtmlSelection = useCallback((before: string, after: string, fallback: string) => {
    const textarea = htmlTextareaRef.current;
    const start = textarea?.selectionStart ?? html.length;
    const end = textarea?.selectionEnd ?? html.length;
    const selectedText = html.slice(start, end) || fallback;
    const replacement = `${before}${selectedText}${after}`;
    const nextSelectionStart = start + before.length;
    replaceHtmlRange(start, end, replacement, nextSelectionStart, nextSelectionStart + selectedText.length);
  }, [html, replaceHtmlRange]);
  const applyEditorFormat = useCallback((before: string, after: string, fallback: string, visualCommand: string, visualValue?: string) => {
    if (editorMode === 'visual') return applyVisualCommand(visualCommand, visualValue);
    wrapHtmlSelection(before, after, fallback);
  }, [applyVisualCommand, editorMode, wrapHtmlSelection]);
  const insertHtmlList = useCallback(() => {
    if (editorMode === 'visual') return applyVisualCommand('insertUnorderedList');
    const textarea = htmlTextareaRef.current;
    const start = textarea?.selectionStart ?? html.length;
    const end = textarea?.selectionEnd ?? html.length;
    const selectedText = html.slice(start, end) || 'List item';
    const items = selectedText.split(/\n+/).map((line) => line.trim()).filter(Boolean).map((line) => `  <li>${line}</li>`).join('\n');
    const replacement = `<ul>\n${items}\n</ul>`;
    replaceHtmlRange(start, end, replacement, start, start + replacement.length);
  }, [applyVisualCommand, editorMode, html, replaceHtmlRange]);
  const insertHtmlLink = useCallback(async () => {
    const decision = await requestActionImpact({ title: 'Insert message link', description: 'Add a reviewed HTTPS, HTTP, or mail link to the selected message content.', input: { label: 'Link URL', placeholder: 'https://…', required: true }, confirmLabel: 'Insert link' });
    if (!decision.confirmed || decision.value === null) return;
    const trimmedUrl = decision.value.trim();
    if (!/^(https?:\/\/|mailto:)/i.test(trimmedUrl)) return showToast('Use an http, https, or mailto link', 'error');
    if (editorMode === 'visual') return applyVisualCommand('createLink', trimmedUrl);
    wrapHtmlSelection(`<a href="${trimmedUrl.replace(/"/g, '%22')}">`, '</a>', 'link text');
  }, [applyVisualCommand, editorMode, showToast, wrapHtmlSelection]);
  const applyFontFamily = useCallback((fontFamily: string) => fontFamily && applyEditorFormat(`<span style="font-family: ${fontFamily};">`, '</span>', 'Text', 'fontName', fontFamily), [applyEditorFormat]);
  const applyFontSize = useCallback((fontSize: string) => {
    if (!fontSize) return;
    const visualSize = fontSize === '12px' ? '2' : fontSize === '20px' ? '4' : fontSize === '28px' ? '5' : '3';
    applyEditorFormat(`<span style="font-size: ${fontSize};">`, '</span>', 'Text', 'fontSize', visualSize);
  }, [applyEditorFormat]);
  const applyTextColor = useCallback((color: string) => color && applyEditorFormat(`<span style="color: ${color};">`, '</span>', 'Text', 'foreColor', color), [applyEditorFormat]);
  const handleHtmlKeyDown = useCallback((event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (!(event.ctrlKey || event.metaKey)) return;
    if (event.key.toLowerCase() === 'b') { event.preventDefault(); wrapHtmlSelection('<strong>', '</strong>', 'bold text'); }
    else if (event.key.toLowerCase() === 'i') { event.preventDefault(); wrapHtmlSelection('<em>', '</em>', 'italic text'); }
    else if (event.key.toLowerCase() === 'u') { event.preventDefault(); wrapHtmlSelection('<u>', '</u>', 'underlined text'); }
  }, [wrapHtmlSelection]);
  return { htmlTextareaRef, visualEditorRef, syncHtmlFromVisualEditor, applyEditorFormat, insertHtmlList, insertHtmlLink, applyFontFamily, applyFontSize, applyTextColor, handleHtmlKeyDown };
}
