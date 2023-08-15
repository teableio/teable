import type { Field } from '../../model';

export interface ICellValueEditor {
  style?: React.CSSProperties;
  className?: string;
  cellValue?: unknown;
  field: Field;
  onChange?: (value?: unknown) => void;
}
