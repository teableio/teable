import { TimeFormatting, type IDateFieldOptions } from '@teable-group/core';
import { Calendar, Input } from '@teable-group/ui-lib';
import dayjs from 'dayjs';
import type { ForwardRefRenderFunction } from 'react';
import { forwardRef, useImperativeHandle, useMemo, useRef, useState } from 'react';
import type { ICellEditor, IEditorRef } from '../type';

export interface IDateEditorMain extends ICellEditor<string> {
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
  const [date, setDate] = useState<string | undefined>(value);
  const hasTimePicker = time !== TimeFormatting.None;
  const selectedValue = dayjs(date);

  useImperativeHandle(ref, () => ({
    setValue: (value?: string) => setDate(value),
  }));

  const onSelect = (value?: Date) => {
    let curDatetime = dayjs(value);
    const prevDatetime = dayjs(date);
    if (!curDatetime.isValid()) onChange?.(undefined);

    if (prevDatetime.isValid()) {
      const hours = prevDatetime.get('hour');
      const minutes = prevDatetime.get('minute');
      curDatetime = curDatetime.set('hour', hours).set('minute', minutes);
    }
    onChange?.(curDatetime.toISOString());
  };

  const timeValue = useMemo(() => {
    const datetime = dayjs(date);
    if (!datetime.isValid()) return;
    return datetime.format('HH:mm');
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

  const onBlur = () => {
    onChange?.(date);
  };

  return (
    <Calendar
      style={style}
      mode="single"
      selected={selectedValue.isValid() ? selectedValue.toDate() : undefined}
      onSelect={onSelect}
      className={className}
      disabled={readonly}
      footer={
        hasTimePicker && dayjs(value).isValid() ? (
          <div className="flex items-center px-1 py-2">
            <Input
              ref={inputRef}
              type="time"
              value={timeValue}
              onChange={onTimeChange}
              onBlur={onBlur}
            />
          </div>
        ) : null
      }
    />
  );
};

export const DateEditorMain = forwardRef(DateEditorMainBase);
