import { Eye, Mail, Send, Users } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface MassEmailReviewActionsProps {
  previewHtml: string;
  previewIsFresh: boolean;
  testEmail: string;
  editingCampaignId: string | null;
  isWorking: boolean;
  resolutionIsFresh: boolean;
  onPreview: () => void;
  onDryRun: () => void;
  onTestEmailChange: (value: string) => void;
  onSendTest: () => void;
  onSaveDraft: () => void;
  onQuickSend: () => void;
}

export function MassEmailReviewActions({
  previewHtml,
  previewIsFresh,
  testEmail,
  editingCampaignId,
  isWorking,
  resolutionIsFresh,
  onPreview,
  onDryRun,
  onTestEmailChange,
  onSendTest,
  onSaveDraft,
  onQuickSend,
}: MassEmailReviewActionsProps) {
  return (
    <aside className="space-y-4 xl:sticky xl:top-4">
      <section className="rounded-lg border bg-card p-4 shadow-sm">
        <div className="mb-3 flex items-center justify-between gap-3"><h3 className="font-semibold text-foreground">Review</h3><span className="text-xs text-muted-foreground">Sandboxed preview</span></div>
        <iframe title="Mass email preview" sandbox="" srcDoc={previewHtml || '<p style="font-family:Arial,sans-serif;color:#6b7280;">Preview pending.</p>'} className="h-104 w-full rounded-md border bg-card" />
        {previewHtml && !previewIsFresh && <p className="mt-2 text-xs text-amber-700 dark:text-amber-300">Message changed after this preview. Refresh it before relying on the rendered result.</p>}
        <div className="mt-4 grid grid-cols-2 gap-2">
          <Button type="button" variant="outline" onClick={onPreview} disabled={isWorking} className="gap-2"><Eye className="h-4 w-4" /> Preview</Button>
          <Button type="button" variant="outline" onClick={onDryRun} disabled={isWorking} className="gap-2"><Users className="h-4 w-4" /> Dry Run</Button>
        </div>
      </section>
      <section className="rounded-lg border bg-card p-4 shadow-sm">
        <h3 className="mb-3 font-semibold text-foreground">Send</h3>
        <div className="flex flex-col gap-2">
          <div className="flex flex-col gap-2 sm:flex-row xl:flex-col">
            <input value={testEmail} onChange={(event) => onTestEmailChange(event.target.value)} className="min-w-0 flex-1 rounded-md border px-3 py-2 text-sm focus:outline-hidden focus:ring-2 focus:ring-blue-500" aria-label="Test email recipient" placeholder="test@example.edu" />
            <Button type="button" variant="outline" onClick={onSendTest} disabled={isWorking || !testEmail} className="gap-2"><Send className="h-4 w-4" /> Test</Button>
          </div>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-1">
            <Button type="button" onClick={onSaveDraft} disabled={isWorking} className="gap-2"><Mail className="h-4 w-4" /> {editingCampaignId ? 'Save Changes' : 'Save Draft'}</Button>
            <Button type="button" onClick={onQuickSend} disabled={isWorking || Boolean(editingCampaignId) || !resolutionIsFresh} className="gap-2 bg-destructive text-destructive-foreground hover:bg-destructive/90"><Send className="h-4 w-4" /> Quick Send</Button>
          </div>
        </div>
      </section>
    </aside>
  );
}
