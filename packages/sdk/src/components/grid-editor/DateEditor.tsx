import { useCallback, useMemo } from 'react';
import { DateEditorMain } from '../editor';
import type { IWrapperEditorProps } from './type';

export const DateEditor = (props: IWrapperEditorProps) => {
  const { record, field, style } = props;
  const dateTime = record.getCellValue(field.id) as number;
  const setDateTime = useCallback(
    (selectedDay?: Date) => {
      record.updateCell(field.id, selectedDay ? selectedDay.toISOString() : null);
    },
    [field.id, record]
  );

  const value = useMemo(() => new Date(dateTime), [dateTime]);

  return (
    <DateEditorMain
      className="rounded-md border bg-background"
      style={style}
      value={value}
      onChange={setDateTime}
    />
  );
};
