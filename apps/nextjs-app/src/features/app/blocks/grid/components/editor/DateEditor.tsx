import { Calendar } from '@teable-group/ui-lib/shadcn/ui/calendar';
import { noop } from 'lodash';
import { useImperativeHandle, useState, forwardRef } from 'react';
import type { ForwardRefRenderFunction } from 'react';
import type { IDateCell } from '../../interface';
import type { IEditorProps, IEditorRef } from './EditorContainer';

export const DateEditorBase: ForwardRefRenderFunction<
  IEditorRef<IDateCell>,
  IEditorProps<IDateCell>
> = (props, ref) => {
  const { cell, style, onChange } = props;
  const [dateTime, setDateTime] = useState(cell.data);

  const onSelect = (day: Date | undefined, selectedDay: Date) => {
    const date = selectedDay.toISOString();
    setDateTime(date);
    onChange?.(date);
  };

  useImperativeHandle(ref, () => ({
    focus: noop,
    setValue: (data: string) => setDateTime(data),
    saveValue: noop,
  }));

  return (
    <Calendar
      style={style}
      mode="single"
      selected={new Date(dateTime)}
      onSelect={onSelect}
      className="rounded-md border"
    />
  );
};

export const DateEditor = forwardRef(DateEditorBase);
