/* eslint-disable @typescript-eslint/naming-convention */
import { ColorUtils, RatingIcon, type IRatingFieldOptions } from '@teable/core';
import { Star, Moon, Sun, Zap, Flame, Heart, Apple, ThumbsUp } from '@teable/icons';
import { cn } from '@teable/ui-lib';
import { useState, type FC } from 'react';
import type { ICellEditor } from '../type';

interface IRatingEditor extends ICellEditor<number> {
  options: IRatingFieldOptions;
  iconClassName?: string;
}

export const RATING_ICON_MAP = {
  [RatingIcon.Star]: Star,
  [RatingIcon.Moon]: Moon,
  [RatingIcon.Sun]: Sun,
  [RatingIcon.Zap]: Zap,
  [RatingIcon.Flame]: Flame,
  [RatingIcon.Heart]: Heart,
  [RatingIcon.Apple]: Apple,
  [RatingIcon.ThumbUp]: ThumbsUp,
};

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
