import { X } from '@teable-group/icons';
import { Button, Popover, PopoverContent, PopoverTrigger } from '@teable-group/ui-lib';
import classNames from 'classnames';
import { useRef, useState } from 'react';
import type { ISelectEditorMain, ISelectValue } from './EditorMain';
import { SelectEditorMain } from './EditorMain';
import { SelectTag } from './SelectTag';

export const SelectEditor = <T extends boolean = false>(props: ISelectEditorMain<T>) => {
  const { value, options = [], isMultiple, onChange, className, style } = props;
  const [open, setOpen] = useState(false);
  const selectRef = useRef<HTMLButtonElement>(null);

  const displayOptions = options.filter((option) =>
    isMultiple ? value?.includes(option.value) : value === option.value
  );

  const onDelete = (val: string) => {
    const newValue = isMultiple ? (value as string[])?.filter((v) => v === val) : undefined;
    onChange?.(newValue as ISelectValue<T>);
  };

  const onChangeInner = (val?: ISelectValue<T>) => {
    onChange?.(val);
    if (!isMultiple) {
      setOpen(false);
    }
  };

  return (
    <Popover open={open} onOpenChange={setOpen} modal>
      <PopoverTrigger ref={selectRef} asChild>
        <Button
          style={style}
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className={classNames(
            'w-full h-auto min-h-[32px] flex flex-wrap justify-start hover:bg-transparent',
            className
          )}
        >
          {displayOptions.map(({ value, label, backgroundColor, color }) => (
            <SelectTag
              className="mr-2 flex items-center"
              key={value}
              label={label}
              color={color}
              backgroundColor={backgroundColor}
            >
              {
                <X
                  className="cursor-pointer opacity-50 hover:opacity-100"
                  onClick={(e) => {
                    e.preventDefault();
                    onDelete(value);
                  }}
                />
              }
            </SelectTag>
          ))}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="p-0" style={{ width: selectRef.current?.offsetWidth || 0 }}>
        <SelectEditorMain {...props} onChange={onChangeInner} />
      </PopoverContent>
    </Popover>
  );
};
