/* eslint-disable @typescript-eslint/naming-convention */
import type { IButtonFieldCellValue } from '@teable/core';
import { checkButtonClickable, Colors, ColorUtils } from '@teable/core';
import { buttonClickTrigger } from '@teable/openapi';
import { Button, cn } from '@teable/ui-lib';
import { type FC, useMemo } from 'react';
import colors from 'tailwindcss/colors';
import { useBaseId } from '../../../hooks';
import type { ButtonField } from '../../../model/field/button.field';
import type { ICellEditor } from '../type';

interface IButtonEditor extends ICellEditor<IButtonFieldCellValue> {
  field: ButtonField;
  recordId?: string;
}

export const ButtonEditor: FC<IButtonEditor> = (props) => {
  const { className, field, recordId, value, readonly } = props;
  const { options } = field;
  const { tableId } = field;
  const baseId = useBaseId() as string;

  const isClickable = useMemo(() => {
    if (readonly || !recordId) {
      return false;
    }
    return checkButtonClickable(options, value);
  }, [options, value, readonly, recordId]);

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
    <div className={cn('flex items-center h-8')}>
      <Button
        onClick={() => {
          if (!isClickable) {
            return;
          }

          buttonClickTrigger(baseId, {
            tableId,
            recordId: recordId || '',
            fieldId: field.id,
          });
        }}
        className={cn('flex w-24 h-6', className)}
        style={{
          backgroundColor: button.bgColor,
          borderColor: button.bgColor,
          color: button.textColor,
        }}
        disabled={!isClickable}
      >
        <span className="w-full truncate text-sm">{button.label}</span>
      </Button>
    </div>
  );
};
