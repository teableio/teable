import type { Field } from '../../model';
import type { ICellEditor } from '../editor/type';

export interface ICellValueEditor extends Omit<ICellEditor<unknown>, 'value'> {
  wrapClassName?: string;
  wrapStyle?: React.CSSProperties;
  cellValue?: unknown;
  field: Field;
  recordId?: string;
}
