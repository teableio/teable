/* eslint-disable @typescript-eslint/naming-convention */
import type {
  CellValueType,
  ILookupOptionsRo,
  IRatingColors,
  IRatingFieldOptions,
} from '@teable-group/core';
import { ColorUtils, RATING_ICON_COLORS, RatingIcon } from '@teable-group/core';
import { RATING_ICON_MAP } from '@teable-group/sdk/components';
import { RatingField, type IFieldInstance } from '@teable-group/sdk/model';
import {
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  cn,
} from '@teable-group/ui-lib/shadcn';

export const RATING_ICON_LIST = RATING_ICON_COLORS.map((colorKey) => {
  return [
    {
      id: RatingIcon.Star,
      Icon: RATING_ICON_MAP[RatingIcon.Star],
      colorKey,
    },
    {
      id: RatingIcon.Moon,
      Icon: RATING_ICON_MAP[RatingIcon.Moon],
      colorKey,
    },
    {
      id: RatingIcon.Sun,
      Icon: RATING_ICON_MAP[RatingIcon.Sun],
      colorKey,
    },
    {
      id: RatingIcon.Zap,
      Icon: RATING_ICON_MAP[RatingIcon.Zap],
      colorKey,
    },
    {
      id: RatingIcon.Flame,
      Icon: RATING_ICON_MAP[RatingIcon.Flame],
      colorKey,
    },
    {
      id: RatingIcon.Heart,
      Icon: RATING_ICON_MAP[RatingIcon.Heart],
      colorKey,
    },
    {
      id: RatingIcon.Apple,
      Icon: RATING_ICON_MAP[RatingIcon.Apple],
      colorKey,
    },
    {
      id: RatingIcon.ThumbUp,
      Icon: RATING_ICON_MAP[RatingIcon.ThumbUp],
      colorKey,
    },
  ];
});

export const RATING_FIELD_MAXIMUM = Array.from({ length: 10 }, (_, index) => {
  const value = 1 + index;
  return {
    text: value.toString(),
    value: value,
  };
});

export const RatingOptions = (props: {
  options: Partial<IRatingFieldOptions> | undefined;
  isLookup?: boolean;
  cellValueType?: CellValueType;
  lookupField?: IFieldInstance;
  lookupOptions?: ILookupOptionsRo;
  onChange?: (options: Partial<IRatingFieldOptions>) => void;
}) => {
  const { options = RatingField.defaultOptions(), isLookup, onChange } = props;

  const { icon: selectedIcon, color: selectedColor, max } = options;

  const onIconChange = (icon: RatingIcon, colorKey: IRatingColors) => {
    onChange?.({ ...options, icon, color: colorKey });
  };

  const onMaximumChange = (max: string) => {
    onChange?.({ ...options, max: Number(max) });
  };

  if (isLookup) return null;

  return (
    <div className="form-control space-y-2">
      <div className="flex flex-col gap-2 w-full">
        <Label className="font-normal">Style</Label>
        <div className="w-full flex flex-col items-center">
          {RATING_ICON_LIST.map((group, index) => {
            return (
              <div key={index} className="flex my-1">
                {group.map((item) => {
                  const { id, Icon, colorKey } = item;
                  const isSelected = selectedIcon === id && selectedColor === colorKey;
                  const color = ColorUtils.getHexForColor(colorKey);
                  return (
                    <Icon
                      key={id}
                      className={cn(
                        'w-6 h-6 mr-2 p-1 rounded cursor-pointer',
                        isSelected && 'bg-slate-200 dark:bg-slate-800'
                      )}
                      style={{ fill: color, color }}
                      onClick={() => onIconChange(id, colorKey)}
                    />
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>
      <div className="flex flex-col gap-2 w-full">
        <Label className="font-normal">Maximum</Label>
        <Select value={max?.toString()} onValueChange={onMaximumChange}>
          <SelectTrigger className="w-full h-8">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {RATING_FIELD_MAXIMUM.map(({ text, value }) => (
              <SelectItem key={value} value={value.toString()}>
                {text}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </div>
  );
};
