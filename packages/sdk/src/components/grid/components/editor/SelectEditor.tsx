import { Check } from '@teable/icons';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@teable/ui-lib';
import { noop } from 'lodash';
import { forwardRef, useImperativeHandle, useRef, useState } from 'react';
import type { ForwardRefRenderFunction } from 'react';
import type { ISelectCell } from '../../renderers';
import type { IEditorProps, IEditorRef } from './EditorContainer';

const SelectEditorBase: ForwardRefRenderFunction<
  IEditorRef<ISelectCell>,
  IEditorProps<ISelectCell>
> = (props, ref) => {
  const { cell, isEditing, style, onChange, setEditing, theme } = props;
  const { data, isMultiple, choiceSorted = [], choiceMap = {} } = cell;
  const [values, setValues] = useState(data);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const { cellOptionBg, cellOptionTextColor } = theme;

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
            choiceSorted.map(({ name, id }) => (
              <CommandItem
                className="justify-between"
                key={name}
                value={name}
                onSelect={() => onSelect(name, id)}
              >
                <div
                  className="text-ellipsis whitespace-nowrap rounded-[6px] px-2 text-[12px]"
                  style={{
                    backgroundColor:
                      (choiceMap?.[id] ?? choiceMap?.[name])?.backgroundColor ?? cellOptionBg,
                    color: (choiceMap?.[id] ?? choiceMap?.[name])?.color ?? cellOptionTextColor,
                  }}
                >
                  {name}
                </div>
                {values?.includes(name) && <Check className={'ml-2 size-4'} />}
              </CommandItem>
            ))}
        </CommandGroup>
      </CommandList>
    </Command>
  );
};

export const SelectEditor = forwardRef(SelectEditorBase);
