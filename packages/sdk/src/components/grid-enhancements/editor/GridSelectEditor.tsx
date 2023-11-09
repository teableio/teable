import type {
  IMultipleSelectCellValue,
  ISelectFieldOptions,
  ISingleSelectCellValue,
} from '@teable-group/core';
import { FieldType, ColorUtils } from '@teable-group/core';
import { useMemo } from 'react';
import { SelectEditorMain } from '../../editor';
import type { IWrapperEditorProps } from './type';

export const GridSelectEditor = (props: IWrapperEditorProps) => {
  const { field, record, style, onCancel } = props;
  const cellValue = record.getCellValue(field.id) as
    | ISingleSelectCellValue
    | IMultipleSelectCellValue;
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

  const onChange = (value?: string[] | string) => {
    record.updateCell(field.id, isMultiple && value?.length === 0 ? null : value);
    !isMultiple && onCancel?.();
  };

  return (
    <SelectEditorMain
      style={style}
      value={cellValue === null ? undefined : cellValue}
      onChange={onChange}
      isMultiple={isMultiple}
      options={selectComOptions}
    />
  );
};
