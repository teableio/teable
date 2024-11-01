import type { IGetRecordsRo } from '@teable/openapi';
import type { AttachmentField, IFieldInstance } from '@teable/sdk/model';
import type { Dispatch, SetStateAction } from 'react';
import { createContext } from 'react';
import type { IGalleryPermission } from '../type';

export interface IGalleryContext {
  recordQuery?: Pick<IGetRecordsRo, 'filter' | 'orderBy'>;
  coverField?: AttachmentField;
  isCoverFit?: boolean;
  isFieldNameHidden?: boolean;
  permission: IGalleryPermission;
  primaryField: IFieldInstance;
  displayFields: IFieldInstance[];
  setExpandRecordId: Dispatch<SetStateAction<string | undefined>>;
}

export const GalleryContext = createContext<IGalleryContext>(null!);
