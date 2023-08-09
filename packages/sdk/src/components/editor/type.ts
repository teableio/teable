export interface ICellEditor<T> {
  value?: T;
  onChange?: (value?: T) => void;
}
