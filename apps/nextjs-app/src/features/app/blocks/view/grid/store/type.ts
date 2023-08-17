import type { FieldOperator } from '@/features/app/components/field-setting/type';
import type { IPosition, IRectangle } from '../../../grid';

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

export interface IStatisticMenu {
  fieldId: string;
  position: IRectangle;
}
