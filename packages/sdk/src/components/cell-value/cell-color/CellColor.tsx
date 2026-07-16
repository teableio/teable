import { cn } from '@teable/ui-lib';
import type { ICellValue } from '../type';

interface ICellColor extends ICellValue<string> {}

export const CellColor = ({ value, className, style }: ICellColor) => {
  if (!value) return null;
  return (
    <div className={cn('flex items-center gap-2', className)} style={style}>
      <div
        className="inline-flex items-center justify-center rounded-full p-[3px]"
        style={{ backgroundColor: value }}
      >
        <span
          className="size-4 rounded-full border-2 border-background"
          style={{ backgroundColor: value }}
        />
      </div>

      <span className="font-mono text-xs">{value}</span>
    </div>
  );
};
