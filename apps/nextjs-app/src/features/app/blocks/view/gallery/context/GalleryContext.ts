import type { IGetRecordsRo } from '@teable/openapi';
import type { AttachmentField, IFieldInstance } from '@teable/sdk/model';
import { createContext } from 'react';
import type { IGalleryPermission } from '../type';

export interface IGalleryContext {
  recordQuery?: Pick<IGetRecordsRo, 'filter' | 'orderBy' | 'projection' | 'ignoreViewQuery'>;
  coverField?: AttachmentField;
  isCoverFit?: boolean;
  isFieldNameHidden?: boolean;
  permission: IGalleryPermission;
  primaryField: IFieldInstance | null;
  displayFields: IFieldInstance[];
  setExpandRecordId: (recordId?: string) => void;
  // the loaded records in display order, for the expanded record's prev / next
  setOrderedRecordIds: (recordIds: string[]) => void;
}

export const GalleryContext = createContext<IGalleryContext>(null!);
