import { DateEditorMain } from '@teable-group/sdk';
import { useCallback, useMemo } from 'react';
import type { IEditorProps } from './type';

export const DateEditor = (props: IEditorProps) => {
  const { record, field, style } = props;
  const dateTime = record.getCellValue(field.id) as number;
  const setDateTime = useCallback(
    (selectedDay?: Date) => {
      record.updateCell(field.id, selectedDay ? selectedDay.toISOString() : null);
    },
    [field.id, record]
  );

  const value = useMemo(() => new Date(dateTime), [dateTime]);

  // TODO: Replace Date Editor
  return <DateEditorMain style={style} value={value} onChange={setDateTime} />;
};
