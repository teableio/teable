import { Calendar, Input } from '@teable-group/ui-lib';
import dayjs from 'dayjs';
import { useMemo } from 'react';
import type { ICellEditor } from '../type';

export interface IDateEditorMain extends ICellEditor<Date> {
  style?: React.CSSProperties;
}

export const DateEditorMain = (props: IDateEditorMain) => {
  const { value, style, className, onChange, disabled } = props;

  const onSelect = (value?: Date) => {
    onChange?.(value);
  };

  const timeValue = useMemo(() => {
    const datetime = dayjs(value);
    if (!datetime.isValid()) return;
    return datetime.format('HH:mm');
  }, [value]);

  const onTimeChange: React.ChangeEventHandler<HTMLInputElement> = (e) => {
    const datetime = dayjs(value);
    if (!datetime.isValid()) return;
    const timeValue = e.target.value;
    const hours = Number.parseInt(timeValue.split(':')[0] || '00', 10);
    const minutes = Number.parseInt(timeValue.split(':')[1] || '00', 10);
    const modifiedDatetime = datetime.set('hour', hours).set('minute', minutes);

    onChange?.(modifiedDatetime.toDate());
  };

  return (
    <Calendar
      style={style}
      mode="single"
      selected={value}
      onSelect={onSelect}
      className={className}
      disabled={disabled}
      footer={
        dayjs(value).isValid() ? (
          <div className="flex items-center py-2 px-1">
            <Input type="time" value={timeValue} onChange={onTimeChange} />
          </div>
        ) : null
      }
    />
  );
};
