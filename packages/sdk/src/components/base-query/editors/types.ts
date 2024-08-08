export interface IQueryEditorProps<T> {
  value?: T;
  onChange: (value?: T) => void;
}
