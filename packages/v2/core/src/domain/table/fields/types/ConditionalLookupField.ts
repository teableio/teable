import { err, ok } from 'neverthrow';
import type { Result } from 'neverthrow';

import { domainError, type DomainError } from '../../../shared/DomainError';
import { ForeignTable } from '../../ForeignTable';
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
import type {
  ConditionalLookupOptions,
  ConditionalLookupOptionsValue,
} from './ConditionalLookupOptions';
import { FieldComputed } from './FieldComputed';

/**
 * ConditionalLookupField is a wrapper field that retrieves values from a foreign table
 * based on a condition (filter/sort/limit), rather than through a link field.
 *
 * Unlike regular LookupField which uses a LinkField to determine related records,
 * ConditionalLookupField uses a FieldCondition to query records from the foreign table.
 *
 * Like LookupField, it wraps another field type (the "inner field") which determines
 * the value type and formatting options.
 *
 * Key differences from LookupField:
 * - No linkFieldId - uses condition instead
 * - Queries foreign table directly based on condition
 * - Supports filter, sort, and limit in the condition
 *
 * Key characteristics (same as LookupField):
 * - Computed field (values are derived, not directly editable)
 * - Can be single or multiple cell values depending on configuration
 * - The inner field determines cellValueType, formatting, showAs, etc.
 */
export class ConditionalLookupField extends Field implements ForeignTableRelatedField {
  private innerFieldValue: Field | undefined;
  /**
   * Override for isMultipleCellValue. When set, this value is used instead of
   * defaulting to multiple. This is important for compatibility with v1.
   */
  private isMultipleCellValueOverride: boolean | undefined;

  private constructor(
    id: FieldId,
    name: FieldName,
    innerField: Field | undefined,
    private readonly conditionalLookupOptionsValue: ConditionalLookupOptions,
    dbFieldName?: DbFieldName,
    dependencies?: ReadonlyArray<FieldId>,
    isMultipleCellValue?: boolean
  ) {
    super(
      id,
      name,
      FieldType.conditionalLookup(),
      dbFieldName,
      dependencies ?? [],
      FieldComputed.computed()
    );
    this.innerFieldValue = innerField;
    this.isMultipleCellValueOverride = isMultipleCellValue;
  }

  /**
   * Creates a ConditionalLookupField with a known inner field.
   */
  static create(params: {
    id: FieldId;
    name: FieldName;
    innerField: Field;
    conditionalLookupOptions: ConditionalLookupOptions;
    dbFieldName?: DbFieldName;
    dependencies?: ReadonlyArray<FieldId>;
    isMultipleCellValue?: boolean;
  }): Result<ConditionalLookupField, DomainError> {
    return ok(
      new ConditionalLookupField(
        params.id,
        params.name,
        params.innerField,
        params.conditionalLookupOptions,
        params.dbFieldName,
        params.dependencies,
        params.isMultipleCellValue
      )
    );
  }

  /**
   * Creates a pending ConditionalLookupField without the inner field resolved.
   * The inner field will be resolved during foreign table validation.
   */
  static createPending(params: {
    id: FieldId;
    name: FieldName;
    conditionalLookupOptions: ConditionalLookupOptions;
    dbFieldName?: DbFieldName;
    dependencies?: ReadonlyArray<FieldId>;
    isMultipleCellValue?: boolean;
  }): Result<ConditionalLookupField, DomainError> {
    return ok(
      new ConditionalLookupField(
        params.id,
        params.name,
        undefined, // Inner field will be resolved during validation
        params.conditionalLookupOptions,
        params.dbFieldName,
        params.dependencies,
        params.isMultipleCellValue
      )
    );
  }

  /**
   * Rehydrates a ConditionalLookupField from persistence with the inner field already resolved.
   */
  static rehydrate(params: {
    id: FieldId;
    name: FieldName;
    innerField: Field;
    conditionalLookupOptions: ConditionalLookupOptions;
    dbFieldName?: DbFieldName;
    dependencies?: ReadonlyArray<FieldId>;
    isMultipleCellValue?: boolean;
  }): Result<ConditionalLookupField, DomainError> {
    return ConditionalLookupField.create(params);
  }

  /**
   * Whether this conditional lookup field is in a pending state (inner field not yet resolved).
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
      return err(
        domainError.unexpected({ message: 'ConditionalLookupField inner field not yet resolved' })
      );
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
   * The conditional lookup configuration (foreignTableId, lookupFieldId, condition).
   */
  conditionalLookupOptions(): ConditionalLookupOptions {
    return this.conditionalLookupOptionsValue;
  }

  conditionalLookupOptionsDto(): ConditionalLookupOptionsValue {
    return this.conditionalLookupOptionsValue.toDto();
  }

  /**
   * The ID of the field being looked up in the foreign table.
   */
  lookupFieldId(): FieldId {
    return this.conditionalLookupOptionsValue.lookupFieldId();
  }

  /**
   * The ID of the foreign table containing the lookup field.
   */
  foreignTableId(): TableId {
    return this.conditionalLookupOptionsValue.foreignTableId();
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
    // Default to multiple for new conditional lookup fields (v2 behavior)
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

  validateForeignTables(context: ForeignTableValidationContext): Result<void, DomainError> {
    // Unlike regular LookupField, ConditionalLookupField does not have a linkFieldId
    // It directly references a foreign table and applies conditions

    // 1. Find the foreign table
    const foreignTable = context.foreignTables.find((candidate) =>
      candidate.id().equals(this.foreignTableId())
    );
    if (!foreignTable) {
      return err(
        domainError.invariant({ message: 'ConditionalLookupField foreign table not loaded' })
      );
    }

    // 2. Validate lookup field exists in foreign table and resolve inner field
    const ft = ForeignTable.from(foreignTable);
    const lookupFieldResult = ft.fieldById(this.lookupFieldId());
    if (lookupFieldResult.isErr()) {
      return err(
        domainError.notFound({
          message: 'ConditionalLookupField lookup field not found in foreign table',
        })
      );
    }

    // 3. Resolve the inner field from the foreign table's lookup field
    // Nested lookups are supported - enables lookups across 3+ tables
    this.innerFieldValue = lookupFieldResult.value;

    // 4. Set dependencies to include field IDs referenced in the condition filter and the lookup field
    const conditionFieldIds = this.conditionalLookupOptionsValue.condition().filterFieldIds();
    return this.setDependencies([...conditionFieldIds, this.lookupFieldId()]);
  }

  duplicate(params: FieldDuplicateParams): Result<Field, DomainError> {
    const isMultipleResult = this.isMultipleCellValue();
    const isMultipleCellValue = isMultipleResult.isOk()
      ? isMultipleResult.value.isMultiple()
      : undefined;

    const innerFieldResult = this.innerField();
    if (innerFieldResult.isOk()) {
      return ConditionalLookupField.create({
        id: params.newId,
        name: params.newName,
        innerField: innerFieldResult.value,
        conditionalLookupOptions: this.conditionalLookupOptions(),
        isMultipleCellValue,
        dependencies: this.dependencies(),
      });
    }

    return ConditionalLookupField.createPending({
      id: params.newId,
      name: params.newName,
      conditionalLookupOptions: this.conditionalLookupOptions(),
      isMultipleCellValue,
      dependencies: this.dependencies(),
    });
  }

  accept<T = void>(visitor: IFieldVisitor<T>): Result<T, DomainError> {
    return visitor.visitConditionalLookupField(this);
  }

  private ensureForeignTable(foreignTable: ForeignTable): Result<void, DomainError> {
    if (!foreignTable.id().equals(this.foreignTableId())) {
      return err(
        domainError.unexpected({
          message: 'ForeignTable does not match ConditionalLookupField foreign table',
        })
      );
    }
    return ok(undefined);
  }
}
