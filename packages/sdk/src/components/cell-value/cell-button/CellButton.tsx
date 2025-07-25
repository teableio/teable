import { checkButtonClickable, Colors, ColorUtils } from '@teable/core';
import type { IButtonFieldCellValue, IButtonFieldOptions } from '@teable/core';
import { Button, cn } from '@teable/ui-lib';
import { useMemo } from 'react';
import colors from 'tailwindcss/colors';
import type { ICellValue } from '../type';

interface ICellButton extends ICellValue<IButtonFieldCellValue> {
  options: IButtonFieldOptions;
  itemClassName?: string;
}

export const CellButton = (props: ICellButton) => {
  const { className, style, itemClassName, options, value } = props;

  const isClickable = useMemo(() => {
    return checkButtonClickable(options, value);
  }, [options, value]);

  const button = useMemo(() => {
    if (!isClickable) {
      return {
        bgColor: Colors.Gray,
        textColor: colors.white,
        label: options.label,
      };
    }
    const bgColor = ColorUtils.getHexForColor(options.color);
    const textColor = ColorUtils.shouldUseLightTextOnColor(options.color)
      ? colors.white
      : colors.black;

    return {
      bgColor,
      textColor,
      label: options.label,
    };
  }, [options, isClickable]);

  return (
    <div className={cn('flex gap-1 flex-wrap', className)} style={style}>
      <Button
        className={cn('flex h-5 w-24', itemClassName)}
        style={{
          backgroundColor: button.bgColor,
          borderColor: button.bgColor,
          color: button.textColor,
        }}
        disabled={!isClickable}
      >
        <span className="w-full truncate text-sm" style={{ color: button.textColor }}>
          {button.label}1ewgflnvlegnlesngltr.nbhgtkjrjsntkr
        </span>
      </Button>
    </div>
  );
};
