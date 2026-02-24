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
  TableUpdateFieldDbFieldNameSpec,
  TableUpdateFieldTypeSpec,
  TableUpdateFieldConstraintsSpec,
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
import { ok } from 'neverthrow';
import type { Result } from 'neverthrow';

/**
 * Visitor that detects whether a table spec involves dependency relationship changes
 * that require circular dependency checking.
 *
 * Returns true for specs that:
 * - Add new computed fields (formula, lookup, rollup, conditional rollup/lookup, link)
 * - Convert field types (may introduce new dependencies)
 * - Update field configurations that change dependencies (lookupFieldId, expression, etc.)
 */
export class DependencyChangeDetectorVisitor implements ITableSpecVisitor<void> {
  private needsCheckValue = false;
  private readonly dependencyChangedFieldIdSet = new Map<string, FieldId>();

  needsCheck(): boolean {
    return this.needsCheckValue;
  }

  dependencyChangedFieldIds(): ReadonlyArray<FieldId> {
    return [...this.dependencyChangedFieldIdSet.values()];
  }

  private markForCheck(fieldId?: FieldId): void {
    this.needsCheckValue = true;
    if (fieldId) {
      this.dependencyChangedFieldIdSet.set(fieldId.toString(), fieldId);
    }
  }

  visit(_: ISpecification): Result<void, DomainError> {
    return ok(undefined);
  }

  visitTableRename(_spec: TableRenameSpec): Result<void, DomainError> {
    return ok(undefined);
  }

  visitTableAddField(spec: TableAddFieldSpec): Result<void, DomainError> {
    const field = spec.field();
    const type = field.type().toString();
    // Only computed fields create dependencies
    const computedTypes = [
      'formula',
      'lookup',
      'rollup',
      'conditionalRollup',
      'conditionalLookup',
      'link',
    ];
    if (computedTypes.includes(type)) {
      this.markForCheck(field.id());
    }
    return ok(undefined);
  }

  visitTableAddSelectOptions(_spec: TableAddSelectOptionsSpec): Result<void, DomainError> {
    return ok(undefined);
  }

  visitTableDuplicateField(_spec: TableDuplicateFieldSpec): Result<void, DomainError> {
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

  // Common field update specs
  visitTableUpdateFieldName(_spec: TableUpdateFieldNameSpec): Result<void, DomainError> {
    return ok(undefined);
  }

  visitTableUpdateFieldDbFieldName(
    _spec: TableUpdateFieldDbFieldNameSpec
  ): Result<void, DomainError> {
    return ok(undefined);
  }

  visitTableUpdateFieldType(_spec: TableUpdateFieldTypeSpec): Result<void, DomainError> {
    // Type conversion may introduce new dependencies
    this.markForCheck(_spec.newField().id());
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

  visitTableUpdateFieldHasError(_spec: TableUpdateFieldHasErrorSpec): Result<void, DomainError> {
    return ok(undefined);
  }

  // Field-type-specific update specs - most don't affect dependencies
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

  visitUpdateLongTextDefaultValue(
    _spec: UpdateLongTextDefaultValueSpec
  ): Result<void, DomainError> {
    return ok(undefined);
  }

  visitUpdateNumberFormatting(_spec: UpdateNumberFormattingSpec): Result<void, DomainError> {
    return ok(undefined);
  }

  visitUpdateNumberShowAs(_spec: UpdateNumberShowAsSpec): Result<void, DomainError> {
    return ok(undefined);
  }

  visitUpdateNumberDefaultValue(_spec: UpdateNumberDefaultValueSpec): Result<void, DomainError> {
    return ok(undefined);
  }

  visitUpdateDateFormatting(_spec: UpdateDateFormattingSpec): Result<void, DomainError> {
    return ok(undefined);
  }

  visitUpdateDateDefaultValue(_spec: UpdateDateDefaultValueSpec): Result<void, DomainError> {
    return ok(undefined);
  }

  visitUpdateCheckboxDefaultValue(
    _spec: UpdateCheckboxDefaultValueSpec
  ): Result<void, DomainError> {
    return ok(undefined);
  }

  visitUpdateRatingMax(_spec: UpdateRatingMaxSpec): Result<void, DomainError> {
    return ok(undefined);
  }

  visitUpdateRatingIcon(_spec: UpdateRatingIconSpec): Result<void, DomainError> {
    return ok(undefined);
  }

  visitUpdateRatingColor(_spec: UpdateRatingColorSpec): Result<void, DomainError> {
    return ok(undefined);
  }

  visitUpdateUserMultiplicity(_spec: UpdateUserMultiplicitySpec): Result<void, DomainError> {
    return ok(undefined);
  }

  visitUpdateUserNotification(_spec: UpdateUserNotificationSpec): Result<void, DomainError> {
    return ok(undefined);
  }

  visitUpdateUserDefaultValue(_spec: UpdateUserDefaultValueSpec): Result<void, DomainError> {
    return ok(undefined);
  }

  visitUpdateButtonLabel(_spec: UpdateButtonLabelSpec): Result<void, DomainError> {
    return ok(undefined);
  }

  visitUpdateButtonColor(_spec: UpdateButtonColorSpec): Result<void, DomainError> {
    return ok(undefined);
  }

  visitUpdateButtonMaxCount(_spec: UpdateButtonMaxCountSpec): Result<void, DomainError> {
    return ok(undefined);
  }

  visitUpdateButtonWorkflow(_spec: UpdateButtonWorkflowSpec): Result<void, DomainError> {
    return ok(undefined);
  }

  visitUpdateSingleSelectOptions(_spec: UpdateSingleSelectOptionsSpec): Result<void, DomainError> {
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

  visitUpdateMultipleSelectOptions(
    _spec: UpdateMultipleSelectOptionsSpec
  ): Result<void, DomainError> {
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

  // Formula - expression changes affect dependencies
  visitUpdateFormulaExpression(_spec: UpdateFormulaExpressionSpec): Result<void, DomainError> {
    this.markForCheck(_spec.fieldId());
    return ok(undefined);
  }

  visitUpdateFormulaFormatting(_spec: UpdateFormulaFormattingSpec): Result<void, DomainError> {
    return ok(undefined);
  }

  visitUpdateFormulaShowAs(_spec: UpdateFormulaShowAsSpec): Result<void, DomainError> {
    return ok(undefined);
  }

  visitUpdateFormulaTimeZone(_spec: UpdateFormulaTimeZoneSpec): Result<void, DomainError> {
    return ok(undefined);
  }

  // Link - config changes may affect dependencies
  visitUpdateLinkConfig(_spec: UpdateLinkConfigSpec): Result<void, DomainError> {
    // lookupFieldId or symmetricFieldId changes affect dependencies
    this.markForCheck(_spec.fieldId());
    return ok(undefined);
  }

  visitUpdateLinkRelationship(_spec: UpdateLinkRelationshipSpec): Result<void, DomainError> {
    return ok(undefined);
  }

  // Lookup - options changes affect dependencies
  visitUpdateLookupOptions(_spec: UpdateLookupOptionsSpec): Result<void, DomainError> {
    // lookupFieldId or linkFieldId changes affect dependencies
    this.markForCheck(_spec.fieldId());
    return ok(undefined);
  }

  // Rollup - config and expression changes affect dependencies
  visitUpdateRollupConfig(_spec: UpdateRollupConfigSpec): Result<void, DomainError> {
    // lookupFieldId or linkFieldId changes affect dependencies
    this.markForCheck(_spec.fieldId());
    return ok(undefined);
  }

  visitUpdateRollupExpression(_spec: UpdateRollupExpressionSpec): Result<void, DomainError> {
    return ok(undefined);
  }

  visitUpdateRollupFormatting(_spec: UpdateRollupFormattingSpec): Result<void, DomainError> {
    return ok(undefined);
  }

  visitUpdateRollupShowAs(_spec: UpdateRollupShowAsSpec): Result<void, DomainError> {
    return ok(undefined);
  }

  visitUpdateRollupTimeZone(_spec: UpdateRollupTimeZoneSpec): Result<void, DomainError> {
    return ok(undefined);
  }

  visitRemoveSymmetricLinkField(_spec: RemoveSymmetricLinkFieldSpec): Result<void, DomainError> {
    return ok(undefined);
  }

  // ConditionalRollup - config changes affect dependencies
  visitUpdateConditionalRollupConfig(_spec: unknown): Result<void, DomainError> {
    // lookupFieldId or condition changes affect dependencies
    this.markForCheck();
    return ok(undefined);
  }

  visitUpdateConditionalRollupExpression(_spec: unknown): Result<void, DomainError> {
    return ok(undefined);
  }

  visitUpdateConditionalRollupFormatting(_spec: unknown): Result<void, DomainError> {
    return ok(undefined);
  }

  visitUpdateConditionalRollupShowAs(_spec: unknown): Result<void, DomainError> {
    return ok(undefined);
  }

  visitUpdateConditionalRollupTimeZone(_spec: unknown): Result<void, DomainError> {
    return ok(undefined);
  }

  // ConditionalLookup - config changes affect dependencies
  visitUpdateConditionalLookupConfig(_spec: unknown): Result<void, DomainError> {
    // lookupFieldId or condition changes affect dependencies
    this.markForCheck();
    return ok(undefined);
  }
}
