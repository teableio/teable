import type { CellValueType, IFieldRo, IFieldVo } from '@teable-group/core';

export enum FieldOperator {
  Add,
  Edit,
  Insert,
}

export interface IFieldSetting {
  visible?: boolean;
  order?: number;
  field?: IFieldVo;
  operator: FieldOperator;
  onConfirm?: (field: IFieldRo) => void;
  onCancel?: () => void;
}

export type IFieldEditorRo = Partial<IFieldRo> & {
  cellValueType?: CellValueType;
  isMultipleCellValue?: boolean;
};
