import type { IButtonClickStatusHook } from '../../hooks';
import type { Field } from '../../model';
import type { ICellEditor } from '../editor/type';

export interface ICellValueEditor<T = unknown> extends Omit<ICellEditor<T>, 'value'> {
  wrapClassName?: string;
  wrapStyle?: React.CSSProperties;
  cellValue?: T;
  field: Field;
  recordId?: string;
  buttonClickStatusHook?: IButtonClickStatusHook;
}
