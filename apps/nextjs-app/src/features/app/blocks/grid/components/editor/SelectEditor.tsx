import type { ISelectFieldOptions } from '@teable-group/core';
import { ColorUtils } from '@teable-group/core';
import SelectIcon from '@teable-group/ui-lib/icons/app/select.svg';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@teable-group/ui-lib/shadcn/ui/command';
import classNames from 'classnames';
import { isString, noop } from 'lodash';
import { forwardRef, useImperativeHandle, useRef, useState } from 'react';
import type { ForwardRefRenderFunction } from 'react';
import { useKeyboardNavigation } from '../../hooks';
import type { ISelectCell, ISelectCellData } from '../../renderers';
import type { IEditorProps, IEditorRef } from './EditorContainer';

const getFormatSelectValue = (data: ISelectCellData) => {
  const { value } = data;
  return isString(value) ? [value] : ((value ?? []) as string[]);
};

const SelectEditorBase: ForwardRefRenderFunction<
  IEditorRef<ISelectCell>,
  IEditorProps<ISelectCell>
> = (props, ref) => {
  const { isEditing, cell, style, onChange } = props;
  const { data, isMultiple } = cell;
  const { options } = data;
  const [values, setValues] = useState(getFormatSelectValue(data));
  const choices = (options as ISelectFieldOptions)?.choices || [];
  const inputRef = useRef<HTMLInputElement | null>(null);

  const activeIndex = useKeyboardNavigation(choices.length, isEditing);

  useImperativeHandle(ref, () => ({
    // focus: () => inputRef.current?.focus(),
    focus: noop,
    setValue: (data: ISelectCellData) => {
      const value = getFormatSelectValue(data);
      setValues(value);
    },
    saveValue: () => {
      activeIndex > -1 && onSelect(choices[activeIndex].name);
    },
  }));

  const onSelect = (v: string) => {
    const existIndex = values.findIndex((item) => item === v);
    const newCellValue = existIndex > -1 ? values.filter((item) => item !== v) : [...values, v];
    if (!isMultiple) {
      const value = newCellValue.length ? newCellValue[newCellValue.length - 1] : null;
      setValues(value ? [value] : []);
      return onChange?.({ options, value });
    }
    const value = newCellValue.length ? newCellValue : null;
    setValues(value || []);
    return onChange?.({ options, value });
  };

  return (
    <Command className="rounded-sm shadow-sm p-2 border" style={style}>
      <CommandList>
        <CommandInput ref={inputRef} placeholder="Search" />
        <CommandEmpty>No found.</CommandEmpty>
        <CommandGroup aria-valuetext="name">
          {choices.map(({ color, name }, index) => (
            <CommandItem
              key={name}
              value={name}
              className={classNames(activeIndex === index ? 'bg-accent' : 'bg-transparent')}
              onSelect={() => onSelect(name)}
            >
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

export const SelectEditor = forwardRef(SelectEditorBase);
