import { FieldType } from '@teable-group/core';

export const isMatchCustomCell = (type: string) => {
  return [
    FieldType.SingleSelect,
    FieldType.MultipleSelect,
    FieldType.Attachment,
    FieldType.Link,
    FieldType.Date,
    'loading',
  ].includes(type);
};
