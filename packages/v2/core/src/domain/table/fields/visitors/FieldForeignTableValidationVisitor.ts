import { err, ok } from 'neverthrow';
import type { Result } from 'neverthrow';

import { ForeignTable } from '../../ForeignTable';
import type { Table } from '../../Table';
import type { TableId } from '../../TableId';
import type { Field } from '../Field';
import type { AttachmentField } from '../types/AttachmentField';
import type { ButtonField } from '../types/ButtonField';
import type { CheckboxField } from '../types/CheckboxField';
import type { DateField } from '../types/DateField';
import type { FormulaField } from '../types/FormulaField';
import type { LinkField } from '../types/LinkField';
import type { LongTextField } from '../types/LongTextField';
import type { MultipleSelectField } from '../types/MultipleSelectField';
import type { NumberField } from '../types/NumberField';
import type { RatingField } from '../types/RatingField';
import type { RollupField } from '../types/RollupField';
import type { SingleLineTextField } from '../types/SingleLineTextField';
import type { SingleSelectField } from '../types/SingleSelectField';
import type { UserField } from '../types/UserField';
import { FieldValueTypeVisitor } from './FieldValueTypeVisitor';
import type { IFieldVisitor } from './IFieldVisitor';

export type FieldForeignTableValidationContext = {
  table: Table;
  foreignTables: ReadonlyArray<Table>;
};

export class FieldForeignTableValidationVisitor implements IFieldVisitor<void> {
  private constructor(
    private readonly hostTable: Table,
    private readonly foreignTablesById: ReadonlyMap<string, ForeignTable>
  ) {}

  static validate(
    fields: ReadonlyArray<Field>,
    context: FieldForeignTableValidationContext
  ): Result<void, string> {
    const visitor = FieldForeignTableValidationVisitor.create(context);
    return fields.reduce<Result<void, string>>(
      (acc, field) => acc.andThen(() => field.accept(visitor).map(() => undefined)),
      ok(undefined)
    );
  }

  static create(context: FieldForeignTableValidationContext): FieldForeignTableValidationVisitor {
    const foreignTablesById = new Map<string, ForeignTable>();
    for (const table of context.foreignTables) {
      foreignTablesById.set(table.id().toString(), ForeignTable.from(table));
    }
    return new FieldForeignTableValidationVisitor(context.table, foreignTablesById);
  }

  visitSingleLineTextField(_: SingleLineTextField): Result<void, string> {
    return ok(undefined);
  }

  visitLongTextField(_: LongTextField): Result<void, string> {
    return ok(undefined);
  }

  visitNumberField(_: NumberField): Result<void, string> {
    return ok(undefined);
  }

  visitRatingField(_: RatingField): Result<void, string> {
    return ok(undefined);
  }

  visitFormulaField(_: FormulaField): Result<void, string> {
    return ok(undefined);
  }

  visitRollupField(field: RollupField): Result<void, string> {
    const linkFieldId = field.linkFieldId();
    const linkField = this.hostTable
      .fields()
      .find((candidate) => candidate.id().equals(linkFieldId));
    if (!linkField) return err('RollupField link field not found');
    if (linkField.type().toString() !== 'link') {
      return err('RollupField link field must be a LinkField');
    }

    const foreignTable = this.foreignTablesById.get(field.foreignTableId().toString());
    if (!foreignTable) return err('RollupField foreign table not loaded');

    const lookupField = foreignTable
      .fieldById(field.lookupFieldId())
      .mapErr(() => 'RollupField lookup field not found');
    if (lookupField.isErr()) return err(lookupField.error);

    const valuesTypeResult = lookupField.value.accept(new FieldValueTypeVisitor());
    if (valuesTypeResult.isErr()) return err(valuesTypeResult.error);

    const resolveResult = field.resolveResultType(valuesTypeResult.value);
    if (resolveResult.isErr()) return err(resolveResult.error);

    return field.setDependencies([linkFieldId]);
  }

  visitSingleSelectField(_: SingleSelectField): Result<void, string> {
    return ok(undefined);
  }

  visitMultipleSelectField(_: MultipleSelectField): Result<void, string> {
    return ok(undefined);
  }

  visitCheckboxField(_: CheckboxField): Result<void, string> {
    return ok(undefined);
  }

  visitAttachmentField(_: AttachmentField): Result<void, string> {
    return ok(undefined);
  }

  visitDateField(_: DateField): Result<void, string> {
    return ok(undefined);
  }

  visitUserField(_: UserField): Result<void, string> {
    return ok(undefined);
  }

  visitButtonField(_: ButtonField): Result<void, string> {
    return ok(undefined);
  }

  visitLinkField(field: LinkField): Result<void, string> {
    const foreignTableResult = this.foreignTable(field.foreignTableId());
    if (foreignTableResult.isErr()) return err(foreignTableResult.error);
    const foreignTable = foreignTableResult.value;

    const lookupResult = field.lookupField(foreignTable);
    if (lookupResult.isErr()) return err(lookupResult.error);

    const visibleResult = field.visibleFields(foreignTable);
    if (visibleResult.isErr()) return err(visibleResult.error);

    return ok(undefined);
  }

  private foreignTable(tableId: TableId): Result<ForeignTable, string> {
    const table = this.foreignTablesById.get(tableId.toString());
    if (!table) return err('Foreign table not loaded');
    return ok(table);
  }
}
