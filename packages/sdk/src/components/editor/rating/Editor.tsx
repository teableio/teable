/* eslint-disable @typescript-eslint/naming-convention */
import { ColorUtils } from '@teable/core';
import type { IRatingFieldOptions } from '@teable/core';
import { cn } from '@teable/ui-lib';
import { useState, type FC } from 'react';
import { RATING_ICON_MAP } from '../../cell-value';
import type { ICellEditor } from '../type';

interface IRatingEditor extends ICellEditor<number> {
  options: IRatingFieldOptions;
  iconClassName?: string;
}

export const RatingEditor: FC<IRatingEditor> = (props) => {
  const { value, options, readonly, className, iconClassName, onChange } = props;
  const { icon, color: colorKey, max } = options;
  const [hoverIndex, setHoverIndex] = useState(-1);

  const onChangeInner = (index: number) => {
    if (readonly) return;
    const finalValue = index + 1 === value ? undefined : index + 1;
    onChange?.(finalValue);
  };

  const onHoverIndexChange = (index: number) => {
    if (readonly) return;
    setHoverIndex(index);
  };

  const Icon = RATING_ICON_MAP[icon];
  const color = ColorUtils.getHexForColor(colorKey);
  const hoveredColor = ColorUtils.getRgbaStringForColor(colorKey, 0.3);

  return (
    <div className={cn('flex items-center h-8', className)}>
      {Array.from({ length: max }).map((_, index) => {
        let style = {};

        if (value != null && index < value) {
          style = { fill: color, color };
        } else if (index <= hoverIndex) {
          style = { fill: hoveredColor, color: hoveredColor };
        }
        return (
          <Icon
            key={index}
            className={cn(
              'w-6 h-6 mr-2 rounded cursor-pointer text-slate-200 fill-slate-200 dark:text-gray-700 dark:fill-gray-700',
              iconClassName
            )}
            style={style}
            onMouseEnter={() => onHoverIndexChange(index)}
            onMouseLeave={() => onHoverIndexChange(-1)}
            onClick={() => onChangeInner(index)}
          />
        );
      })}
    </div>
  );
};
