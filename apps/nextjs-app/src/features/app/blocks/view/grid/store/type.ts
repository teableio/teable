import type { CombinedSelection, IPosition, IRectangle } from '@teable/sdk/components';
import type { IFieldInstance, Record } from '@teable/sdk/model';

export interface IHeaderMenu {
  fields: IFieldInstance[];
  position: IPosition;
}

export interface IRecordMenu {
  fields: IFieldInstance[];
  records: Record[];
  neighborRecords: (Record | null)[];
  position: IPosition;
  selectedRecordCount: number;
  deleteRecords?: (selection: CombinedSelection) => Promise<void>;
  onAfterInsertCallback?: (recordId: string, targetIndex?: number) => void;
}

export interface IStatisticMenu {
  fieldId: string;
  position: IRectangle;
}
