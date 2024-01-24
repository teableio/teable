import type { IPosition, IRectangle } from '@teable-group/sdk/components';
import type { IFieldInstance, Record } from '@teable-group/sdk/model';

export interface IHeaderMenu {
  fields: IFieldInstance[];
  position: IPosition;
}

export interface IRecordMenu {
  fields: IFieldInstance[];
  records: Record[];
  neighborRecords: (Record | null)[];
  position: IPosition;
}

export interface IStatisticMenu {
  fieldId: string;
  position: IRectangle;
}
