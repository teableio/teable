import { DateEditorMain } from '@teable-group/sdk';
import type { IEditorProps } from './type';

export const DateEditor = (props: IEditorProps) => {
  const { record, field } = props;
  const dateTime = record.getCellValue(field.id) as number;
  const setDateTime = (selectedDay?: Date) => {
    record.updateCell(field.id, selectedDay ? selectedDay.toISOString() : null);
  };

  // TODO: Replace Date Editor
  return <DateEditorMain value={new Date(dateTime)} onChange={setDateTime} />;
};
