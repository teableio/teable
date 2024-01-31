import { TimeFormatting } from '@teable/core';
import { Calendar } from '@teable/icons';
import { Button, Popover, PopoverContent, PopoverTrigger } from '@teable/ui-lib';
import classNames from 'classnames';
import dayjs from 'dayjs';
import type { ForwardRefRenderFunction } from 'react';
import { forwardRef, useImperativeHandle, useMemo, useRef } from 'react';
import { useTranslation } from '../../../context/app/i18n';
import type { IEditorRef } from '../type';
import type { IDateEditorMain } from './EditorMain';
import { DateEditorMain } from './EditorMain';

const DateEditorBase: ForwardRefRenderFunction<IEditorRef<string>, IDateEditorMain> = (
  props,
  ref
) => {
  const { value, onChange, className, readonly, options } = props;
  const { date, time } = options?.formatting || {};
  const editorRef = useRef<IEditorRef<string>>(null);
  const { t } = useTranslation();

  useImperativeHandle(ref, () => ({
    setValue: (value?: string) => {
      editorRef.current?.setValue?.(value);
    },
  }));

  const valueComponent = useMemo(() => {
    if (!value) return <span>{t('editor.date.placeholder')}</span>;

    let format = 'YYYY-MM-DD HH:mm';
    if (date && time) {
      format = time === TimeFormatting.None ? date : `${date} ${time}`;
    }
    return dayjs(value).format(format);
  }, [value, t, date, time]);

  return (
    <Popover>
      <PopoverTrigger asChild disabled={readonly}>
        <Button
          variant={'outline'}
          className={classNames(
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
        <DateEditorMain ref={editorRef} value={value} options={options} onChange={onChange} />
      </PopoverContent>
    </Popover>
  );
};

export const DateEditor = forwardRef(DateEditorBase);
