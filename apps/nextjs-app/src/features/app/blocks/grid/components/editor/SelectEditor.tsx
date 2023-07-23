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
import type { ISelectCell } from '../../renderers';
import type { IEditorProps, IEditorRef } from './EditorContainer';

const getFormatSelectValue = (value: string | string[]) => {
  return isString(value) ? [value] : ((value ?? []) as string[]);
};

const SelectEditorBase: ForwardRefRenderFunction<
  IEditorRef<ISelectCell>,
  IEditorProps<ISelectCell>
> = (props, ref) => {
  const { isEditing, cell, style, onChange } = props;
  const { data, isMultiple, choices = [] } = cell;
  const [values, setValues] = useState(getFormatSelectValue(data));
  const inputRef = useRef<HTMLInputElement | null>(null);

  const activeIndex = useKeyboardNavigation(choices.length, isEditing);

  useImperativeHandle(ref, () => ({
    focus: noop,
    setValue: (data: string[]) => {
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
      return onChange?.(value);
    }
    const value = newCellValue.length ? newCellValue : null;
    setValues(value || []);
    return onChange?.(value);
  };

  return (
    <Command className="rounded-sm shadow-sm p-2 border" style={style}>
      <CommandList>
        <CommandInput ref={inputRef} placeholder="Search" />
        <CommandEmpty>No found.</CommandEmpty>
        <CommandGroup aria-valuetext="name">
          {choices.map(({ bgColor, textColor, name }, index) => (
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
                className={classNames('px-2 rounded-lg text-ellipsis whitespace-nowrap')}
                style={{
                  backgroundColor: bgColor,
                  color: textColor,
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
