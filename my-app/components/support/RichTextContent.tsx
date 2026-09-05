import { cn } from '@/lib/utils';
import { isTicketHtml, sanitizeTicketHtml } from '@/lib/ticket-content';

interface RichTextContentProps {
  content: string;
  className?: string;
}

const RICH_STYLES = [
  '[&_p]:my-2 [&_p:first-child]:mt-0 [&_p:last-child]:mb-0',
  '[&_ul]:my-2 [&_ol]:my-2 [&_ul]:list-disc [&_ol]:list-decimal [&_ul]:ps-6 [&_ol]:ps-6',
  '[&_li]:my-0.5',
  '[&_a]:break-all [&_a]:text-primary [&_a]:underline [&_a]:underline-offset-2',
  '[&_blockquote]:my-2 [&_blockquote]:border-l-2 [&_blockquote]:border-border [&_blockquote]:pl-3 [&_blockquote]:italic [&_blockquote]:text-muted-foreground',
  '[&_h3]:mb-1 [&_h3]:mt-3 [&_h3]:text-base [&_h3]:font-semibold [&_h4]:mb-1 [&_h4]:mt-2 [&_h4]:text-sm [&_h4]:font-semibold [&_h3:first-child]:mt-0 [&_h4:first-child]:mt-0',
  '[&_pre]:my-2 [&_pre]:overflow-x-auto [&_pre]:rounded-md [&_pre]:bg-muted [&_pre]:p-2 [&_pre]:text-xs',
  '[&_code]:rounded [&_code]:bg-muted [&_code]:px-1 [&_code]:py-0.5 [&_code]:font-mono [&_code]:text-[0.85em]',
  '[&_pre_code]:bg-transparent [&_pre_code]:p-0',
];

/**
 * Renders stored ticket or request-comment content. New rich bodies pass the
 * server-side sanitize pipeline before storage, and this boundary sanitizes
 * them again because historical rows were unrestricted plain text.
 */
export default function RichTextContent({ content, className }: RichTextContentProps) {
  if (!isTicketHtml(content)) {
    return <div className={cn('whitespace-pre-wrap break-words', className)}>{content}</div>;
  }

  // Historical ticket and request-comment rows predate the rich-text storage
  // contract. Treat stored HTML as untrusted even when newer write paths have
  // already sanitized it, otherwise one allowed tag can turn a legacy payload
  // into executable markup at this render boundary.
  const sanitizedContent = sanitizeTicketHtml(content);

  return (
    <div
      className={cn(
        'ticket-rich bg-transparent text-sm leading-relaxed text-foreground',
        RICH_STYLES,
        className
      )}
      dangerouslySetInnerHTML={{ __html: sanitizedContent }}
    />
  );
}
