import { FieldType } from '@teable/core';

export const isUserOrLink = (type: FieldType) => {
  return [FieldType.Link, FieldType.User, FieldType.CreatedBy, FieldType.LastModifiedBy].includes(
    type
  );
};
