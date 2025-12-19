import type {
  Field,
  IFieldVisitor,
  NumberField,
  RatingField,
  SingleLineTextField,
  SingleSelectField,
  Table,
} from '@teable/v2-core';
import type { CreateTableBuilder } from 'kysely';
import { err, ok } from 'neverthrow';
import type { Result } from 'neverthrow';

type ICreateTableBuilder = CreateTableBuilder<string, string>;
type ITableColumnDataType = Parameters<ICreateTableBuilder['addColumn']>[1];

export interface ICreateTableBuilderRef {
  builder: ICreateTableBuilder;
}

export class PostgresTableFieldVisitor implements IFieldVisitor<void> {
  constructor(
    private readonly builderRef: ICreateTableBuilderRef,
    private readonly fieldDbNameById: Map<string, string>
  ) {}

  private static isFieldArray(value: Table | ReadonlyArray<Field>): value is ReadonlyArray<Field> {
    return Array.isArray(value);
  }

  apply(table: Table): Result<void, string>;
  apply(fields: ReadonlyArray<Field>): Result<void, string>;
  apply(tableOrFields: Table | ReadonlyArray<Field>): Result<void, string> {
    const fields = PostgresTableFieldVisitor.isFieldArray(tableOrFields)
      ? tableOrFields
      : tableOrFields.fields();

    for (const field of fields) {
      const result = field.accept(this);
      if (result.isErr()) return err(result.error);
    }

    return ok(undefined);
  }

  visitSingleLineTextField(field: SingleLineTextField): Result<void, string> {
    return this.addColumn(field.id().toString(), 'text');
  }

  visitNumberField(field: NumberField): Result<void, string> {
    return this.addColumn(field.id().toString(), 'numeric');
  }

  visitRatingField(field: RatingField): Result<void, string> {
    return this.addColumn(field.id().toString(), 'integer');
  }

  visitSingleSelectField(field: SingleSelectField): Result<void, string> {
    return this.addColumn(field.id().toString(), 'text');
  }

  private addColumn(fieldId: string, dataType: ITableColumnDataType): Result<void, string> {
    const columnName = this.fieldDbNameById.get(fieldId);
    if (!columnName) return err(`Missing db field name for field ${fieldId}`);
    this.builderRef.builder = this.builderRef.builder.addColumn(
      columnName,
      dataType
    ) as unknown as ICreateTableBuilder;
    return ok(undefined);
  }
}
