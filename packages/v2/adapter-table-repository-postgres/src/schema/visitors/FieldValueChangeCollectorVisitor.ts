import type {
  DomainError,
  FieldId,
  ISpecification,
  ITableSpecVisitor,
  TableAddFieldSpec,
  TableAddSelectOptionsSpec,
  TableByBaseIdSpec,
  TableByIdSpec,
  TableByIdsSpec,
  TableByNameLikeSpec,
  TableByNameSpec,
  TableDuplicateFieldSpec,
  TableRemoveFieldSpec,
  TableUpdateViewColumnMetaSpec,
  TableUpdateViewQueryDefaultsSpec,
  TableRenameSpec,
  // Common field update specs
  TableUpdateFieldNameSpec,
  TableUpdateFieldTypeSpec,
  TableUpdateFieldConstraintsSpec,
  TableUpdateFieldDbFieldNameSpec,
  TableUpdateFieldAiConfigSpec,
  TableUpdateFieldDescriptionSpec,
  TableUpdateFieldHasErrorSpec,
  // Field-type-specific update specs
  UpdateSingleLineTextShowAsSpec,
  UpdateSingleLineTextDefaultValueSpec,
  UpdateLongTextDefaultValueSpec,
  UpdateNumberFormattingSpec,
  UpdateNumberShowAsSpec,
  UpdateNumberDefaultValueSpec,
  UpdateDateFormattingSpec,
  UpdateDateDefaultValueSpec,
  UpdateCheckboxDefaultValueSpec,
  UpdateRatingMaxSpec,
  UpdateRatingIconSpec,
  UpdateRatingColorSpec,
  UpdateUserMultiplicitySpec,
  UpdateUserNotificationSpec,
  UpdateUserDefaultValueSpec,
  UpdateButtonLabelSpec,
  UpdateButtonColorSpec,
  UpdateButtonMaxCountSpec,
  UpdateButtonWorkflowSpec,
  UpdateSingleSelectOptionsSpec,
  UpdateSingleSelectDefaultValueSpec,
  UpdateSingleSelectAutoNewOptionsSpec,
  UpdateMultipleSelectOptionsSpec,
  UpdateMultipleSelectDefaultValueSpec,
  UpdateMultipleSelectAutoNewOptionsSpec,
  UpdateFormulaExpressionSpec,
  UpdateFormulaFormattingSpec,
  UpdateFormulaShowAsSpec,
  UpdateFormulaTimeZoneSpec,
  UpdateLinkConfigSpec,
  UpdateLinkRelationshipSpec,
  UpdateLookupOptionsSpec,
  UpdateRollupConfigSpec,
  UpdateRollupExpressionSpec,
  UpdateRollupFormattingSpec,
  UpdateRollupShowAsSpec,
  UpdateRollupTimeZoneSpec,
  RemoveSymmetricLinkFieldSpec,
} from '@teable/v2-core';
import { FieldValueTypeVisitor } from '@teable/v2-core';
import { ok } from 'neverthrow';
import type { Result } from 'neverthrow';

/**
 * Visitor that collects field IDs whose stored values change during schema updates.
 *
 * Two categories:
 * - **selfBackfillFieldIds**: Computed fields whose definition changed and need own recomputation
 * - **valueChangedFieldIds**: Fields whose stored values were changed by SQL (dependents need cascade)
 */
export class FieldValueChangeCollectorVisitor implements ITableSpecVisitor<void> {
  private readonly selfBackfillFieldIdSet = new Map<string, FieldId>();
  private readonly valueChangedFieldIdSet = new Map<string, FieldId>();
  private readonly deferredBackfillFieldIdSet = new Map<string, FieldId>();
  private dbStorageTypeChanged = false;

  selfBackfillFields(): ReadonlyArray<FieldId> {
    return [...this.selfBackfillFieldIdSet.values()];
  }

  valueChangedFields(): ReadonlyArray<FieldId> {
    return [...this.valueChangedFieldIdSet.values()];
  }

  deferredBackfillFields(): ReadonlyArray<FieldId> {
    return [...this.deferredBackfillFieldIdSet.values()];
  }

  /**
   * Whether any field conversion changed the underlying DB column type
   * (cellValueType or isMultipleCellValue changed).
   * When true, dependent computed fields may have stale column types,
   * making IS DISTINCT FROM comparisons unsafe.
   */
  hasDbStorageTypeChange(): boolean {
    return this.dbStorageTypeChanged;
  }

  private addSelfBackfill(fieldId: FieldId): void {
    this.selfBackfillFieldIdSet.set(fieldId.toString(), fieldId);
  }

  private addValueChanged(fieldId: FieldId): void {
    this.valueChangedFieldIdSet.set(fieldId.toString(), fieldId);
  }

  private addDeferredBackfill(fieldId: FieldId): void {
    this.deferredBackfillFieldIdSet.set(fieldId.toString(), fieldId);
  }

  visit(_: ISpecification): Result<void, DomainError> {
    return ok(undefined);
  }

  visitTableRename(_spec: TableRenameSpec): Result<void, DomainError> {
    return ok(undefined);
  }

  visitTableAddField(_spec: TableAddFieldSpec): Result<void, DomainError> {
    return ok(undefined);
  }

  visitTableAddSelectOptions(_spec: TableAddSelectOptionsSpec): Result<void, DomainError> {
    return ok(undefined);
  }

  visitTableDuplicateField(spec: TableDuplicateFieldSpec): Result<void, DomainError> {
    if (spec.newField().computed().toBoolean()) {
      this.addSelfBackfill(spec.newField().id());
    }
    return ok(undefined);
  }

  visitTableRemoveField(_spec: TableRemoveFieldSpec): Result<void, DomainError> {
    return ok(undefined);
  }

  visitTableUpdateViewColumnMeta(_spec: TableUpdateViewColumnMetaSpec): Result<void, DomainError> {
    return ok(undefined);
  }

  visitTableUpdateViewQueryDefaults(
    _spec: TableUpdateViewQueryDefaultsSpec
  ): Result<void, DomainError> {
    return ok(undefined);
  }

  visitTableByBaseId(_spec: TableByBaseIdSpec): Result<void, DomainError> {
    return ok(undefined);
  }

  visitTableById(_spec: TableByIdSpec): Result<void, DomainError> {
    return ok(undefined);
  }

  visitTableByIds(_spec: TableByIdsSpec): Result<void, DomainError> {
    return ok(undefined);
  }

  visitTableByName(_spec: TableByNameSpec): Result<void, DomainError> {
    return ok(undefined);
  }

  visitTableByNameLike(_spec: TableByNameLikeSpec): Result<void, DomainError> {
    return ok(undefined);
  }

  // ============ Common Field Update specs ============

  visitTableUpdateFieldName(_spec: TableUpdateFieldNameSpec): Result<void, DomainError> {
    return ok(undefined);
  }

  visitTableUpdateFieldDbFieldName(
    _spec: TableUpdateFieldDbFieldNameSpec
  ): Result<void, DomainError> {
    return ok(undefined);
  }

  visitTableUpdateFieldType(spec: TableUpdateFieldTypeSpec): Result<void, DomainError> {
    if (spec.isTypeConversion()) {
      const fieldId = spec.newField().id();
      const newIsComputed = spec.newField().computed().toBoolean();
      // Type conversion rewrites stored values (or value shape), so dependents
      // must be cascaded after schema statements are applied.
      this.addValueChanged(fieldId);

      // If the new field is computed, it also needs self-backfill.
      if (newIsComputed) {
        this.addSelfBackfill(fieldId);
      }

      // Detect whether the underlying PG column type changed
      // (cellValueType or isMultipleCellValue differs).
      const vtVisitor = new FieldValueTypeVisitor();
      const oldVt = spec.oldField().accept(vtVisitor);
      const newVt = spec.newField().accept(vtVisitor);
      if (
        oldVt.isOk() &&
        newVt.isOk() &&
        (!oldVt.value.cellValueType.equals(newVt.value.cellValueType) ||
          !oldVt.value.isMultipleCellValue.equals(newVt.value.isMultipleCellValue))
      ) {
        this.dbStorageTypeChanged = true;
      }
    } else if (spec.newField().computed().toBoolean()) {
      const oldField = spec.oldField() as {
        type(): { toString(): string };
        conditionalLookupOptions?: () => { equals(other: unknown): boolean };
      };
      const newField = spec.newField() as {
        type(): { toString(): string };
        conditionalLookupOptions?: () => { equals(other: unknown): boolean };
      };
      const isConditionalLookupOptionsOnlyUpdate =
        oldField.type().toString() === 'conditionalLookup' &&
        newField.type().toString() === 'conditionalLookup' &&
        typeof oldField.conditionalLookupOptions === 'function' &&
        typeof newField.conditionalLookupOptions === 'function' &&
        oldField.conditionalLookupOptions().equals(newField.conditionalLookupOptions());
      if (isConditionalLookupOptionsOnlyUpdate) {
        return ok(undefined);
      }

      // Same-type update to a computed field (e.g., conditionalLookup options or
      // conditionalRollup config/expression changed). The computed definition
      // changed, so self-backfill is needed to recompute values.
      this.addSelfBackfill(spec.newField().id());
    }
    return ok(undefined);
  }

  visitTableUpdateFieldConstraints(
    _spec: TableUpdateFieldConstraintsSpec
  ): Result<void, DomainError> {
    return ok(undefined);
  }

  visitTableUpdateFieldAiConfig(_spec: TableUpdateFieldAiConfigSpec): Result<void, DomainError> {
    return ok(undefined);
  }

  visitTableUpdateFieldDescription(
    _spec: TableUpdateFieldDescriptionSpec
  ): Result<void, DomainError> {
    return ok(undefined);
  }

  visitTableUpdateFieldHasError(spec: TableUpdateFieldHasErrorSpec): Result<void, DomainError> {
    if (spec.isSettingError()) {
      this.addValueChanged(spec.fieldId());
    }
    return ok(undefined);
  }

  // ============ SingleLineText Update specs ============

  visitUpdateSingleLineTextShowAs(
    _spec: UpdateSingleLineTextShowAsSpec
  ): Result<void, DomainError> {
    return ok(undefined);
  }

  visitUpdateSingleLineTextDefaultValue(
    _spec: UpdateSingleLineTextDefaultValueSpec
  ): Result<void, DomainError> {
    return ok(undefined);
  }

  // ============ LongText Update specs ============

  visitUpdateLongTextDefaultValue(
    _spec: UpdateLongTextDefaultValueSpec
  ): Result<void, DomainError> {
    return ok(undefined);
  }

  // ============ Number Update specs ============

  visitUpdateNumberFormatting(_spec: UpdateNumberFormattingSpec): Result<void, DomainError> {
    return ok(undefined);
  }

  visitUpdateNumberShowAs(_spec: UpdateNumberShowAsSpec): Result<void, DomainError> {
    return ok(undefined);
  }

  visitUpdateNumberDefaultValue(_spec: UpdateNumberDefaultValueSpec): Result<void, DomainError> {
    return ok(undefined);
  }

  // ============ Date Update specs ============

  visitUpdateDateFormatting(_spec: UpdateDateFormattingSpec): Result<void, DomainError> {
    return ok(undefined);
  }

  visitUpdateDateDefaultValue(_spec: UpdateDateDefaultValueSpec): Result<void, DomainError> {
    return ok(undefined);
  }

  // ============ Checkbox Update specs ============

  visitUpdateCheckboxDefaultValue(
    _spec: UpdateCheckboxDefaultValueSpec
  ): Result<void, DomainError> {
    return ok(undefined);
  }

  // ============ Rating Update specs ============

  visitUpdateRatingMax(spec: UpdateRatingMaxSpec): Result<void, DomainError> {
    if (spec.isMaxReducing()) {
      this.addValueChanged(spec.fieldId());
    }
    return ok(undefined);
  }

  visitUpdateRatingIcon(_spec: UpdateRatingIconSpec): Result<void, DomainError> {
    return ok(undefined);
  }

  visitUpdateRatingColor(_spec: UpdateRatingColorSpec): Result<void, DomainError> {
    return ok(undefined);
  }

  // ============ User Update specs ============

  visitUpdateUserMultiplicity(spec: UpdateUserMultiplicitySpec): Result<void, DomainError> {
    this.addValueChanged(spec.fieldId());
    return ok(undefined);
  }

  visitUpdateUserNotification(_spec: UpdateUserNotificationSpec): Result<void, DomainError> {
    return ok(undefined);
  }

  visitUpdateUserDefaultValue(_spec: UpdateUserDefaultValueSpec): Result<void, DomainError> {
    return ok(undefined);
  }

  // ============ Button Update specs ============

  visitUpdateButtonLabel(_spec: UpdateButtonLabelSpec): Result<void, DomainError> {
    return ok(undefined);
  }

  visitUpdateButtonColor(_spec: UpdateButtonColorSpec): Result<void, DomainError> {
    return ok(undefined);
  }

  visitUpdateButtonMaxCount(_spec: UpdateButtonMaxCountSpec): Result<void, DomainError> {
    return ok(undefined);
  }

  visitUpdateButtonWorkflow(spec: UpdateButtonWorkflowSpec): Result<void, DomainError> {
    this.addValueChanged(spec.fieldId());
    return ok(undefined);
  }

  // ============ SingleSelect Update specs ============

  visitUpdateSingleSelectOptions(spec: UpdateSingleSelectOptionsSpec): Result<void, DomainError> {
    if (spec.renamedOptions().length > 0 || spec.removedOptions().length > 0) {
      this.addValueChanged(spec.fieldId());
    }
    return ok(undefined);
  }

  visitUpdateSingleSelectDefaultValue(
    _spec: UpdateSingleSelectDefaultValueSpec
  ): Result<void, DomainError> {
    return ok(undefined);
  }

  visitUpdateSingleSelectAutoNewOptions(
    _spec: UpdateSingleSelectAutoNewOptionsSpec
  ): Result<void, DomainError> {
    return ok(undefined);
  }

  // ============ MultipleSelect Update specs ============

  visitUpdateMultipleSelectOptions(
    spec: UpdateMultipleSelectOptionsSpec
  ): Result<void, DomainError> {
    if (spec.renamedOptions().length > 0 || spec.removedOptions().length > 0) {
      this.addValueChanged(spec.fieldId());
    }
    return ok(undefined);
  }

  visitUpdateMultipleSelectDefaultValue(
    _spec: UpdateMultipleSelectDefaultValueSpec
  ): Result<void, DomainError> {
    return ok(undefined);
  }

  visitUpdateMultipleSelectAutoNewOptions(
    _spec: UpdateMultipleSelectAutoNewOptionsSpec
  ): Result<void, DomainError> {
    return ok(undefined);
  }

  // ============ Formula Update specs ============

  visitUpdateFormulaExpression(spec: UpdateFormulaExpressionSpec): Result<void, DomainError> {
    this.addSelfBackfill(spec.fieldId());
    this.addValueChanged(spec.fieldId());
    // Formula expression changes may alter the result DB type (e.g. number -> text).
    // Skip DISTINCT filtering during backfill to avoid cross-type comparison errors.
    this.dbStorageTypeChanged = true;
    return ok(undefined);
  }

  visitUpdateFormulaFormatting(_spec: UpdateFormulaFormattingSpec): Result<void, DomainError> {
    return ok(undefined);
  }

  visitUpdateFormulaShowAs(_spec: UpdateFormulaShowAsSpec): Result<void, DomainError> {
    return ok(undefined);
  }

  visitUpdateFormulaTimeZone(_spec: UpdateFormulaTimeZoneSpec): Result<void, DomainError> {
    this.addSelfBackfill(_spec.fieldId());
    return ok(undefined);
  }

  // ============ Link Update specs ============

  visitUpdateLinkConfig(spec: UpdateLinkConfigSpec): Result<void, DomainError> {
    if (!spec.previousConfig().lookupFieldId().equals(spec.nextConfig().lookupFieldId())) {
      this.addSelfBackfill(spec.fieldId());
    }
    return ok(undefined);
  }

  visitUpdateLinkRelationship(spec: UpdateLinkRelationshipSpec): Result<void, DomainError> {
    this.addDeferredBackfill(spec.fieldId());
    return ok(undefined);
  }

  // ============ Lookup Update specs ============

  visitUpdateLookupOptions(spec: UpdateLookupOptionsSpec): Result<void, DomainError> {
    this.addSelfBackfill(spec.fieldId());
    // When the lookupFieldId changes, the inner field type may change
    // (e.g. text → number), which alters the DB column type.
    // Skip the DISTINCT filter to avoid type-mismatch errors during backfill.
    if (!spec.previousOptions().lookupFieldId().equals(spec.nextOptions().lookupFieldId())) {
      this.dbStorageTypeChanged = true;
    }
    return ok(undefined);
  }

  // ============ Rollup Update specs ============

  visitUpdateRollupConfig(spec: UpdateRollupConfigSpec): Result<void, DomainError> {
    this.addSelfBackfill(spec.fieldId());
    return ok(undefined);
  }

  visitUpdateRollupExpression(spec: UpdateRollupExpressionSpec): Result<void, DomainError> {
    this.addSelfBackfill(spec.fieldId());
    return ok(undefined);
  }

  visitUpdateRollupFormatting(_spec: UpdateRollupFormattingSpec): Result<void, DomainError> {
    return ok(undefined);
  }

  visitUpdateRollupShowAs(_spec: UpdateRollupShowAsSpec): Result<void, DomainError> {
    return ok(undefined);
  }

  visitUpdateRollupTimeZone(_spec: UpdateRollupTimeZoneSpec): Result<void, DomainError> {
    this.addSelfBackfill(_spec.fieldId());
    return ok(undefined);
  }

  // RemoveSymmetricLinkField
  visitRemoveSymmetricLinkField(_spec: RemoveSymmetricLinkFieldSpec): Result<void, DomainError> {
    return ok(undefined);
  }
}
