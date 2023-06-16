import { Calendar } from '@/components/ui/calendar';
import type { IEditorProps } from './type';

export const DateEditor = (props: IEditorProps) => {
  const { record, field } = props;
  const dateTime = record.getCellValue(field.id) as number;
  const setDateTime = (day: Date | undefined, selectedDay: Date) => {
    record.updateCell(field.id, selectedDay.toISOString());
  };

  return (
    <Calendar
      mode="single"
      selected={new Date(dateTime)}
      onSelect={setDateTime}
      className="rounded-md border"
    />
  );
};
