import { Check, Plus } from '@teable/icons';
import {
  Button,
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  cn,
  useCommandState,
} from '@teable/ui-lib';
import type { ForwardRefRenderFunction } from 'react';
import { forwardRef, useCallback, useImperativeHandle, useRef, useState } from 'react';
import { SelectTag } from '../../cell-value/cell-select/SelectTag';
import type { ICellEditor, IEditorRef } from '../type';

export type ISelectValue<T extends boolean> = T extends true ? string[] : string;

export interface ISelectEditorMain<T extends boolean> extends ICellEditor<ISelectValue<T>> {
  options?: {
    label: string;
    value: string;
    color?: string;
    backgroundColor?: string;
  }[];
  isMultiple?: T;
  style?: React.CSSProperties;
  className?: string;
  onOptionAdd?: (name: string) => Promise<void>;
}

const getValue = (value?: string | string[]) => {
  if (value == null) return [];
  if (Array.isArray(value)) return value;
  return [value];
};

const SelectEditorMainBase: ForwardRefRenderFunction<
  IEditorRef<string | string[] | undefined>,
  ISelectEditorMain<boolean>
> = (props, ref) => {
  const {
    value: originValue,
    options = [],
    isMultiple,
    style,
    className,
    onChange,
    onOptionAdd,
  } = props;

  const [value, setValue] = useState<string[]>(getValue(originValue));
  const [searchValue, setSearchValue] = useState('');
  const inputRef = useRef<HTMLInputElement | null>(null);

  useImperativeHandle(ref, () => ({
    focus: () => {
      setSearchValue('');
      inputRef.current?.focus();
    },
    setValue: (value?: string | string[]) => {
      setValue(getValue(value));
    },
  }));

  const onSelect = (val: string) => {
    setSearchValue('');
    if (isMultiple) {
      const newValue = value.includes(val) ? value.filter((v) => v !== val) : value.concat(val);
      return onChange?.(newValue);
    }
    onChange?.(val === value[0] ? undefined : val);
  };

  const checkIsActive = useCallback(
    (v: string) => {
      return isMultiple ? value.includes(v) : value[0] === v;
    },
    [isMultiple, value]
  );

  const onOptionAddInner = async () => {
    if (!searchValue) return;
    setSearchValue('');
    await onOptionAdd?.(searchValue);
    if (isMultiple) {
      const newValue = value.concat(searchValue);
      setValue(newValue);
      return onChange?.(newValue);
    }
    setValue([searchValue]);
    onChange?.(searchValue);
  };

  const addOptionText = `Add an option '${searchValue}'`;
  const optionAddable = searchValue && options.findIndex((v) => v.value === searchValue) === -1;

  return (
    <Command className={className} style={style}>
      <SearchInput
        reRef={inputRef}
        searchValue={searchValue}
        setSearchValue={setSearchValue}
        onOptionAdd={onOptionAddInner}
      />
      <CommandList>
        <CommandEmpty className="p-2">
          <Button variant={'ghost'} size={'sm'} className="w-full text-sm">
            <Plus className="size-4" />
            <span className="ml-2">{addOptionText}</span>
          </Button>
        </CommandEmpty>
        <CommandGroup aria-valuetext="name">
          {options.map(({ label, value, backgroundColor, color }) => (
            <CommandItem
              className="justify-between"
              key={value}
              value={value}
              onSelect={() => onSelect(value)}
            >
              <SelectTag
                label={label || 'Untitled'}
                backgroundColor={backgroundColor}
                color={color}
              />
              {checkIsActive(value) && <Check className={'ml-2 size-4'} />}
            </CommandItem>
          ))}
          <CommandItem
            className={cn('items-center justify-center', !optionAddable && 'opacity-0 h-0 p-0')}
            onSelect={onOptionAddInner}
          >
            <Plus className="size-4 shrink-0" />
            <span className="ml-2 truncate">{addOptionText}</span>
          </CommandItem>
        </CommandGroup>
      </CommandList>
    </Command>
  );
};

export const SelectEditorMain = forwardRef(SelectEditorMainBase);

const SearchInput = ({
  reRef,
  searchValue,
  setSearchValue,
  onOptionAdd,
}: {
  reRef: React.Ref<HTMLInputElement>;
  searchValue: string;
  setSearchValue: (value: string) => void;
  onOptionAdd: () => Promise<void>;
}) => {
  const isEmpty = useCommandState((state) => state.filtered.count === 1);

  return (
    <CommandInput
      ref={reRef}
      placeholder="Search option"
      value={searchValue}
      onValueChange={(value) => setSearchValue(value)}
      onKeyDown={async (e) => {
        if (e.key === 'Enter' && isEmpty) {
          e.stopPropagation();
          await onOptionAdd();
        }
      }}
    />
  );
};
