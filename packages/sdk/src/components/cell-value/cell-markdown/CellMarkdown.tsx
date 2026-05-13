import { cn, MarkdownReadonly } from '@teable/ui-lib';
import { memo } from 'react';
import type { ICellValue } from '../type';

interface ICellMarkdown extends ICellValue<string> {}

export const CellMarkdown = memo(({ value, className }: ICellMarkdown) => {
  if (!value) return null;

  return (
    <div className={cn('w-full max-h-80 overflow-auto text-[13px]', className)}>
      <MarkdownReadonly value={value} />
    </div>
  );
});

CellMarkdown.displayName = 'CellMarkdown';
