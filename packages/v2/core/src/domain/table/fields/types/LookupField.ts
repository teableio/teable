import { err, ok } from 'neverthrow';
import type { Result } from 'neverthrow';

import { domainError, type DomainError } from '../../../shared/DomainError';
import { ForeignTable } from '../../ForeignTable';
import type { Table } from '../../Table';
import type { TableId } from '../../TableId';
import type { DbFieldName } from '../DbFieldName';
import { Field } from '../Field';
import type { FieldDuplicateParams } from '../Field';
import type { FieldId } from '../FieldId';
import type { FieldName } from '../FieldName';
import { FieldType } from '../FieldType';
import type {
  ForeignTableRelatedField,
  ForeignTableValidationContext,
} from '../ForeignTableRelatedField';
import { FieldValueTypeVisitor, type FieldValueType } from '../visitors/FieldValueTypeVisitor';
import type { IFieldVisitor } from '../visitors/IFieldVisitor';
import { CellValueMultiplicity } from './CellValueMultiplicity';
import { CellValueType } from './CellValueType';
import { FieldComputed } from './FieldComputed';
import type { LinkField } from './LinkField';
import type { LookupOptions, LookupOptionsValue } from './LookupOptions';

/**
 * LookupField is a wrapper field that retrieves values from a linked table.
 *
 * It wraps another field type (the "inner field") which determines the value type
 * and formatting options, while the lookup configuration determines how values
 * are resolved from the foreign table.
 *
 * Key characteristics:
 * - Computed field (values are derived, not directly editable)
 * - Can be single or multiple cell values depending on link relationship type
 * - The inner field determines cellValueType, formatting, showAs, etc.
 */
export class LookupField extends Field implements ForeignTableRelatedField {
  private innerFieldValue: Field | undefined;
  /**
   * Override for isMultipleCellValue. When set, this value is used instead of
   * defaulting to multiple. This is important for compatibility with v1 where
   * lookup fields could be single-value (e.g., ManyOne relationship looking up
   * a single-value field like AutoNumber would result in an INTEGER column).
   */
  private isMultipleCellValueOverride: boolean | undefined;

  private constructor(
    id: FieldId,
    name: FieldName,
    innerField: Field | undefined,
    private readonly lookupOptionsValue: LookupOptions,
    dbFieldName?: DbFieldName,
    dependencies?: ReadonlyArray<FieldId>,
    isMultipleCellValue?: boolean
  ) {
    super(
      id,
      name,
      FieldType.lookup(),
      dbFieldName,
      dependencies ?? [lookupOptionsValue.linkFieldId()],
      FieldComputed.computed()
    );
    this.innerFieldValue = innerField;
    this.isMultipleCellValueOverride = isMultipleCellValue;
  }

  static create(params: {
    id: FieldId;
    name: FieldName;
    innerField: Field;
    lookupOptions: LookupOptions;
    dbFieldName?: DbFieldName;
    dependencies?: ReadonlyArray<FieldId>;
    isMultipleCellValue?: boolean;
  }): Result<LookupField, DomainError> {
    // Nested lookups are supported - inner field can be another LookupField
    // This enables lookups across 3+ tables (e.g., Table A -> Table B -> Table C)
    return ok(
      new LookupField(
        params.id,
        params.name,
        params.innerField,
        params.lookupOptions,
        params.dbFieldName,
        params.dependencies,
        params.isMultipleCellValue
      )
    );
  }

  /**
   * Creates a pending LookupField without the inner field resolved.
   * The inner field will be resolved during foreign table validation.
   */
  static createPending(params: {
    id: FieldId;
    name: FieldName;
    lookupOptions: LookupOptions;
    dbFieldName?: DbFieldName;
    dependencies?: ReadonlyArray<FieldId>;
    isMultipleCellValue?: boolean;
  }): Result<LookupField, DomainError> {
    return ok(
      new LookupField(
        params.id,
        params.name,
        undefined, // Inner field will be resolved during validation
        params.lookupOptions,
        params.dbFieldName,
        params.dependencies,
        params.isMultipleCellValue
      )
    );
  }

  /**
   * Rehydrates a LookupField from persistence with the inner field already resolved.
   */
  static rehydrate(params: {
    id: FieldId;
    name: FieldName;
    innerField: Field;
    lookupOptions: LookupOptions;
    dbFieldName?: DbFieldName;
    dependencies?: ReadonlyArray<FieldId>;
    isMultipleCellValue?: boolean;
  }): Result<LookupField, DomainError> {
    return LookupField.create(params);
  }

  /**
   * Whether this lookup field is in a pending state (inner field not yet resolved).
   */
  isPending(): boolean {
    return this.innerFieldValue === undefined;
  }

  /**
   * The wrapped field that determines the value type and options.
   * This field exists only to define the lookup's data characteristics,
   * not as an actual field in any table.
   * Returns error if the field is still pending (not resolved).
   */
  innerField(): Result<Field, DomainError> {
    if (!this.innerFieldValue) {
      return err(domainError.unexpected({ message: 'LookupField inner field not yet resolved' }));
    }
    return ok(this.innerFieldValue);
  }

  /**
   * The type of the wrapped field (e.g., number, singleLineText, etc.)
   * Returns error if the field is still pending.
   */
  innerFieldType(): Result<FieldType, DomainError> {
    return this.innerField().map((f) => f.type());
  }

  /**
   * The lookup configuration (linkFieldId, lookupFieldId, foreignTableId).
   */
  lookupOptions(): LookupOptions {
    return this.lookupOptionsValue;
  }

  lookupOptionsDto(): LookupOptionsValue {
    return this.lookupOptionsValue.toDto();
  }

  /**
   * The ID of the Link field used for lookup.
   */
  linkFieldId(): FieldId {
    return this.lookupOptionsValue.linkFieldId();
  }

  /**
   * The ID of the field being looked up in the foreign table.
   */
  lookupFieldId(): FieldId {
    return this.lookupOptionsValue.lookupFieldId();
  }

  /**
   * The ID of the foreign table containing the lookup field.
   */
  foreignTableId(): TableId {
    return this.lookupOptionsValue.foreignTableId();
  }

  /**
   * Get the link field from the host table.
   */
  linkField(hostTable: Table): Result<LinkField, DomainError> {
    const linkFieldId = this.linkFieldId();
    const fieldResult = hostTable.getField((candidate) => candidate.id().equals(linkFieldId));
    if (fieldResult.isErr())
      return err(domainError.notFound({ message: 'LookupField link field not found' }));

    const field = fieldResult.value;
    if (!field.type().equals(FieldType.link())) {
      return err(domainError.validation({ message: 'LookupField link field must be a LinkField' }));
    }
    return ok(field as LinkField);
  }

  /**
   * Get the lookup target field from the foreign table.
   */
  lookupField(foreignTable: ForeignTable): Result<Field, DomainError> {
    return this.ensureForeignTable(foreignTable).andThen(() =>
      foreignTable.fieldById(this.lookupFieldId())
    );
  }

  /**
   * Get the cell value type based on the inner field.
   * If pending (inner field not resolved), returns string as default.
   */
  cellValueType(): Result<CellValueType, DomainError> {
    if (!this.innerFieldValue) {
      // Default to string for pending lookup fields
      return ok(CellValueType.string());
    }
    return this.innerFieldValue.accept(new FieldValueTypeVisitor()).map((vt) => vt.cellValueType);
  }

  /**
   * Get whether this is a multiple cell value field.
   * Uses the override value if set (from v1 persistence), otherwise defaults to multiple.
   */
  isMultipleCellValue(): Result<CellValueMultiplicity, DomainError> {
    if (this.isMultipleCellValueOverride !== undefined) {
      return ok(
        this.isMultipleCellValueOverride
          ? CellValueMultiplicity.multiple()
          : CellValueMultiplicity.single()
      );
    }
    // Default to multiple for new lookup fields (v2 behavior)
    return ok(CellValueMultiplicity.multiple());
  }

  /**
   * Get the field value type (cellValueType + multiplicity).
   */
  fieldValueType(): Result<FieldValueType, DomainError> {
    return this.isMultipleCellValue().andThen((isMultipleCellValue) =>
      this.cellValueType().map((cellValueType) => ({
        cellValueType,
        isMultipleCellValue,
      }))
    );
  }

  duplicate(_params: FieldDuplicateParams): Result<Field, DomainError> {
    return err(
      domainError.validation({
        code: 'field.lookup_cannot_duplicate',
        message:
          'Lookup fields cannot be duplicated. Please duplicate the underlying link field instead.',
      })
    );
  }

  validateForeignTables(context: ForeignTableValidationContext): Result<void, DomainError> {
    // 1. Validate link field exists in host table
    const linkFieldResult = this.linkField(context.hostTable);
    if (linkFieldResult.isErr()) return err(linkFieldResult.error);
    const linkField = linkFieldResult.value;

    // 2. Validate that link field points to our foreign table
    if (!linkField.foreignTableId().equals(this.foreignTableId())) {
      return err(
        domainError.unexpected({
          message: 'LookupField foreign table does not match link field target',
        })
      );
    }

    // 3. Find the foreign table
    const foreignTable = context.foreignTables.find((candidate) =>
      candidate.id().equals(this.foreignTableId())
    );
    if (!foreignTable) {
      return err(domainError.invariant({ message: 'LookupField foreign table not loaded' }));
    }

    // 4. Validate lookup field exists in foreign table and resolve inner field
    const ft = ForeignTable.from(foreignTable);
    const lookupFieldResult = ft.fieldById(this.lookupFieldId());
    if (lookupFieldResult.isErr()) {
      return err(
        domainError.notFound({ message: 'LookupField lookup field not found in foreign table' })
      );
    }

    // 5. Resolve the inner field from the foreign table's lookup field
    // Nested lookups are supported - enables lookups across 3+ tables (e.g., Table A -> Table B -> Table C)
    this.innerFieldValue = lookupFieldResult.value;

    // 6. Set dependencies to include link field
    return this.setDependencies([this.linkFieldId()]);
  }

  accept<T = void>(visitor: IFieldVisitor<T>): Result<T, DomainError> {
    return visitor.visitLookupField(this);
  }

  private ensureForeignTable(foreignTable: ForeignTable): Result<void, DomainError> {
    if (!foreignTable.id().equals(this.foreignTableId())) {
      return err(
        domainError.unexpected({ message: 'ForeignTable does not match LookupField foreign table' })
      );
    }
    return ok(undefined);
  }
}
