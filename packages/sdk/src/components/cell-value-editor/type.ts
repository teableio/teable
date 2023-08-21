import type { Field } from '../../model';
import type { ICellEditor } from '../editor/type';

export interface ICellValueEditor extends Omit<ICellEditor<unknown>, 'value'> {
  cellValue?: unknown;
  field: Field;
}
