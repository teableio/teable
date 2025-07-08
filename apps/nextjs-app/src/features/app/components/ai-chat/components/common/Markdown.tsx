import { MemoizedContentMarkdownPreview, type Components } from '@teable/sdk';
import { cn } from '@teable/ui-lib/shadcn';
import { marked } from 'marked';
import React, { memo, useMemo } from 'react';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { oneDark } from 'react-syntax-highlighter/dist/cjs/styles/prism';

const parseMarkdownIntoBlocks = (markdown: string): string[] => {
  const tokens = marked.lexer(markdown);
  return tokens.map((token) => token.raw);
};

const NonMemoizedMarkdown = ({
  id,
  children,
  className,
  components,
  syntaxHighlighterProps,
}: {
  id?: string;
  children: string;
  className?: string;
  components?: Components;
  syntaxHighlighterProps?: Omit<React.ComponentProps<typeof SyntaxHighlighter>, 'children'>;
}) => {
  const blocks = useMemo(() => parseMarkdownIntoBlocks(children), [children]);

  return blocks.map((block, index) => (
    <MemoizedContentMarkdownPreview
      key={`${id || ''}-block_${index}`}
      className={cn('px-0 py-0 !text-[13px]', className)}
      components={{
        code(props) {
          const { children, className, ...rest } = props;
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
              customStyle={{
                maxHeight: '500px',
              }}
              {...syntaxHighlighterProps}
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
      {block}
    </MemoizedContentMarkdownPreview>
  ));
};

export const Markdown = memo(
  NonMemoizedMarkdown,
  (prevProps, nextProps) => prevProps.children === nextProps.children
);
