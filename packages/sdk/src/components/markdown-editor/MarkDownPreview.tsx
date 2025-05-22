import { cn } from '@teable/ui-lib';
import { isEqual } from 'lodash';
import { memo } from 'react';
import type { Components } from 'react-markdown';
import Markdown from 'react-markdown';
import rehypeRaw from 'rehype-raw';
import remarkGfm from 'remark-gfm';

export type { Components } from 'react-markdown';

export const MarkdownPreview = (props: {
  children?: string;
  className?: string;
  components?: Components;
}) => {
  return (
    <Markdown
      className={cn('markdown-body px-3 py-2', props.className)}
      rehypePlugins={[rehypeRaw]}
      remarkPlugins={[remarkGfm]}
      components={props.components}
    >
      {props.children}
    </Markdown>
  );
};

export const MemoizedContentMarkdownPreview = memo(MarkdownPreview, (prev, next) => {
  return isEqual(prev.children, next.children);
});
