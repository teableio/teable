import type { Field } from '@prisma/client';

export type IFieldRaws = Pick<
  Field,
  | 'id'
  | 'name'
  | 'type'
  | 'options'
  | 'unique'
  | 'notNull'
  | 'isComputed'
  | 'isLookup'
  | 'dbFieldName'
>[];
