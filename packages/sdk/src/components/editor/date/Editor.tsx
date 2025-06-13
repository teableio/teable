import { defaultDatetimeFormatting, formatDateToString } from '@teable/core';
import { Calendar as CalendarIcon } from '@teable/icons';
import { Button, Input, Popover, PopoverContent, PopoverTrigger, cn } from '@teable/ui-lib';
import dayjs from 'dayjs';
import type { ForwardRefRenderFunction } from 'react';
import { forwardRef, useImperativeHandle, useRef, useState, useEffect } from 'react';
import { useTranslation } from '../../../context/app/i18n';
import { useIsTouchDevice } from '../../../hooks';
import type { IEditorRef } from '../type';
import type { IDateEditorMain } from './EditorMain';
import { DateEditorMain } from './EditorMain';
import { convertZonedInputToUtc, formatDisplayValue } from './utils';

const DateEditorBase: ForwardRefRenderFunction<IEditorRef<string>, IDateEditorMain> = (
  props,
  ref
) => {
  const { value, onChange, className, readonly, options, disableTimePicker = false } = props;
  const editorRef = useRef<IEditorRef<string>>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const popoverTriggerRef = useRef<HTMLButtonElement>(null);
  const popoverContentRef = useRef<HTMLDivElement>(null);
  const [inputValue, setInputValue] = useState('');
  const [originalInputValue, setOriginalInputValue] = useState<string>('');
  const [isPopoverOpen, setPopoverOpen] = useState(false);
  const [isEditing, setEditing] = useState(false);
  const isTouchDevice = useIsTouchDevice();
  const { t } = useTranslation();

  const formatting = options?.formatting || defaultDatetimeFormatting;

  useImperativeHandle(ref, () => ({
    setValue: (value?: string) => {
      editorRef.current?.setValue?.(value);
    },
  }));

  useEffect(() => {
    setInputValue(formatDisplayValue(value || '', formatting));
  }, [value, formatting]);

  const onInputBlur = (e: React.FocusEvent<HTMLInputElement>) => {
    const relatedTarget = e.relatedTarget as HTMLElement;

    if (inputValue === originalInputValue) return;
    if (relatedTarget && popoverContentRef.current?.contains(relatedTarget)) return;

    const value = convertZonedInputToUtc(inputValue, formatting);
    onChange?.(value);
    setEditing(false);
  };

  const onInputClick = () => {
    setPopoverOpen(true);
    setEditing(true);
    setOriginalInputValue(inputValue);
    inputRef.current?.focus();
  };

  const onCalendarChange = (value: string | null | undefined) => {
    onChange?.(value);
    setEditing(false);
  };

  let displayStr = value || '';
  displayStr = dayjs(displayStr).isValid() ? formatDateToString(displayStr || '', formatting) : '';
  const placeholder = !readonly ? t('editor.date.placeholder') : '';

  return (
    <Popover open={isPopoverOpen} onOpenChange={setPopoverOpen}>
      {isTouchDevice ? (
        <PopoverTrigger asChild disabled={readonly}>
          <Button
            variant={'outline'}
            className={cn(
              'w-full first-line:pl-3 text-left font-normal h-10 sm:h-9',
              !value && 'text-muted-foreground',
              className
            )}
          >
            {displayStr || t('editor.date.placeholder')}
            <CalendarIcon />
          </Button>
        </PopoverTrigger>
      ) : (
        <PopoverTrigger ref={popoverTriggerRef} disabled={readonly} asChild>
          <div className="relative">
            <Input
              ref={inputRef}
              value={inputValue}
              readOnly={readonly}
              placeholder={placeholder}
              className={cn('w-full h-10 sm:h-8', className)}
              onChange={(e) => setInputValue(e.target.value)}
              onClick={onInputClick}
              onBlur={onInputBlur}
            />
            {!isEditing && (
              <Input
                className={cn(
                  'absolute left-0 top-0 w-full h-10 sm:h-8 shadow-none pointer-events-none disabled:opacity-100',
                  className
                )}
                placeholder={placeholder}
                value={displayStr}
                readOnly
              />
            )}
          </div>
        </PopoverTrigger>
      )}

      <PopoverContent
        className="w-auto p-0"
        align="start"
        ref={popoverContentRef}
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        <DateEditorMain
          ref={editorRef}
          value={value}
          options={options}
          disableTimePicker={disableTimePicker}
          onChange={onCalendarChange}
        />
      </PopoverContent>
    </Popover>
  );
};

export const DateEditor = forwardRef(DateEditorBase);
