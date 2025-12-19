import type {
  Field,
  FieldId,
  IFieldVisitor,
  NumberField,
  RatingField,
  SingleSelectField,
  Table,
  SingleLineTextField,
} from '@teable/v2-core';
import { ok } from 'neverthrow';
import type { Result } from 'neverthrow';
import { z } from 'zod';

import { sequenceResults } from '../shared/neverthrow';

export const viewDtoSchema = z.object({
  id: z.string(),
  name: z.string(),
  type: z.enum(['grid', 'calendar', 'kanban', 'form', 'gallery', 'plugin']),
});

export type IViewDto = z.infer<typeof viewDtoSchema>;

const baseFieldDtoSchema = z.object({
  id: z.string(),
  name: z.string(),
  isPrimary: z.boolean(),
});

export const fieldDtoSchema = z.discriminatedUnion('type', [
  baseFieldDtoSchema.extend({ type: z.literal('singleLineText') }),
  baseFieldDtoSchema.extend({ type: z.literal('number') }),
  baseFieldDtoSchema.extend({ type: z.literal('rating'), max: z.number() }),
  baseFieldDtoSchema.extend({ type: z.literal('singleSelect'), options: z.array(z.string()) }),
]);

export type IFieldDto = z.infer<typeof fieldDtoSchema>;

export const tableDtoSchema = z.object({
  id: z.string(),
  baseId: z.string(),
  name: z.string(),
  fields: z.array(fieldDtoSchema),
  views: z.array(viewDtoSchema),
});

export type ITableDto = z.infer<typeof tableDtoSchema>;

class FieldToDtoVisitor implements IFieldVisitor<IFieldDto> {
  constructor(private readonly primaryFieldId: FieldId) {}

  visitSingleLineTextField(field: SingleLineTextField): Result<IFieldDto, string> {
    return ok({
      id: field.id().toString(),
      name: field.name().toString(),
      type: 'singleLineText',
      isPrimary: field.id().equals(this.primaryFieldId),
    });
  }

  visitNumberField(field: NumberField): Result<IFieldDto, string> {
    return ok({
      id: field.id().toString(),
      name: field.name().toString(),
      type: 'number',
      isPrimary: field.id().equals(this.primaryFieldId),
    });
  }

  visitRatingField(field: RatingField): Result<IFieldDto, string> {
    return ok({
      id: field.id().toString(),
      name: field.name().toString(),
      type: 'rating',
      max: field.ratingMax().toNumber(),
      isPrimary: field.id().equals(this.primaryFieldId),
    });
  }

  visitSingleSelectField(field: SingleSelectField): Result<IFieldDto, string> {
    return ok({
      id: field.id().toString(),
      name: field.name().toString(),
      type: 'singleSelect',
      options: field.selectOptions().map((o) => o.toString()),
      isPrimary: field.id().equals(this.primaryFieldId),
    });
  }
}

export const mapFieldToDto = (field: Field, primaryFieldId: FieldId): Result<IFieldDto, string> =>
  field.accept(new FieldToDtoVisitor(primaryFieldId));

export const mapTableToDto = (table: Table): Result<ITableDto, string> => {
  const primaryFieldId = table.primaryFieldId();
  return sequenceResults(table.fields().map((f) => mapFieldToDto(f, primaryFieldId))).map(
    (fields) => ({
      id: table.id().toString(),
      baseId: table.baseId().toString(),
      name: table.name().toString(),
      fields: [...fields],
      views: table.views().map((v) => ({
        id: v.id().toString(),
        name: v.name().toString(),
        type: v.type().toString(),
      })),
    })
  );
};
