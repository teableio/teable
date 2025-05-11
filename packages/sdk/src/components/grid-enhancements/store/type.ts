import type { IGroupHeaderRef } from '@teable/openapi';
import type { IFieldInstance, Record } from '../../../model';
import type { IPosition, IRectangle } from '../../grid/interface';

export interface IHeaderMenu {
  fields: IFieldInstance[];
  position: IPosition;
  aiEnable?: boolean;
  onAutoFill?: (fieldId: string) => void;
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

export interface IGroupHeaderMenu {
  groupId: string;
  position: IPosition;
  allGroupHeaderRefs: IGroupHeaderRef[] | null;
}
