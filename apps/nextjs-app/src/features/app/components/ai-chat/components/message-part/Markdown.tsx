import { cn } from '@teable/ui-lib/shadcn';
import React, { memo } from 'react';
import type { Components } from 'react-markdown';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { oneDark } from 'react-syntax-highlighter/dist/cjs/styles/prism';
import { MarkdownPreview } from '../../../mark-down-preview';

const NonMemoizedMarkdown = ({
  children,
  className,
  components,
}: {
  children: string;
  className?: string;
  components?: Components;
}) => {
  return (
    <MarkdownPreview
      className={cn('px-0 py-0 !text-[13px]', className)}
      components={{
        code(props) {
          const { children, className, node, ...rest } = props;
          const match = /language-(\w+)/.exec(className || '');
          return match ? (
            <SyntaxHighlighter
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              {...(rest as any)}
              PreTag="div"
              // eslint-disable-next-line react/no-children-prop
              children={String(children).replace(/\n$/, '')}
              language={match[1]}
              style={oneDark}
            />
          ) : (
            <code {...rest} className={className}>
              {children}
            </code>
          );
        },
        p(props) {
          const { children } = props;
          return (
            // eslint-disable-next-line tailwindcss/enforces-shorthand
            <p className="!mb-2 !mt-2">{children}</p>
          );
        },
        ...components,
      }}
    >
      {children}
    </MarkdownPreview>
  );
};

export const Markdown = memo(
  NonMemoizedMarkdown,
  (prevProps, nextProps) => prevProps.children === nextProps.children
);
