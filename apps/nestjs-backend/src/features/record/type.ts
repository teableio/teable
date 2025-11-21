import type { Field } from '@prisma/client';
import type { IUpdateRecordsRo } from '@teable/openapi';

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
  | 'isConditionalLookup'
  | 'lookupOptions'
  | 'lookupLinkedFieldId'
  | 'dbFieldName'
>[];

export type IUpdateRecordsInternalRo = Omit<IUpdateRecordsRo, 'records'> & {
  fieldIds?: string[];
  records: {
    id: string;
    fields: Record<string, unknown>;
    order?: Record<string, number>;
  }[];
};
