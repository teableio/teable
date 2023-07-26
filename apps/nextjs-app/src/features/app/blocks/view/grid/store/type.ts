import type { FieldOperator } from '@/features/app/components/field-setting/type';
import type { IPosition } from '../../../grid';

export interface ISetting {
  operator: FieldOperator;
  fieldId?: string;
}

export interface IHeaderMenu {
  fieldIds: string[];
  position: IPosition;
}
export interface IRecordMenu {
  recordIds: string[];
  position: IPosition;
}
