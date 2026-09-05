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
  primaryField: IFieldInstance;
  displayFields: IFieldInstance[];
}

export const GalleryContext = createContext<IGalleryContext>(null!);
