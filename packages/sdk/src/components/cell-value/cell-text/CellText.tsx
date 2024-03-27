import { cn } from '@teable/ui-lib';
import type { ICellValue } from '../type';

interface ICellText extends ICellValue<string> {
  isMultipleRows?: boolean;
}

export const CellText = (props: ICellText) => {
  const { value, className, style, isMultipleRows } = props;

  return (
    <div
      className={cn('w-full text-sm', isMultipleRows ? 'line-clamp-4' : 'truncate', className)}
      style={style}
      title={value}
    >
      {value}
    </div>
  );
};
