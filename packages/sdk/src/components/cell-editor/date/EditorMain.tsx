import { Calendar } from '@teable-group/ui-lib';

export const DateEditorMain = (props: { value?: Date; onChange?: (value?: Date) => void }) => {
  const { value, onChange } = props;

  const onSelect = (value?: Date) => {
    onChange?.(value);
  };

  return (
    <Calendar mode="single" selected={value} onSelect={onSelect} className="rounded-md border" />
  );
};
