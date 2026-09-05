import { describe, expect, it, vi } from 'vitest';
import { syncMessageEditorContent } from './templateEditorContent';

describe('TemplateEditor lossless content synchronization', () => {
  it('loads unsupported source without emitting Tiptap normalization', () => {
    const onUpdate = vi.fn();
    const source = '<div style="padding:16px"><table><tr><td>Exact source</td></tr></table></div>';
    let editorHtml = '<p>Exact source</p>';
    const editor = {
      commands: {
        setContent: vi.fn((_content: string, options?: { emitUpdate?: boolean }) => {
          if (options?.emitUpdate !== false) onUpdate(editorHtml);
        }),
      },
      getHTML: () => editorHtml,
    };

    const safeForBasic = syncMessageEditorContent(editor, source);

    expect(editor.commands.setContent).toHaveBeenCalledWith(source, { emitUpdate: false });
    expect(onUpdate).not.toHaveBeenCalled();
    expect(safeForBasic).toBe(false);
    expect(source).toContain('style="padding:16px"');
    editorHtml = source;
    expect(syncMessageEditorContent(editor, source)).toBe(true);
  });
});
