import type { SelectFieldOptions } from '@teable-group/core';
import { FieldType, ColorUtils } from '@teable-group/core';
import SelectIcon from '@teable-group/ui-lib/icons/app/select.svg';
import classNames from 'classnames';
import { isString } from 'lodash';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import type { IEditorProps } from './type';

export const SelectEditor = (props: IEditorProps) => {
  const { field, record, style, onCancel } = props;
  const cellValue = record.getCellValue(field.id);
  const values = isString(cellValue) ? [cellValue] : ((cellValue ?? []) as string[]);
  const choices = (field?.options as SelectFieldOptions)?.choices || [];

  const onSelect = (v: string) => {
    let newCellValue = null;
    const existIndex = values.findIndex((item) => item === v);
    if (existIndex > -1) {
      newCellValue = values.slice();
      newCellValue.splice(existIndex, 1);
    } else {
      newCellValue = [...values, v];
    }
    if (field.type === FieldType.SingleSelect) {
      record.updateCell(
        field.id,
        newCellValue.length ? newCellValue[newCellValue.length - 1] : null
      );
      onCancel?.();
      return;
    }
    record.updateCell(field.id, newCellValue.length ? newCellValue : null);
  };

  return (
    <Command className="rounded-sm shadow-sm p-2 border" style={style}>
      <CommandList>
        <CommandInput placeholder="Search option" />
        <CommandEmpty>No found.</CommandEmpty>
        <CommandGroup aria-valuetext="name">
          {choices.map(({ color, name }) => (
            <CommandItem key={name} value={name} onSelect={onSelect}>
              <SelectIcon
                className={classNames(
                  'mr-2 h-4 w-4',
                  values?.includes(name) ? 'opacity-100' : 'opacity-0'
                )}
              />
              <div
                className={classNames('px-2 rounded-lg')}
                style={{
                  backgroundColor: ColorUtils.getHexForColor(color),
                  color: ColorUtils.shouldUseLightTextOnColor(color) ? '#ffffff' : '#000000',
                }}
              >
                {name}
              </div>
            </CommandItem>
          ))}
        </CommandGroup>
      </CommandList>
    </Command>
  );
};
