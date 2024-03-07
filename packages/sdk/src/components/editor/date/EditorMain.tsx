import { TimeFormatting, type IDateFieldOptions } from '@teable/core';
import { Calendar, Input } from '@teable/ui-lib';
import dayjs from 'dayjs';
import type { ForwardRefRenderFunction } from 'react';
import { forwardRef, useImperativeHandle, useMemo, useRef, useState } from 'react';
import type { ICellEditor, IEditorRef } from '../type';

export interface IDateEditorMain extends ICellEditor<string | null> {
  style?: React.CSSProperties;
  options?: IDateFieldOptions;
}

const DateEditorMainBase: ForwardRefRenderFunction<IEditorRef<string>, IDateEditorMain> = (
  props,
  ref
) => {
  const { value, style, className, onChange, readonly, options } = props;
  const inputRef = useRef<HTMLInputElement | null>(null);
  const { time } = options?.formatting || {};
  const [date, setDate] = useState<string | null>(value || null);
  const hasTimePicker = time !== TimeFormatting.None;
  const defaultFocusRef = useRef<HTMLInputElement | null>(null);

  useImperativeHandle(ref, () => ({
    focus: () => defaultFocusRef.current?.focus?.(),
    setValue: (value?: string) => setDate(value || null),
    saveValue,
  }));

  const onSelect = (value?: Date) => {
    let curDatetime = dayjs(value);
    const prevDatetime = dayjs(date);
    if (!curDatetime.isValid()) onChange?.(null);

    if (prevDatetime.isValid()) {
      const hours = prevDatetime.get('hour');
      const minutes = prevDatetime.get('minute');
      curDatetime = curDatetime.set('hour', hours).set('minute', minutes);
    }

    const dateStr = curDatetime.toISOString();

    setDate(dateStr);
    onChange?.(dateStr);
  };

  const timeValue = useMemo(() => {
    const datetime = dayjs(date);
    if (!datetime.isValid()) return '';
    return datetime.format('HH:mm');
  }, [date]);

  const selectedDate = useMemo(() => {
    const dateTime = dayjs(date);
    return dateTime.isValid() ? dateTime.toDate() : undefined;
  }, [date]);

  const onTimeChange: React.ChangeEventHandler<HTMLInputElement> = (e) => {
    const datetime = dayjs(date);
    if (!datetime.isValid()) return;
    const timeValue = e.target.value;
    const hours = Number.parseInt(timeValue.split(':')[0] || '00', 10);
    const minutes = Number.parseInt(timeValue.split(':')[1] || '00', 10);
    const modifiedDatetime = datetime.set('hour', hours).set('minute', minutes);
    setDate(modifiedDatetime.toISOString());
  };

  const saveValue = () => {
    if (value == date) return;
    onChange?.(date || null);
  };

  return (
    <>
      <Calendar
        style={style}
        mode="single"
        selected={selectedDate}
        defaultMonth={selectedDate}
        onSelect={onSelect}
        className={className}
        disabled={readonly}
        fromYear={1970}
        toYear={2100}
        captionLayout="dropdown-buttons"
        footer={
          hasTimePicker && date ? (
            <div className="flex items-center p-1">
              <Input
                ref={inputRef}
                type="time"
                value={timeValue}
                onChange={onTimeChange}
                onBlur={saveValue}
              />
            </div>
          ) : null
        }
      />
      <input className="size-0 opacity-0" ref={defaultFocusRef} />
    </>
  );
};

export const DateEditorMain = forwardRef(DateEditorMainBase);
