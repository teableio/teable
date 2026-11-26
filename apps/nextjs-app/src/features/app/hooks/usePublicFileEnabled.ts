import { FieldType, type IAttachmentFieldOptions } from '@teable/core';
import type { IFieldInstance } from '@teable/sdk/model';
import { usePublicSettingQuery } from './useSetting';

/**
 * A delete turns public file links off and a restore brings them back off, so the delete
 * confirmations say so; nothing to say where the deployment serves no public files.
 */
export const usePublicFileEnabled = () => usePublicSettingQuery().data?.publicFileEnabled === true;

export const isPublicAttachmentField = (field: IFieldInstance) =>
  field.type === FieldType.Attachment &&
  !field.isLookup &&
  Boolean((field.options as IAttachmentFieldOptions | undefined)?.isPublic);
