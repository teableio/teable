import { cn } from '@teable/ui-lib';
import { isEqual } from 'lodash';
import { memo } from 'react';
import type { Components, Options } from 'react-markdown';
import Markdown from 'react-markdown';
import rehypeRaw from 'rehype-raw';
import rehypeSanitize, { defaultSchema } from 'rehype-sanitize';
import remarkGfm from 'remark-gfm';

export type { Components } from 'react-markdown';

// rehype-raw turns HTML written inside the markdown into real elements, and
// what is rendered here is user-authored (plugin and template descriptions,
// table and field names in the API guide), so the tree has to be sanitised
// after the raw pass. The GitHub default schema keeps the formatting tags,
// tables and https images descriptions rely on and drops scripts, iframes,
// event handlers, inline styles and data: URLs (GHSA-75j7-974w-84gf).
const rehypePlugins: NonNullable<Options['rehypePlugins']> = [
  rehypeRaw,
  [rehypeSanitize, defaultSchema],
];

export const MarkdownPreview = (props: {
  children?: string;
  className?: string;
  components?: Components;
}) => {
  return (
    <Markdown
      className={cn('markdown-body px-3 py-2', props.className)}
      rehypePlugins={rehypePlugins}
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
