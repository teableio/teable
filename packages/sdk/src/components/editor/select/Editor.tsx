import { X } from '@teable/icons';
import { Button, Popover, PopoverContent, PopoverTrigger, cn } from '@teable/ui-lib';
import { keyBy } from 'lodash';
import type { ForwardRefRenderFunction } from 'react';
import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
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
  const contentRef = useRef<HTMLDivElement>(null);

  const optionsMap = useMemo(() => keyBy(options, 'value'), [options]);
  const arrayValue = isMultiple
    ? Array.isArray(value)
      ? (value as string[])
      : value
        ? [value as string]
        : []
    : value
      ? [value]
      : [];

  const displayOptions = arrayValue?.map((value) => optionsMap[value as string]).filter(Boolean);

  // Nested modal Popover sets ExpandRecord DialogContent to pointer-events:none
  // (T7102). Dialog also preventDefaults interact-outside, so Radix dismiss
  // cannot close the list — match DateEditor and listen in capture phase.
  useEffect(() => {
    if (!open) return;

    const handlePointerDown = (e: PointerEvent) => {
      const target = e.target as Node | null;
      if (target && !contentRef.current?.contains(target) && !selectRef.current?.contains(target)) {
        setOpen(false);
      }
    };

    document.addEventListener('pointerdown', handlePointerDown, true);
    return () => document.removeEventListener('pointerdown', handlePointerDown, true);
  }, [open]);

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
        'w-full h-auto min-h-9 flex py-1 flex-wrap dark:bg-[color-mix(in_oklab,white_5%,hsl(var(--background)))] hover:border-primary/30 hover:bg-background dark:hover:bg-[color-mix(in_oklab,white_5%,hsl(var(--background)))] justify-start gap-1.5 px-2',
        className
      )}
    >
      {displayOptions?.map(({ value, label, backgroundColor, color }) => (
        <SelectTag
          className={cn('flex items-center', !readonly && 'pe-1.5')}
          key={value}
          label={label}
          color={color}
          backgroundColor={backgroundColor}
        >
          {!readonly && (
            <X
              className="size-[14px] shrink-0 cursor-pointer opacity-70 hover:opacity-100"
              style={{ color: 'inherit' }}
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
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger ref={selectRef} asChild>
            {triggerContent}
          </PopoverTrigger>
          <PopoverContent
            ref={contentRef}
            className="p-0"
            style={{ width: selectRef.current?.offsetWidth || 0 }}
          >
            <SelectEditorMain ref={editorRef} {...props} onChange={onChangeInner} />
          </PopoverContent>
        </Popover>
      )}
    </>
  );
};

export const SelectEditor = forwardRef(SelectEditorBase);
