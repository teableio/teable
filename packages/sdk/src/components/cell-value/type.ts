export interface ICellValue<T> {
  value?: T;
  className?: string;
  style?: React.CSSProperties;
  maxWidth?: number;
  ellipsis?: boolean;
}
