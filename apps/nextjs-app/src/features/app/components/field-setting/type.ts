import type { IFieldRo } from '@teable-group/core';
import type { IFieldInstance } from '@teable-group/sdk/model';

export enum FieldOperator {
  Add,
  Edit,
  Insert,
}

export interface IFieldSetting {
  visible?: boolean;
  order?: number;
  field?: IFieldInstance;
  operator: FieldOperator;
  onConfirm?: (field: IFieldRo) => void;
  onCancel?: () => void;
}
