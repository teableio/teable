import { checkButtonClickable, Colors } from '@teable/core';
import type { IButtonFieldCellValue, IButtonFieldOptions } from '@teable/core';
import {
  Button,
  cn,
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
  useTheme,
} from '@teable/ui-lib';
import { useMemo } from 'react';
import { useTranslation } from '../../../context/app/i18n';
import { useContentDir } from '../../../hooks/use-content-dir';
import { getSelectColorPairs } from '../../../utils/select-color';
import type { ICellValue } from '../type';

interface ICellButton extends ICellValue<IButtonFieldCellValue> {
  options: IButtonFieldOptions;
  itemClassName?: string;
  readonly?: boolean;
  isLookup?: boolean;
}

export const CellButton = (props: ICellButton) => {
  const { className, style, itemClassName, options: fieldOptions, value, isLookup } = props;
  const { t } = useTranslation();
  const { resolvedTheme } = useTheme();
  const contentDir = useContentDir();
  const count = value?.count ?? 0;
  const maxCount = fieldOptions.maxCount ?? 0;
  const isClickable = useMemo(() => {
    return !isLookup && checkButtonClickable(fieldOptions, value);
  }, [fieldOptions, value, isLookup]);

  const button = useMemo(() => {
    const rectColor = isClickable ? fieldOptions.color : Colors.Gray;
    const { color: textColor, backgroundColor: bgColor } = getSelectColorPairs(
      rectColor,
      resolvedTheme
    );

    return {
      bgColor,
      textColor,
      label: fieldOptions.label,
    };
  }, [fieldOptions, isClickable, resolvedTheme]);

  return (
    <div className={cn('flex gap-1 flex-wrap', className)} style={style}>
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="outline"
              className={cn('flex w-24 h-6 cursor-default', itemClassName)}
              style={{
                backgroundColor: button.bgColor,
                borderColor: button.bgColor,
                color: button.textColor,
              }}
            >
              <span
                dir={contentDir}
                className="w-full truncate text-xs"
                style={{ color: button.textColor }}
              >
                {button.label}
              </span>
            </Button>
          </TooltipTrigger>
          <TooltipContent>
            <span>
              {t('common.clickedCount', {
                label: button.label,
                text: maxCount > 0 ? `${count}/${maxCount}` : `${count}`,
              })}
            </span>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    </div>
  );
};
