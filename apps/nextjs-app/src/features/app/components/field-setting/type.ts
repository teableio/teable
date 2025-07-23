import type { CellValueType, IFieldRo, IFieldVo } from '@teable/core';

export enum FieldOperator {
  Add = 'add',
  Edit = 'edit',
  Insert = 'insert',
}

export interface IFieldSetting {
  visible?: boolean;
  order?: number;
  field?: IFieldVo;
  operator: FieldOperator;
  onConfirm?: (field?: IFieldVo) => void;
  onCancel?: () => void;
}

export type IFieldSettingBase = IFieldSetting & {
  onConfirm?: (field: IFieldRo) => void;
};

export type IFieldEditorRo = Partial<IFieldRo> & {
  cellValueType?: CellValueType;
  isMultipleCellValue?: boolean;
};
