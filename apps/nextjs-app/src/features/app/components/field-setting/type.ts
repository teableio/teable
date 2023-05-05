import type { IFieldRo } from '@teable-group/core';
import type { IFieldInstance } from '@teable-group/sdk/model';

export enum FieldOperator {
  Add,
  Edit,
}

export interface IFieldSetting {
  visible?: boolean;
  field?: IFieldInstance;
  operator?: FieldOperator;
  onConfirm?: (field: IFieldRo) => void;
  onCancel?: () => void;
}
