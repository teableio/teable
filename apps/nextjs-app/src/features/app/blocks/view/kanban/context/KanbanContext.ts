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
}

export const KanbanContext = createContext<IKanbanContext>(null!);
