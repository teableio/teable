import type { IFieldInstance, Record } from '../../../model';
import type { IPosition, IRectangle } from '../../grid/interface';

export interface IHeaderMenu {
  fields: IFieldInstance[];
  position: IPosition;
  onSelectionClear?: () => void;
}

export interface IRecordMenu {
  // only single select record
  record?: Record;
  neighborRecords?: (Record | null)[];
  isMultipleSelected?: boolean;
  position: IPosition;
  deleteRecords?: () => Promise<void>;
  insertRecord?: (anchorId: string, position: 'before' | 'after', num: number) => void;
  duplicateRecord?: () => Promise<void>;
}

export interface IStatisticMenu {
  fieldId: string;
  position: IRectangle;
}
