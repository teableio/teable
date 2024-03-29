import type { FieldType } from '@teable/core';
import type { ICollaborator } from './user/types';

export interface ICellEditor<T> {
  className?: string;
  style?: React.CSSProperties;
  value?: T;
  onChange?: (value?: T) => void;
  readonly?: boolean;
  context?: ICellEditorContext;
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
  };
}
