import type { IAttachmentFieldOptions } from '@teable/core';
import { FieldType } from '@teable/core';

/** An attachment field with public links on; a lookup carries the options of what it looks up. */
export const isPublicAttachmentField = (
  field: { type: FieldType; isLookup?: boolean; options?: unknown } | undefined
) =>
  field?.type === FieldType.Attachment &&
  !field.isLookup &&
  Boolean((field.options as IAttachmentFieldOptions | undefined)?.isPublic);

export const FIELD_TYPE_ORDER = [
  FieldType.SingleLineText,
  FieldType.LongText,
  FieldType.Number,
  FieldType.SingleSelect,
  FieldType.MultipleSelect,
  FieldType.User,
  FieldType.Date,
  FieldType.Rating,
  FieldType.Checkbox,
  FieldType.Attachment,
  FieldType.Formula,
  FieldType.Link,
  FieldType.Rollup,
  FieldType.ConditionalRollup,
  FieldType.CreatedTime,
  FieldType.LastModifiedTime,
  FieldType.CreatedBy,
  FieldType.LastModifiedBy,
  FieldType.AutoNumber,
  FieldType.Button,
];
