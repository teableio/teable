import { err, ok } from 'neverthrow';
import type { Result } from 'neverthrow';

import type { ISpecification } from '../../../shared/specification/ISpecification';
import { ForeignTable } from '../../ForeignTable';
import type { ITableSpecVisitor } from '../../specs/ITableSpecVisitor';
import { TableAddFieldSpec } from '../../specs/TableAddFieldSpec';
import type { Table } from '../../Table';
import type { TableId } from '../../TableId';
import type { Field } from '../Field';
import type { AttachmentField } from '../types/AttachmentField';
import type { AutoNumberField } from '../types/AutoNumberField';
import type { ButtonField } from '../types/ButtonField';
import type { CheckboxField } from '../types/CheckboxField';
import type { CreatedByField } from '../types/CreatedByField';
import type { CreatedTimeField } from '../types/CreatedTimeField';
import type { DateField } from '../types/DateField';
import type { FormulaField } from '../types/FormulaField';
import type { LastModifiedByField } from '../types/LastModifiedByField';
import type { LastModifiedTimeField } from '../types/LastModifiedTimeField';
import type { LinkField } from '../types/LinkField';
import type { LongTextField } from '../types/LongTextField';
import type { MultipleSelectField } from '../types/MultipleSelectField';
import type { NumberField } from '../types/NumberField';
import type { RatingField } from '../types/RatingField';
import type { RollupField } from '../types/RollupField';
import type { SingleLineTextField } from '../types/SingleLineTextField';
import type { SingleSelectField } from '../types/SingleSelectField';
import type { UserField } from '../types/UserField';
import type { IFieldVisitor } from './IFieldVisitor';

export type FieldCreationSideEffect = {
  foreignTable: Table;
  mutateSpec: ISpecification<Table, ITableSpecVisitor>;
};

export type FieldCreationSideEffects = ReadonlyArray<FieldCreationSideEffect>;

export type FieldCreationSideEffectContext = {
  table: Table;
  foreignTables: ReadonlyArray<Table>;
};

export class FieldCreationSideEffectVisitor implements IFieldVisitor<FieldCreationSideEffects> {
  private constructor(
    private readonly table: Table,
    private readonly foreignTablesById: ReadonlyMap<string, Table>
  ) {}

  static collect(
    fields: ReadonlyArray<Field>,
    context: FieldCreationSideEffectContext
  ): Result<FieldCreationSideEffects, string> {
    const visitor = FieldCreationSideEffectVisitor.create(context);
    return fields.reduce<Result<FieldCreationSideEffects, string>>(
      (acc, field) =>
        acc.andThen((effects) => field.accept(visitor).map((next) => [...effects, ...next])),
      ok([])
    );
  }

  static create(context: FieldCreationSideEffectContext): FieldCreationSideEffectVisitor {
    const foreignTablesById = new Map<string, Table>();
    for (const table of context.foreignTables) {
      foreignTablesById.set(table.id().toString(), table);
    }
    return new FieldCreationSideEffectVisitor(context.table, foreignTablesById);
  }

  visitSingleLineTextField(_: SingleLineTextField): Result<FieldCreationSideEffects, string> {
    return ok([]);
  }

  visitLongTextField(_: LongTextField): Result<FieldCreationSideEffects, string> {
    return ok([]);
  }

  visitNumberField(_: NumberField): Result<FieldCreationSideEffects, string> {
    return ok([]);
  }

  visitRatingField(_: RatingField): Result<FieldCreationSideEffects, string> {
    return ok([]);
  }

  visitFormulaField(_: FormulaField): Result<FieldCreationSideEffects, string> {
    return ok([]);
  }

  visitRollupField(_: RollupField): Result<FieldCreationSideEffects, string> {
    return ok([]);
  }

  visitSingleSelectField(_: SingleSelectField): Result<FieldCreationSideEffects, string> {
    return ok([]);
  }

  visitMultipleSelectField(_: MultipleSelectField): Result<FieldCreationSideEffects, string> {
    return ok([]);
  }

  visitCheckboxField(_: CheckboxField): Result<FieldCreationSideEffects, string> {
    return ok([]);
  }

  visitAttachmentField(_: AttachmentField): Result<FieldCreationSideEffects, string> {
    return ok([]);
  }

  visitDateField(_: DateField): Result<FieldCreationSideEffects, string> {
    return ok([]);
  }

  visitCreatedTimeField(_: CreatedTimeField): Result<FieldCreationSideEffects, string> {
    return ok([]);
  }

  visitLastModifiedTimeField(_: LastModifiedTimeField): Result<FieldCreationSideEffects, string> {
    return ok([]);
  }

  visitUserField(_: UserField): Result<FieldCreationSideEffects, string> {
    return ok([]);
  }

  visitCreatedByField(_: CreatedByField): Result<FieldCreationSideEffects, string> {
    return ok([]);
  }

  visitLastModifiedByField(_: LastModifiedByField): Result<FieldCreationSideEffects, string> {
    return ok([]);
  }

  visitAutoNumberField(_: AutoNumberField): Result<FieldCreationSideEffects, string> {
    return ok([]);
  }

  visitButtonField(_: ButtonField): Result<FieldCreationSideEffects, string> {
    return ok([]);
  }

  visitLinkField(field: LinkField): Result<FieldCreationSideEffects, string> {
    if (field.isOneWay()) return ok([]);

    const foreignTableResult = this.foreignTable(field.foreignTableId());
    if (foreignTableResult.isErr()) return err(foreignTableResult.error);
    const foreignTable = foreignTableResult.value;

    return field
      .buildSymmetricField({ foreignTable: ForeignTable.from(foreignTable), hostTable: this.table })
      .map((symmetricField) => [
        {
          foreignTable,
          mutateSpec: TableAddFieldSpec.create(symmetricField),
        },
      ]);
  }

  private foreignTable(tableId: TableId): Result<Table, string> {
    const table = this.foreignTablesById.get(tableId.toString());
    if (!table) return err('Foreign table not loaded');
    return ok(table);
  }
}
