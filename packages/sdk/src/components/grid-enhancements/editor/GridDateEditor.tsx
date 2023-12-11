import type { IDateFieldOptions } from '@teable-group/core';
import { TimeFormatting } from '@teable-group/core';
import { useCallback, useMemo } from 'react';
import { DateEditorMain } from '../../editor';
import type { IEditorProps } from '../../grid/components';
import type { IWrapperEditorProps } from './type';

export const GridDateEditor = (props: IWrapperEditorProps & IEditorProps) => {
  const { record, field, style, setEditing } = props;
  const dateTime = record.getCellValue(field.id) as number;
  const options = field.options as IDateFieldOptions;
  const timeFormatting = options?.formatting?.time;
  const setDateTime = useCallback(
    (selectedDay?: Date) => {
      record.updateCell(field.id, selectedDay ? selectedDay.toISOString() : null);
      if (timeFormatting === TimeFormatting.None) {
        setEditing?.(false);
      }
    },
    [field.id, record, setEditing, timeFormatting]
  );

  const value = useMemo(() => new Date(dateTime), [dateTime]);

  return (
    <DateEditorMain
      className="rounded-md border bg-background"
      style={style}
      value={value}
      options={options}
      onChange={setDateTime}
    />
  );
};
