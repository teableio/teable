import { Calendar } from '@teable-group/ui-lib';

export type IDateEditorMain = {
  value?: Date;
  style?: React.CSSProperties;
  onChange?: (value?: Date) => void;
};

export const DateEditorMain = (props: IDateEditorMain) => {
  const { value, style, onChange } = props;

  const onSelect = (value?: Date) => {
    onChange?.(value);
  };

  return (
    <Calendar
      style={style}
      mode="single"
      selected={value}
      onSelect={onSelect}
      className="rounded-md border"
    />
  );
};
