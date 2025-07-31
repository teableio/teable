import { checkButtonClickable, Colors, ColorUtils } from '@teable/core';
import type { IButtonFieldCellValue, IButtonFieldOptions } from '@teable/core';
import { Button, cn } from '@teable/ui-lib';
import { useMemo } from 'react';
import colors from 'tailwindcss/colors';
import type { ICellValue } from '../type';

interface ICellButton extends ICellValue<IButtonFieldCellValue> {
  options: IButtonFieldOptions;
  itemClassName?: string;
  readonly?: boolean;
}

export const CellButton = (props: ICellButton) => {
  const { className, style, itemClassName, options: fieldOptions, value, readonly } = props;

  const isClickable = useMemo(() => {
    return !readonly && checkButtonClickable(fieldOptions, value);
  }, [fieldOptions, value, readonly]);

  const button = useMemo(() => {
    const rectColor = isClickable ? fieldOptions.color : Colors.Gray;
    const bgColor = ColorUtils.getHexForColor(rectColor);
    const textColor = ColorUtils.shouldUseLightTextOnColor(rectColor) ? colors.white : colors.black;

    return {
      bgColor,
      textColor,
      label: fieldOptions.label,
    };
  }, [fieldOptions, isClickable]);

  return (
    <div className={cn('flex gap-1 flex-wrap', className)} style={style}>
      <Button
        variant="outline"
        className={cn('flex w-24 h-6 cursor-default', itemClassName)}
        style={{
          backgroundColor: button.bgColor,
          borderColor: button.bgColor,
          color: button.textColor,
        }}
      >
        <span className="w-full truncate text-sm" style={{ color: button.textColor }}>
          {button.label}
        </span>
      </Button>
    </div>
  );
};
