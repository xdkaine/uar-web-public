import Image from 'next/image';
import { RichTextEditor } from '@/components/support/RichTextEditor';
import RichTextContent from '@/components/support/RichTextContent';
import type { ChangeEvent, MouseEvent, RefObject } from 'react';
import type { RequestComment } from './RequestDetailTypes';

interface RequestCommentsPanelProps {
  comments: RequestComment[];
  newComment: string;
  commentFiles: File[];
  commentSubmitting: boolean;
  showCommentsSection: boolean;
  commentFileInputRef: RefObject<HTMLInputElement | null>;
  isAddCommentDisabled: boolean;
  onToggleCommentsSection: () => void;
  onNewCommentChange: (value: string) => void;
  onStageCommentImages: (files: File[]) => void;
  onRemoveCommentFile: (index: number) => void;
  onOpenCommentFilePicker: () => void;
  onClearCommentFileInput: (event: MouseEvent<HTMLInputElement>) => void;
  onCommentFileInputChange: (event: ChangeEvent<HTMLInputElement>) => void;
  onAddComment: () => void;
  getStagedCommentFileKey: (file: File) => string;
  getCommentAttachmentUrl: (commentId: string, attachmentId: string) => string;
}

export default function RequestCommentsPanel({
  comments,
  newComment,
  commentFiles,
  commentSubmitting,
  showCommentsSection,
  commentFileInputRef,
  isAddCommentDisabled,
  onToggleCommentsSection,
  onNewCommentChange,
  onStageCommentImages,
  onRemoveCommentFile,
  onOpenCommentFilePicker,
  onClearCommentFileInput,
  onCommentFileInputChange,
  onAddComment,
  getStagedCommentFileKey,
  getCommentAttachmentUrl,
}: RequestCommentsPanelProps) {
  return (
    <section className="border-t border-border pt-4 sm:pt-6">
      <div className="flex items-center justify-between mb-3 sm:mb-4">
        <h2 className="text-lg sm:text-xl font-semibold text-foreground">Comments & Notes</h2>
        <button
          onClick={onToggleCommentsSection}
          className="text-sm text-blue-600 dark:text-blue-400 hover:text-blue-800 font-medium"
        >
          {showCommentsSection ? 'Hide' : 'Show'} ({comments.length})
        </button>
      </div>

      {showCommentsSection && (
        <div className="space-y-4">
          <div className="bg-muted/50 p-3 sm:p-4 rounded-lg">
            <p className="block text-sm font-medium text-muted-foreground mb-2">
              Add a Comment
            </p>
            <RichTextEditor
              value={newComment}
              onChange={onNewCommentChange}
              disabled={commentSubmitting}
              ariaLabel="Add notes, observations, or important information about this request"
              onImageFiles={onStageCommentImages}
            />
            {commentFiles.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-2">
                {commentFiles.map((file, index) => (
                  <span key={getStagedCommentFileKey(file)} className="inline-flex max-w-full items-center gap-2 rounded-full border bg-background px-3 py-1 text-xs">
                    <span className="max-w-48 truncate">{file.name}</span>
                    <button type="button" onClick={() => onRemoveCommentFile(index)} aria-label={`Remove ${file.name}`} className="text-muted-foreground hover:text-red-600">×</button>
                  </span>
                ))}
              </div>
            )}
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <input
                ref={commentFileInputRef}
                type="file"
                accept="image/png,image/jpeg,image/webp,image/gif"
                multiple
                className="hidden"
                onClick={onClearCommentFileInput}
                onChange={onCommentFileInputChange}
              />
              <button type="button" onClick={onOpenCommentFilePicker} disabled={commentSubmitting || commentFiles.length >= 5} className="rounded-lg border border-border bg-background px-3 py-2 text-sm font-medium hover:bg-muted disabled:opacity-50">
                Attach images
              </button>
              <button
                onClick={onAddComment}
                disabled={isAddCommentDisabled}
                className="px-4 py-2 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {commentSubmitting ? 'Adding…' : 'Add Comment'}
              </button>
              <span className="text-xs text-muted-foreground">Paste or drag screenshots into the editor.</span>
            </div>
          </div>

          <div className="space-y-3">
            {comments.length === 0 ? (
              <p className="text-muted-foreground text-sm text-center py-4">No comments yet. Add the first one!</p>
            ) : (
              comments.map((comment) => (
                <div
                  key={comment.id}
                  className={`p-3 sm:p-4 border rounded-lg ${comment.type === 'rejection'
                    ? 'bg-red-50 dark:bg-red-950/40 border-red-300 dark:border-red-900'
                    : comment.type === 'approval'
                      ? 'bg-green-50 dark:bg-green-950/40 border-green-300 dark:border-green-900'
                      : 'bg-card border-border'
                    }`}
                >
                  <div className="flex items-start justify-between mb-2">
                    <div className="flex items-center gap-2">
                      {comment.type === 'rejection' && (
                        <svg className="w-4 h-4 text-red-600 dark:text-red-400 shrink-0" fill="currentColor" viewBox="0 0 20 20">
                          <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
                        </svg>
                      )}
                      {comment.type === 'approval' && (
                        <svg className="w-4 h-4 text-green-600 dark:text-green-400 shrink-0" fill="currentColor" viewBox="0 0 20 20">
                          <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                        </svg>
                      )}
                      <span className={`font-medium text-sm ${comment.type === 'rejection' ? 'text-red-900 dark:text-red-200' :
                        comment.type === 'approval' ? 'text-green-900 dark:text-green-200' :
                          'text-foreground'
                        }`}>
                        {comment.authorDisplayName || comment.author}
                      </span>
                      {comment.type === 'rejection' && (
                        <span className="px-2 py-0.5 bg-red-200 dark:bg-red-900/60 text-red-800 dark:text-red-200 text-xs font-semibold rounded">
                          REJECTION
                        </span>
                      )}
                      {comment.type === 'approval' && (
                        <span className="px-2 py-0.5 bg-green-200 dark:bg-green-900/60 text-green-800 dark:text-green-200 text-xs font-semibold rounded">
                          APPROVAL
                        </span>
                      )}
                    </div>
                    <span className={`text-xs ${comment.type === 'rejection' ? 'text-red-600 dark:text-red-400' :
                      comment.type === 'approval' ? 'text-green-600 dark:text-green-400' :
                        'text-muted-foreground'
                      }`}>
                      {new Date(comment.createdAt).toLocaleString()}
                    </span>
                  </div>
                  <div className={`text-sm ${comment.type === 'rejection' ? 'text-red-900 dark:text-red-200' :
                    comment.type === 'approval' ? 'text-green-900 dark:text-green-200' :
                      'text-muted-foreground'
                    }`}>
                    <RichTextContent content={comment.comment} />
                  </div>
                  {comment.attachments && comment.attachments.length > 0 && (
                    <div className="mt-3 flex flex-wrap gap-2 border-t border-current/10 pt-3">
                      {comment.attachments.map((attachment) => {
                        const url = getCommentAttachmentUrl(comment.id, attachment.id);
                        return (
                          <a key={attachment.id} href={url} target="_blank" rel="noopener noreferrer" className="group block overflow-hidden rounded-md border border-border bg-background">
                            <Image src={url} alt={attachment.filename} className="h-20 w-28 object-cover transition-transform group-hover:scale-105" width={112} height={80} unoptimized />
                            <span className="block max-w-28 truncate px-2 py-1 text-[11px] text-muted-foreground">{attachment.filename}</span>
                          </a>
                        );
                      })}
                    </div>
                  )}
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </section>
  );
}
