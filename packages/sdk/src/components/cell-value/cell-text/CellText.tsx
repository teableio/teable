import type { SingleLineTextDisplayType } from '@teable/core';
import { cn } from '@teable/ui-lib';
import { onMixedTextClick } from '../../editor/text/utils';
import { OverflowTooltip } from '../components';
import type { ICellValue } from '../type';

interface ICellText extends ICellValue<string> {
  displayType?: SingleLineTextDisplayType;
}

export const CellText = (props: ICellText) => {
  const { value, className, style, ellipsis, displayType } = props;

  const onJump = () => {
    if (!displayType || !value) return;
    onMixedTextClick(displayType, value);
  };

  return (
    <OverflowTooltip
      text={value}
      ellipsis={ellipsis}
      className={cn(
        'w-full text-[13px] leading-5',
        displayType && 'cursor-pointer hover:underline hover:underline-offset-2 text-violet-500',
        className
      )}
      style={style}
      onClick={!displayType ? undefined : onJump}
    />
  );
};
