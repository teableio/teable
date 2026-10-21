import { cn, MarkdownReadonly } from '@teable/ui-lib';
import { memo } from 'react';
import { useContentDir } from '../../../hooks/use-content-dir';
import type { ICellValue } from '../type';

interface ICellMarkdown extends ICellValue<string> {}

export const CellMarkdown = memo(({ value, className }: ICellMarkdown) => {
  const contentDir = useContentDir();

  if (!value) return null;

  return (
    <div dir={contentDir} className={cn('w-full max-h-80 overflow-auto text-[13px]', className)}>
      <MarkdownReadonly value={value} />
    </div>
  );
});

CellMarkdown.displayName = 'CellMarkdown';
