import { Checkbox, cn } from '@teable/ui-lib';
import type { ICellEditor } from '../type';

type ICheckboxEditor = ICellEditor<boolean | null>;

export const CheckboxEditor = (props: ICheckboxEditor) => {
  const { value, onChange, className, style, readonly } = props;

  return (
    <Checkbox
      style={style}
      className={cn('w-6 h-6', className)}
      checked={Boolean(value)}
      onCheckedChange={(checked) => {
        onChange?.(checked ? true : null);
      }}
      disabled={readonly}
    />
  );
};
