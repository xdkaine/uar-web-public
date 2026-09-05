import { isBasicMessageEditorRoundTripSafe } from '@/lib/messages/editor-state';

interface ContentSyncEditor {
  commands: {
    setContent: (content: string, options?: { emitUpdate?: boolean }) => unknown;
  };
  getHTML: () => string;
}

export function syncMessageEditorContent(editor: ContentSyncEditor, source: string) {
  editor.commands.setContent(source || '', { emitUpdate: false });
  return isBasicMessageEditorRoundTripSafe(source, editor.getHTML());
}
