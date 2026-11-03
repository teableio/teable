import type { IGetRecordsRo } from '@teable/openapi';
import type { AttachmentField, IFieldInstance } from '@teable/sdk/model';
import { createContext } from 'react';
import type { IKanbanPermission, IStackData } from '../type';

export interface IKanbanContext {
  recordQuery?: Pick<IGetRecordsRo, 'filter' | 'orderBy' | 'projection' | 'ignoreViewQuery'>;
  stackField?: IFieldInstance;
  stackCollection?: IStackData[];
  coverField?: AttachmentField;
  isCoverFit?: boolean;
  isFieldNameHidden?: boolean;
  isEmptyStackHidden?: boolean;
  permission: IKanbanPermission;
  primaryField: IFieldInstance;
  displayFields: IFieldInstance[];
  setExpandRecordId: (recordId?: string) => void;
  // each stack's loaded cards in order: an expanded card steps through its own stack
  setStackRecordIds: (stackId: string, recordIds?: string[]) => void;
}

export const KanbanContext = createContext<IKanbanContext>(null!);
