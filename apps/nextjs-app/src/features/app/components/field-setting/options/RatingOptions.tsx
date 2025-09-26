import type { IRatingColors, IRatingFieldOptions } from '@teable/core';
import { ColorUtils, RATING_ICON_COLORS, RatingIcon } from '@teable/core';
import { RATING_ICON_MAP } from '@teable/sdk/components';
import { RatingField } from '@teable/sdk/model';
import {
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  cn,
} from '@teable/ui-lib/shadcn';
import { useTranslation } from 'next-i18next';

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
  onChange?: (options: Partial<IRatingFieldOptions>) => void;
}) => {
  const { options = RatingField.defaultOptions(), isLookup, onChange } = props;
  const { t } = useTranslation(['table']);

  const { icon: selectedIcon, color: selectedColor, max } = options;

  const onIconChange = (icon: RatingIcon, colorKey: IRatingColors) => {
    onChange?.({ ...options, icon, color: colorKey });
  };

  const onMaximumChange = (max: string) => {
    onChange?.({ ...options, max: Number(max) });
  };

  if (isLookup) return null;

  return (
    <div className="form-control space-y-4 border-t pt-4">
      <div className="flex w-full flex-col gap-2">
        <Label className="text-sm font-medium">{t('field.editor.style')}</Label>
        <div className="flex w-full flex-col items-center rounded-md border px-4 py-3">
          {RATING_ICON_LIST.map((group, index) => {
            return (
              <div key={index} className=" my-1 flex w-full justify-between">
                {group.map((item) => {
                  const { id, Icon, colorKey } = item;
                  const isSelected = selectedIcon === id && selectedColor === colorKey;
                  const color = ColorUtils.getHexForColor(colorKey);
                  return (
                    <Icon
                      key={id}
                      className={cn(
                        'w-7 h-7 p-1 rounded cursor-pointer',
                        isSelected && 'bg-accent'
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
      <div className="flex w-full flex-col gap-2">
        <Label className="text-sm font-medium">{t('field.editor.maximum')}</Label>
        <Select value={max?.toString()} onValueChange={onMaximumChange}>
          <SelectTrigger className="h-9 w-full">
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
