import { err, ok } from 'neverthrow';
import type { Result } from 'neverthrow';

import { domainError, type DomainError } from '../../../shared/DomainError';
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
  ): Result<FieldCreationSideEffects, DomainError> {
    const visitor = FieldCreationSideEffectVisitor.create(context);
    return fields.reduce<Result<FieldCreationSideEffects, DomainError>>(
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

  visitSingleLineTextField(_: SingleLineTextField): Result<FieldCreationSideEffects, DomainError> {
    return ok([]);
  }

  visitLongTextField(_: LongTextField): Result<FieldCreationSideEffects, DomainError> {
    return ok([]);
  }

  visitNumberField(_: NumberField): Result<FieldCreationSideEffects, DomainError> {
    return ok([]);
  }

  visitRatingField(_: RatingField): Result<FieldCreationSideEffects, DomainError> {
    return ok([]);
  }

  visitFormulaField(_: FormulaField): Result<FieldCreationSideEffects, DomainError> {
    return ok([]);
  }

  visitRollupField(_: RollupField): Result<FieldCreationSideEffects, DomainError> {
    return ok([]);
  }

  visitSingleSelectField(_: SingleSelectField): Result<FieldCreationSideEffects, DomainError> {
    return ok([]);
  }

  visitMultipleSelectField(_: MultipleSelectField): Result<FieldCreationSideEffects, DomainError> {
    return ok([]);
  }

  visitCheckboxField(_: CheckboxField): Result<FieldCreationSideEffects, DomainError> {
    return ok([]);
  }

  visitAttachmentField(_: AttachmentField): Result<FieldCreationSideEffects, DomainError> {
    return ok([]);
  }

  visitDateField(_: DateField): Result<FieldCreationSideEffects, DomainError> {
    return ok([]);
  }

  visitCreatedTimeField(_: CreatedTimeField): Result<FieldCreationSideEffects, DomainError> {
    return ok([]);
  }

  visitLastModifiedTimeField(
    _: LastModifiedTimeField
  ): Result<FieldCreationSideEffects, DomainError> {
    return ok([]);
  }

  visitUserField(_: UserField): Result<FieldCreationSideEffects, DomainError> {
    return ok([]);
  }

  visitCreatedByField(_: CreatedByField): Result<FieldCreationSideEffects, DomainError> {
    return ok([]);
  }

  visitLastModifiedByField(_: LastModifiedByField): Result<FieldCreationSideEffects, DomainError> {
    return ok([]);
  }

  visitAutoNumberField(_: AutoNumberField): Result<FieldCreationSideEffects, DomainError> {
    return ok([]);
  }

  visitButtonField(_: ButtonField): Result<FieldCreationSideEffects, DomainError> {
    return ok([]);
  }

  visitLinkField(field: LinkField): Result<FieldCreationSideEffects, DomainError> {
    if (field.isOneWay()) return ok([]);

    const foreignTableResult = this.foreignTable(field.foreignTableId());
    if (foreignTableResult.isErr()) return err(foreignTableResult.error);
    const foreignTable = foreignTableResult.value;

    const symmetricFieldId = field.symmetricFieldId();
    if (symmetricFieldId) {
      const existingResult = ForeignTable.from(foreignTable).fieldById(symmetricFieldId);
      if (existingResult.isOk()) {
        return ok([]);
      }
    }

    return field
      .buildSymmetricField({ foreignTable: ForeignTable.from(foreignTable), hostTable: this.table })
      .map((symmetricField) => [
        {
          foreignTable,
          mutateSpec: TableAddFieldSpec.create(symmetricField),
        },
      ]);
  }

  visitLookupField(_: LookupField): Result<FieldCreationSideEffects, DomainError> {
    // Lookup fields don't have creation side effects
    // They reference link fields which handle their own side effects
    return ok([]);
  }

  visitConditionalRollupField(
    _: ConditionalRollupField
  ): Result<FieldCreationSideEffects, DomainError> {
    // Conditional rollup fields don't have creation side effects
    return ok([]);
  }

  visitConditionalLookupField(
    _: ConditionalLookupField
  ): Result<FieldCreationSideEffects, DomainError> {
    // Conditional lookup fields don't have creation side effects
    return ok([]);
  }

  private foreignTable(tableId: TableId): Result<Table, DomainError> {
    const table = this.foreignTablesById.get(tableId.toString());
    if (!table) return err(domainError.invariant({ message: 'Foreign table not loaded' }));
    return ok(table);
  }
}
