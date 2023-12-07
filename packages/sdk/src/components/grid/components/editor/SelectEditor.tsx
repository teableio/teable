import { Check } from '@teable-group/icons';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@teable-group/ui-lib';
import classNames from 'classnames';
import { noop } from 'lodash';
import { forwardRef, useImperativeHandle, useRef, useState } from 'react';
import type { ForwardRefRenderFunction } from 'react';
import type { ISelectCell } from '../../renderers';
import type { IEditorProps, IEditorRef } from './EditorContainer';

const SelectEditorBase: ForwardRefRenderFunction<
  IEditorRef<ISelectCell>,
  IEditorProps<ISelectCell>
> = (props, ref) => {
  const { cell, isEditing, style, onChange, setEditing } = props;
  const { data, isMultiple, choices = [] } = cell;
  const [values, setValues] = useState(data);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useImperativeHandle(ref, () => ({
    focus: () => inputRef.current?.focus(),
    setValue: (data: ISelectCell['data']) => setValues(data),
    saveValue: noop,
  }));

  const onSelect = (v: string, id?: string) => {
    const existIndex = values.findIndex((item) => {
      if (typeof item === 'string') return item === v;
      return item.title === v;
    });
    const newCellValue =
      existIndex > -1
        ? values.filter((_, index) => index !== existIndex)
        : [...values, id ? { id, title: v } : v];
    if (!isMultiple) {
      const value = newCellValue.length ? newCellValue[newCellValue.length - 1] : null;
      setTimeout(() => setEditing?.(false));
      setValues(value ? [value] : []);
      return onChange?.(value);
    }
    const value = newCellValue.length ? newCellValue : null;
    setValues(value || []);
    return onChange?.(value);
  };

  return (
    <Command className="rounded-sm border p-2 shadow-sm" style={style}>
      <CommandInput ref={inputRef} placeholder="Search" />
      <CommandList>
        <CommandEmpty>No found.</CommandEmpty>
        <CommandGroup aria-valuetext="name">
          {isEditing &&
            choices.map(({ bgColor, textColor, name, id }) => (
              <CommandItem key={name} value={name} onSelect={() => onSelect(name, id)}>
                <Check
                  className={classNames(
                    'mr-2 h-4 w-4',
                    values?.includes(name) ? 'opacity-100' : 'opacity-0'
                  )}
                />
                <div
                  className="text-ellipsis whitespace-nowrap rounded-[6px] px-2 text-[12px]"
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
