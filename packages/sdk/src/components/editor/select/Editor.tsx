import { X } from '@teable/icons';
import { Button, Popover, PopoverContent, PopoverTrigger, cn } from '@teable/ui-lib';
import { keyBy } from 'lodash';
import type { ForwardRefRenderFunction } from 'react';
import { forwardRef, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { SelectTag } from '../../cell-value/cell-select/SelectTag';
import type { IEditorRef } from '../type';
import type { ISelectEditorMain, ISelectValue } from './EditorMain';
import { SelectEditorMain } from './EditorMain';

const SelectEditorBase: ForwardRefRenderFunction<
  IEditorRef<string | string[] | undefined>,
  ISelectEditorMain<boolean>
> = (props, ref) => {
  const { value, options = [], isMultiple, onChange, className, style, readonly } = props;
  const [open, setOpen] = useState(false);
  const selectRef = useRef<HTMLButtonElement>(null);
  const editorRef = useRef<IEditorRef<string | string[] | undefined>>(null);

  const optionsMap = useMemo(() => keyBy(options, 'value'), [options]);
  const arrayValue = isMultiple ? (value as string[]) : value ? [value] : [];

  const displayOptions = arrayValue?.map((value) => optionsMap[value as string]).filter(Boolean);

  useImperativeHandle(ref, () => ({
    focus: () => editorRef.current?.focus?.(),
    setValue: (value?: string | string[]) => {
      editorRef.current?.setValue?.(value);
    },
  }));

  const onDelete = (val: string) => {
    const newValue = isMultiple ? (value as string[])?.filter((v) => v !== val) : undefined;
    onChange?.(newValue as ISelectValue<boolean>);
  };

  const onChangeInner = (val?: string | string[]) => {
    onChange?.(val as ISelectValue<boolean>);
    if (!isMultiple) {
      setOpen(false);
    }
  };

  const triggerContent = (
    <Button
      style={style}
      variant="outline"
      role="combobox"
      aria-expanded={open}
      className={cn(
        'w-full h-auto min-h-[32px] flex py-1 flex-wrap justify-start hover:bg-transparent gap-1.5 px-2',
        className
      )}
    >
      {displayOptions?.map(({ value, label, backgroundColor, color }) => (
        <SelectTag
          className="flex items-center"
          key={value}
          label={label}
          color={color}
          backgroundColor={backgroundColor}
        >
          {!readonly && (
            <X
              className="cursor-pointer opacity-50 hover:opacity-100"
              onClick={(e) => {
                e.preventDefault();
                onDelete(value);
              }}
            />
          )}
        </SelectTag>
      ))}
    </Button>
  );

  return (
    <>
      {readonly ? (
        triggerContent
      ) : (
        <Popover open={open} onOpenChange={setOpen} modal>
          <PopoverTrigger ref={selectRef} asChild>
            {triggerContent}
          </PopoverTrigger>
          <PopoverContent className="p-0" style={{ width: selectRef.current?.offsetWidth || 0 }}>
            <SelectEditorMain ref={editorRef} {...props} onChange={onChangeInner} />
          </PopoverContent>
        </Popover>
      )}
    </>
  );
};

export const SelectEditor = forwardRef(SelectEditorBase);
