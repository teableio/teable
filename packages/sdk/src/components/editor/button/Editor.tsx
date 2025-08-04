/* eslint-disable @typescript-eslint/naming-convention */
import type { IButtonFieldCellValue } from '@teable/core';
import { checkButtonClickable, Colors, ColorUtils } from '@teable/core';
import { buttonClick } from '@teable/openapi';
import {
  Button,
  cn,
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@teable/ui-lib';
import { type FC, useMemo } from 'react';
import colors from 'tailwindcss/colors';
import { useTranslation } from '../../../context/app/i18n';
import type { ButtonField } from '../../../model/field/button.field';
import type { ICellEditor } from '../type';

interface IButtonEditor extends ICellEditor<IButtonFieldCellValue> {
  field: ButtonField;
  recordId?: string;
}

export const ButtonEditor: FC<IButtonEditor> = (props) => {
  const { t } = useTranslation();
  const { className, field, recordId, readonly, value } = props;
  const { options: fieldOptions, isLookup } = field;
  const { tableId } = field;

  const count = value?.count ?? 0;
  const maxCount = fieldOptions.maxCount ?? 0;

  const isClickable = useMemo(() => {
    return !readonly && !isLookup && recordId && checkButtonClickable(fieldOptions, value);
  }, [fieldOptions, value, readonly, recordId, isLookup]);

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
    <div className={cn('flex items-center h-8')}>
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="outline"
              onClick={() => {
                if (!recordId || !isClickable) {
                  return;
                }
                buttonClick(tableId, recordId, field.id);
              }}
              className={cn('flex w-24 h-5', className)}
              style={{
                backgroundColor: button.bgColor,
                borderColor: button.bgColor,
                color: button.textColor,
              }}
            >
              <span className="w-full truncate text-xs">{button.label}</span>
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
