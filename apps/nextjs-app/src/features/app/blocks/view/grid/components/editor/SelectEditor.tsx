import type { ISelectFieldOptions } from '@teable-group/core';
import { FieldType, ColorUtils } from '@teable-group/core';
import { SelectEditorMain } from '@teable-group/sdk/components';
import { isString } from 'lodash';
import { useMemo } from 'react';
import type { IEditorProps } from './type';

export const SelectEditor = (props: IEditorProps) => {
  const { field, record, style, onCancel } = props;
  const cellValue = record.getCellValue(field.id);
  const values = isString(cellValue) ? [cellValue] : ((cellValue ?? []) as string[]);
  const selectComOptions = useMemo(() => {
    const choices = (field?.options as ISelectFieldOptions)?.choices || [];
    return choices.map(({ name, color }) => ({
      label: name,
      value: name,
      color: ColorUtils.shouldUseLightTextOnColor(color) ? '#ffffff' : '#000000',
      backgroundColor: ColorUtils.getHexForColor(color),
    }));
  }, [field?.options]);

  const isMultiple = field.type === FieldType.MultipleSelect;

  const onChange = (value?: string[]) => {
    record.updateCell(field.id, value?.length ? (isMultiple ? value : value[0]) : null);
    !isMultiple && onCancel?.();
  };

  return (
    <SelectEditorMain
      style={style}
      value={values}
      onChange={onChange}
      isMultiple={isMultiple}
      options={selectComOptions}
    />
  );
};
