import { memo } from 'react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { cn } from '../../shadcn';

interface IMarkdownReadonlyProps {
  value: string;
  className?: string;
}

/**
 * Lightweight markdown renderer for readonly display.
 * Uses react-markdown instead of a full milkdown editor instance for better performance.
 *
 * Safe by default: react-markdown does NOT render raw HTML unless `rehype-raw`
 * is plugged in, so embedded `<script>` / `<img onerror>` etc. in the source
 * are escaped to text — no DOM injection risk.
 */
export const MarkdownReadonly = memo(
  ({ value, className }: IMarkdownReadonlyProps) => {
    if (!value) return null;

    return (
      <div className={cn('milkdown-editor-wrap w-full text-sm', className)}>
        <div className="milkdown-readonly-preview">
          <Markdown remarkPlugins={[remarkGfm]}>{value}</Markdown>
        </div>
      </div>
    );
  },
  (prev, next) => prev.value === next.value && prev.className === next.className
);

MarkdownReadonly.displayName = 'MarkdownReadonly';
