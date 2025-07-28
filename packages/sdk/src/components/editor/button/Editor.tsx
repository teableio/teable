/* eslint-disable @typescript-eslint/naming-convention */
import type { IButtonFieldCellValue } from '@teable/core';
import { Colors, ColorUtils } from '@teable/core';
import { workflowTriggerFire } from '@teable/openapi';
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
  const { className, field, recordId, readonly } = props;
  const { options: fieldOptions } = field;
  const { tableId } = field;
  const baseId = useBaseId() as string;

  const button = useMemo(() => {
    const rectColor = readonly ? Colors.Gray : fieldOptions.color;
    const bgColor = ColorUtils.getHexForColor(rectColor);
    const textColor = ColorUtils.shouldUseLightTextOnColor(rectColor) ? colors.white : colors.black;

    return {
      bgColor,
      textColor,
      label: fieldOptions.label,
    };
  }, [fieldOptions, readonly]);

  return (
    <div className={cn('flex items-center h-8')}>
      <Button
        onClick={() => {
          if (readonly || !recordId) {
            return;
          }

          workflowTriggerFire(baseId, 'buttonClick', {
            tableId,
            recordId,
            fieldId: field.id,
          });
        }}
        className={cn('flex w-24 h-6', className)}
        style={{
          backgroundColor: button.bgColor,
          borderColor: button.bgColor,
          color: button.textColor,
        }}
        disabled={readonly}
      >
        <span className="w-full truncate text-sm">{button.label}</span>
      </Button>
    </div>
  );
};
