import { cn } from '@teable/ui-lib';
import { memo } from 'react';
import Markdown from 'react-markdown';
import rehypeRaw from 'rehype-raw';
import remarkGfm from 'remark-gfm';

interface MarkdownPreviewPanelProps {
  content: string;
  className?: string;
}

export const MarkdownPreviewPanel = memo(({ content, className }: MarkdownPreviewPanelProps) => {
  if (!content) {
    return (
      <div className="flex h-full items-center justify-center p-4">
        <p className="text-sm text-muted-foreground">Nothing to preview</p>
      </div>
    );
  }

  return (
    <Markdown
      className={cn('markdown-body p-4', className)}
      rehypePlugins={[rehypeRaw]}
      remarkPlugins={[remarkGfm]}
      components={{
        // Custom image rendering to handle uploaded images
        img: ({ node, ...props }) => (
          <img
            {...props}
            className="max-w-full rounded-md"
            loading="lazy"
            alt={props.alt || 'Image'}
          />
        ),
        // Custom link rendering to open in new tab
        a: ({ node, ...props }) => (
          <a {...props} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline" />
        ),
        // Custom code block rendering
        pre: ({ node, ...props }) => (
          <pre {...props} className="overflow-x-auto rounded-md bg-muted p-4" />
        ),
        code: ({ node, className, children, ...props }) => {
          const isInline = !className;
          return isInline ? (
            <code {...props} className="rounded bg-muted px-1 py-0.5 font-mono text-sm">
              {children}
            </code>
          ) : (
            <code {...props} className={className}>
              {children}
            </code>
          );
        },
      }}
    >
      {content}
    </Markdown>
  );
});

MarkdownPreviewPanel.displayName = 'MarkdownPreviewPanel';
