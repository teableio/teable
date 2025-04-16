import { cn } from '@teable/ui-lib/shadcn';
import Markdown from 'react-markdown';
import rehypeRaw from 'rehype-raw';
import remarkGfm from 'remark-gfm';

export const MarkdownPreview = (props: { children?: string; className?: string }) => {
  return (
    <Markdown
      className={cn(
        'markdown-body !bg-background px-3 py-2 !text-sm !text-foreground',
        props.className
      )}
      rehypePlugins={[rehypeRaw]}
      remarkPlugins={[remarkGfm]}
    >
      {props.children}
    </Markdown>
  );
};
