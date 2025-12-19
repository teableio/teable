import type {
  AttachmentField,
  ButtonField,
  CheckboxField,
  DateField,
  Field,
  FieldId,
  IFieldVisitor,
  LongTextField,
  MultipleSelectField,
  NumberField,
  RatingField,
  SingleSelectField,
  Table,
  SingleLineTextField,
  UserField,
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
  baseFieldDtoSchema.extend({ type: z.literal('longText') }),
  baseFieldDtoSchema.extend({ type: z.literal('number') }),
  baseFieldDtoSchema.extend({ type: z.literal('rating'), max: z.number() }),
  baseFieldDtoSchema.extend({ type: z.literal('singleSelect'), options: z.array(z.string()) }),
  baseFieldDtoSchema.extend({ type: z.literal('multipleSelect'), options: z.array(z.string()) }),
  baseFieldDtoSchema.extend({ type: z.literal('checkbox') }),
  baseFieldDtoSchema.extend({ type: z.literal('attachment') }),
  baseFieldDtoSchema.extend({ type: z.literal('date') }),
  baseFieldDtoSchema.extend({ type: z.literal('user') }),
  baseFieldDtoSchema.extend({ type: z.literal('button') }),
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

  visitLongTextField(field: LongTextField): Result<IFieldDto, string> {
    return ok({
      id: field.id().toString(),
      name: field.name().toString(),
      type: 'longText',
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

  visitMultipleSelectField(field: MultipleSelectField): Result<IFieldDto, string> {
    return ok({
      id: field.id().toString(),
      name: field.name().toString(),
      type: 'multipleSelect',
      options: field.selectOptions().map((o) => o.toString()),
      isPrimary: field.id().equals(this.primaryFieldId),
    });
  }

  visitCheckboxField(field: CheckboxField): Result<IFieldDto, string> {
    return ok({
      id: field.id().toString(),
      name: field.name().toString(),
      type: 'checkbox',
      isPrimary: field.id().equals(this.primaryFieldId),
    });
  }

  visitAttachmentField(field: AttachmentField): Result<IFieldDto, string> {
    return ok({
      id: field.id().toString(),
      name: field.name().toString(),
      type: 'attachment',
      isPrimary: field.id().equals(this.primaryFieldId),
    });
  }

  visitDateField(field: DateField): Result<IFieldDto, string> {
    return ok({
      id: field.id().toString(),
      name: field.name().toString(),
      type: 'date',
      isPrimary: field.id().equals(this.primaryFieldId),
    });
  }

  visitUserField(field: UserField): Result<IFieldDto, string> {
    return ok({
      id: field.id().toString(),
      name: field.name().toString(),
      type: 'user',
      isPrimary: field.id().equals(this.primaryFieldId),
    });
  }

  visitButtonField(field: ButtonField): Result<IFieldDto, string> {
    return ok({
      id: field.id().toString(),
      name: field.name().toString(),
      type: 'button',
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
