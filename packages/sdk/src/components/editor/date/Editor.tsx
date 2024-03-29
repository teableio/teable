import { TimeFormatting } from '@teable/core';
import { Calendar } from '@teable/icons';
import { Button, Popover, PopoverContent, PopoverTrigger, cn } from '@teable/ui-lib';
import dayjs, { extend } from 'dayjs';
import timezone from 'dayjs/plugin/timezone';
import type { ForwardRefRenderFunction } from 'react';
import { forwardRef, useImperativeHandle, useMemo, useRef } from 'react';
import { useTranslation } from '../../../context/app/i18n';
import type { IEditorRef } from '../type';
import type { IDateEditorMain } from './EditorMain';
import { DateEditorMain } from './EditorMain';

extend(timezone);

const DateEditorBase: ForwardRefRenderFunction<IEditorRef<string>, IDateEditorMain> = (
  props,
  ref
) => {
  const { value, onChange, className, readonly, options, disableTimePicker = false } = props;
  const {
    date,
    time,
    timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone,
  } = options?.formatting || {};
  const editorRef = useRef<IEditorRef<string>>(null);
  const { t } = useTranslation();

  useImperativeHandle(ref, () => ({
    setValue: (value?: string) => {
      editorRef.current?.setValue?.(value);
    },
  }));

  const valueComponent = useMemo(() => {
    if (!value) return <span className="text-xs">{t('editor.date.placeholder')}</span>;

    let format = 'YYYY-MM-DD HH:mm';
    if (date && time) {
      format = time === TimeFormatting.None ? date : `${date} ${time}`;
    }
    return dayjs(value).tz(timeZone).format(format);
  }, [value, t, date, time, timeZone]);

  return (
    <Popover>
      <PopoverTrigger asChild disabled={readonly}>
        <Button
          variant={'outline'}
          className={cn(
            'w-full first-line:pl-3 text-left font-normal h-10 sm:h-9',
            !value && 'text-muted-foreground',
            className
          )}
        >
          {valueComponent}
          <Calendar />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="start">
        <DateEditorMain
          ref={editorRef}
          value={value}
          options={options}
          disableTimePicker={disableTimePicker}
          onChange={onChange}
        />
      </PopoverContent>
    </Popover>
  );
};

export const DateEditor = forwardRef(DateEditorBase);
