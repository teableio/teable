import type { FieldType } from '@teable/core';
import type { ICollaborator } from './user/types';

export interface ICellEditor<T> {
  className?: string;
  style?: React.CSSProperties;
  value?: T;
  readonly?: boolean;
  saveOnBlur?: boolean;
  context?: ICellEditorContext;
  onChange?: (value?: T) => void;
}

export interface IEditorRef<T> {
  focus?: () => void;
  setValue?: (value?: T) => void;
  saveValue?: () => void;
}

export interface ICellEditorContext {
  [FieldType.User]: {
    isLoading?: boolean;
    data?: ICollaborator[];
    onSearch?: (value: string) => void;
  };
}
