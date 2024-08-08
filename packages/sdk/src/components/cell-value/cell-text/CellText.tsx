import { cn } from '@teable/ui-lib';
import { OverflowTooltip } from '../components';
import type { ICellValue } from '../type';

export const CellText = (props: ICellValue<string>) => {
  const { value, className, style, maxLine = 1 } = props;

  return (
    <OverflowTooltip
      text={value}
      maxLine={maxLine}
      className={cn('w-full text-[13px]', className)}
      style={style}
    />
  );
};
