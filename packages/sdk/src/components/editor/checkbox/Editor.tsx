import { Checkbox, cn } from '@teable-group/ui-lib';
import type { ICellEditor } from '../type';

type ICheckboxEditor = ICellEditor<boolean>;

export const CheckboxEditor = (props: ICheckboxEditor) => {
  const { value, onChange, className, style, disabled } = props;

  return (
    <Checkbox
      style={style}
      className={cn('w-6 h-6', className)}
      checked={Boolean(value)}
      onCheckedChange={(checked) => {
        onChange?.(Boolean(checked));
      }}
      disabled={disabled}
    />
  );
};
