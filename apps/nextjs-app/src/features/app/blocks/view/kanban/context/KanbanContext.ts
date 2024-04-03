import type {
  UserField,
  AttachmentField,
  SingleSelectField,
  IFieldInstance,
} from '@teable/sdk/model';
import type { Dispatch, SetStateAction } from 'react';
import { createContext } from 'react';
import type { IKanbanPermission, IStackData } from '../type';

export interface IKanbanContext {
  stackField?: SingleSelectField | UserField;
  stackCollection?: IStackData[];
  coverField?: AttachmentField;
  isCoverFit?: boolean;
  isFieldNameHidden?: boolean;
  permission: IKanbanPermission;
  primaryField: IFieldInstance;
  displayFields: IFieldInstance[];
  setExpandRecordId: Dispatch<SetStateAction<string | undefined>>;
}

export const KanbanContext = createContext<IKanbanContext>(null!);