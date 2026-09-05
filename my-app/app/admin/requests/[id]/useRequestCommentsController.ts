'use client';

import { useCallback, useMemo, useRef, useState } from 'react';
import type { ChangeEvent, MouseEvent, RefObject } from 'react';
import type { ToastType } from '@/components/Toast';
import { fetchWithCsrf } from '@/lib/csrf';
import { isEmptyRichText } from '@/lib/ticket-content';
import type { RequestComment } from './RequestDetailTypes';

const MAX_COMMENT_IMAGES = 5;
const MAX_COMMENT_IMAGE_BYTES = 20 * 1024 * 1024;
const stagedCommentFileKeys = new WeakMap<File, string>();
let nextStagedCommentFileKey = 0;

interface CreatedCommentResponse {
  error?: string;
  comment: {
    id: string;
  };
}

interface ErrorResponse {
  error?: string;
}

export interface RequestCommentsPanelProps {
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

interface UseRequestCommentsControllerOptions {
  requestId: string;
  showToast: (message: string, type?: ToastType) => void;
}

interface UseRequestCommentsControllerResult {
  commentsPanelProps: RequestCommentsPanelProps;
  refreshComments: () => Promise<void>;
}

function getStagedCommentFileKey(file: File) {
  let key = stagedCommentFileKeys.get(file);
  if (!key) {
    key = `staged-comment-file-${nextStagedCommentFileKey++}`;
    stagedCommentFileKeys.set(file, key);
  }
  return key;
}

async function getAttachmentWarning(response: Response) {
  try {
    const result = await response.json() as ErrorResponse;
    return result.error || 'Images could not be attached';
  } catch {
    return 'Images could not be attached';
  }
}

export function useRequestCommentsController({
  requestId,
  showToast,
}: UseRequestCommentsControllerOptions): UseRequestCommentsControllerResult {
  const [comments, setComments] = useState<RequestComment[]>([]);
  const [newComment, setNewComment] = useState('');
  const [commentFiles, setCommentFiles] = useState<File[]>([]);
  const [commentSubmitting, setCommentSubmitting] = useState(false);
  const [showCommentsSection, setShowCommentsSection] = useState(true);
  const commentFileInputRef = useRef<HTMLInputElement>(null);

  const refreshComments = useCallback(async () => {
    try {
      const response = await fetch(`/api/admin/requests/${requestId}/comments`);
      if (response.ok) {
        const data = await response.json() as { comments: RequestComment[] };
        setComments(data.comments);
      }
    } catch (error) {
      console.error('Error fetching comments:', error);
    }
  }, [requestId]);

  const stageCommentImages = useCallback((files: File[]) => {
    const accepted = files.filter(
      (file) => file.type.startsWith('image/') && file.size > 0 && file.size <= MAX_COMMENT_IMAGE_BYTES,
    );
    setCommentFiles((current) => [...current, ...accepted].slice(0, MAX_COMMENT_IMAGES));
    if (accepted.length !== files.length) {
      showToast('Comments accept up to five images, 20 MB each.', 'warning');
    }
  }, [showToast]);

  const handleAddComment = useCallback(async () => {
    if (isEmptyRichText(newComment)) {
      showToast('Please enter a comment', 'warning');
      return;
    }

    setCommentSubmitting(true);
    try {
      const response = await fetchWithCsrf(`/api/admin/requests/${requestId}/comments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ comment: newComment }),
      });

      const result = await response.json() as CreatedCommentResponse;
      if (!response.ok) throw new Error(result.error || 'Failed to add comment');

      let attachmentWarning = '';
      if (commentFiles.length > 0) {
        const form = new FormData();
        commentFiles.forEach((file) => form.append('files', file));
        const upload = await fetchWithCsrf(
          `/api/admin/requests/${requestId}/comments/${result.comment.id}/attachments`,
          { method: 'POST', body: form },
        );
        if (!upload.ok) {
          attachmentWarning = await getAttachmentWarning(upload);
        }
      }

      showToast(
        attachmentWarning ? `Comment saved. ${attachmentWarning}` : 'Comment added successfully',
        attachmentWarning ? 'warning' : 'success',
      );
      setNewComment('');
      setCommentFiles([]);
      if (commentFileInputRef.current) commentFileInputRef.current.value = '';
      await refreshComments();
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Failed to add comment', 'error');
    } finally {
      setCommentSubmitting(false);
    }
  }, [commentFiles, newComment, refreshComments, requestId, showToast]);

  const handleToggleCommentsSection = useCallback(() => {
    setShowCommentsSection((current) => !current);
  }, []);

  const removeCommentFile = useCallback((index: number) => {
    setCommentFiles((current) => current.filter((_, itemIndex) => itemIndex !== index));
  }, []);

  const openCommentFilePicker = useCallback(() => {
    commentFileInputRef.current?.click();
  }, []);

  const clearCommentFileInput = useCallback((event: MouseEvent<HTMLInputElement>) => {
    event.currentTarget.value = '';
  }, []);

  const handleCommentFileInputChange = useCallback((event: ChangeEvent<HTMLInputElement>) => {
    stageCommentImages(Array.from(event.target.files ?? []));
  }, [stageCommentImages]);

  const getCommentAttachmentUrl = useCallback(
    (commentId: string, attachmentId: string) =>
      `/api/admin/requests/${requestId}/comments/${commentId}/attachments/${attachmentId}/content`,
    [requestId],
  );

  const commentsPanelProps = useMemo<RequestCommentsPanelProps>(() => ({
    comments,
    newComment,
    commentFiles,
    commentSubmitting,
    showCommentsSection,
    commentFileInputRef,
    isAddCommentDisabled: isEmptyRichText(newComment) || commentSubmitting,
    onToggleCommentsSection: handleToggleCommentsSection,
    onNewCommentChange: setNewComment,
    onStageCommentImages: stageCommentImages,
    onRemoveCommentFile: removeCommentFile,
    onOpenCommentFilePicker: openCommentFilePicker,
    onClearCommentFileInput: clearCommentFileInput,
    onCommentFileInputChange: handleCommentFileInputChange,
    onAddComment: handleAddComment,
    getStagedCommentFileKey,
    getCommentAttachmentUrl,
  }), [
    clearCommentFileInput,
    commentFiles,
    commentSubmitting,
    comments,
    getCommentAttachmentUrl,
    handleAddComment,
    handleCommentFileInputChange,
    handleToggleCommentsSection,
    newComment,
    openCommentFilePicker,
    removeCommentFile,
    showCommentsSection,
    stageCommentImages,
  ]);

  return { commentsPanelProps, refreshComments };
}
