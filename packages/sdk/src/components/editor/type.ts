export interface ICellEditor<T> {
  className?: string;
  style?: React.CSSProperties;
  value?: T;
  onChange?: (value?: T) => void;
  disabled?: boolean;
}
