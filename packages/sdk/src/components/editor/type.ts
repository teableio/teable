export interface ICellEditor<T> {
  className?: string;
  style?: React.CSSProperties;
  value?: T;
  onChange?: (value?: T) => void;
  readonly?: boolean;
}

export interface IEditorRef<T> {
  focus?: () => void;
  setValue?: (value?: T) => void;
  saveValue?: () => void;
}
