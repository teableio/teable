import { err, ok } from 'neverthrow';
import type { Result } from 'neverthrow';

import { domainError, type DomainError } from '../../../shared/DomainError';
import type { ISpecification } from '../../../shared/specification/ISpecification';
import { ForeignTable } from '../../ForeignTable';
import type { ITableSpecVisitor } from '../../specs/ITableSpecVisitor';
import { TableRemoveFieldSpec } from '../../specs/TableRemoveFieldSpec';
import type { Table } from '../../Table';
import type { TableId } from '../../TableId';
import type { Field } from '../Field';
import type { AttachmentField } from '../types/AttachmentField';
import type { AutoNumberField } from '../types/AutoNumberField';
import type { ButtonField } from '../types/ButtonField';
import type { CheckboxField } from '../types/CheckboxField';
import type { ConditionalLookupField } from '../types/ConditionalLookupField';
import type { ConditionalRollupField } from '../types/ConditionalRollupField';
import type { CreatedByField } from '../types/CreatedByField';
import type { CreatedTimeField } from '../types/CreatedTimeField';
import type { DateField } from '../types/DateField';
import type { FormulaField } from '../types/FormulaField';
import type { LastModifiedByField } from '../types/LastModifiedByField';
import type { LastModifiedTimeField } from '../types/LastModifiedTimeField';
import type { LinkField } from '../types/LinkField';
import type { LongTextField } from '../types/LongTextField';
import type { LookupField } from '../types/LookupField';
import type { MultipleSelectField } from '../types/MultipleSelectField';
import type { NumberField } from '../types/NumberField';
import type { RatingField } from '../types/RatingField';
import type { RollupField } from '../types/RollupField';
import type { SingleLineTextField } from '../types/SingleLineTextField';
import type { SingleSelectField } from '../types/SingleSelectField';
import type { UserField } from '../types/UserField';
import type { IFieldVisitor } from './IFieldVisitor';

export type FieldDeletionSideEffect = {
  foreignTable: Table;
  mutateSpec: ISpecification<Table, ITableSpecVisitor>;
};

export type FieldDeletionSideEffects = ReadonlyArray<FieldDeletionSideEffect>;

export type FieldDeletionSideEffectContext = {
  table: Table;
  foreignTables: ReadonlyArray<Table>;
};

export class FieldDeletionSideEffectVisitor implements IFieldVisitor<FieldDeletionSideEffects> {
  private constructor(
    private readonly table: Table,
    private readonly foreignTablesById: ReadonlyMap<string, Table>
  ) {}

  static collect(
    fields: ReadonlyArray<Field>,
    context: FieldDeletionSideEffectContext
  ): Result<FieldDeletionSideEffects, DomainError> {
    const visitor = FieldDeletionSideEffectVisitor.create(context);
    return fields.reduce<Result<FieldDeletionSideEffects, DomainError>>(
      (acc, field) =>
        acc.andThen((effects) => field.accept(visitor).map((next) => [...effects, ...next])),
      ok([])
    );
  }

  static create(context: FieldDeletionSideEffectContext): FieldDeletionSideEffectVisitor {
    const foreignTablesById = new Map<string, Table>();
    for (const table of context.foreignTables) {
      foreignTablesById.set(table.id().toString(), table);
    }
    return new FieldDeletionSideEffectVisitor(context.table, foreignTablesById);
  }

  visitSingleLineTextField(_: SingleLineTextField): Result<FieldDeletionSideEffects, DomainError> {
    return ok([]);
  }

  visitLongTextField(_: LongTextField): Result<FieldDeletionSideEffects, DomainError> {
    return ok([]);
  }

  visitNumberField(_: NumberField): Result<FieldDeletionSideEffects, DomainError> {
    return ok([]);
  }

  visitRatingField(_: RatingField): Result<FieldDeletionSideEffects, DomainError> {
    return ok([]);
  }

  visitFormulaField(_: FormulaField): Result<FieldDeletionSideEffects, DomainError> {
    return ok([]);
  }

  visitRollupField(_: RollupField): Result<FieldDeletionSideEffects, DomainError> {
    return ok([]);
  }

  visitSingleSelectField(_: SingleSelectField): Result<FieldDeletionSideEffects, DomainError> {
    return ok([]);
  }

  visitMultipleSelectField(_: MultipleSelectField): Result<FieldDeletionSideEffects, DomainError> {
    return ok([]);
  }

  visitCheckboxField(_: CheckboxField): Result<FieldDeletionSideEffects, DomainError> {
    return ok([]);
  }

  visitAttachmentField(_: AttachmentField): Result<FieldDeletionSideEffects, DomainError> {
    return ok([]);
  }

  visitDateField(_: DateField): Result<FieldDeletionSideEffects, DomainError> {
    return ok([]);
  }

  visitCreatedTimeField(_: CreatedTimeField): Result<FieldDeletionSideEffects, DomainError> {
    return ok([]);
  }

  visitLastModifiedTimeField(
    _: LastModifiedTimeField
  ): Result<FieldDeletionSideEffects, DomainError> {
    return ok([]);
  }

  visitUserField(_: UserField): Result<FieldDeletionSideEffects, DomainError> {
    return ok([]);
  }

  visitCreatedByField(_: CreatedByField): Result<FieldDeletionSideEffects, DomainError> {
    return ok([]);
  }

  visitLastModifiedByField(_: LastModifiedByField): Result<FieldDeletionSideEffects, DomainError> {
    return ok([]);
  }

  visitAutoNumberField(_: AutoNumberField): Result<FieldDeletionSideEffects, DomainError> {
    return ok([]);
  }

  visitButtonField(_: ButtonField): Result<FieldDeletionSideEffects, DomainError> {
    return ok([]);
  }

  visitLinkField(field: LinkField): Result<FieldDeletionSideEffects, DomainError> {
    if (field.isOneWay()) return ok([]);

    const foreignTableResult = this.foreignTable(field.foreignTableId());
    if (foreignTableResult.isErr()) return err(foreignTableResult.error);
    const foreignTable = foreignTableResult.value;

    return field.symmetricField(ForeignTable.from(foreignTable)).map((symmetricField) => {
      if (!symmetricField) return [];
      return [
        {
          foreignTable,
          mutateSpec: TableRemoveFieldSpec.create(symmetricField),
        },
      ];
    });
  }

  visitLookupField(_: LookupField): Result<FieldDeletionSideEffects, DomainError> {
    // Lookup fields don't have deletion side effects
    // They reference link fields which handle their own side effects
    return ok([]);
  }

  visitConditionalRollupField(
    _: ConditionalRollupField
  ): Result<FieldDeletionSideEffects, DomainError> {
    // Conditional rollup fields don't have deletion side effects
    return ok([]);
  }

  visitConditionalLookupField(
    _: ConditionalLookupField
  ): Result<FieldDeletionSideEffects, DomainError> {
    // Conditional lookup fields don't have deletion side effects
    return ok([]);
  }

  private foreignTable(tableId: TableId): Result<Table, DomainError> {
    const table = this.foreignTablesById.get(tableId.toString());
    if (!table) return err(domainError.invariant({ message: 'Foreign table not loaded' }));
    return ok(table);
  }
}
