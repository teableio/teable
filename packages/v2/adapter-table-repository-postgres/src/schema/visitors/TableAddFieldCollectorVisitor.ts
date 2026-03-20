import type {
  DomainError,
  Field,
  ISpecification,
  ITableSpecVisitor,
  TableAddFieldSpec,
  TableAddFieldsSpec,
  TableAddSelectOptionsSpec,
  TableByBaseIdSpec,
  TableByIdSpec,
  TableByIncomingReferenceToTableSpec,
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
  UpdateLongTextShowAsSpec,
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

export class TableAddFieldCollectorVisitor implements ITableSpecVisitor<void> {
  private readonly fieldsValue: Field[] = [];

  fields(): ReadonlyArray<Field> {
    return [...this.fieldsValue];
  }

  visit(_: ISpecification): Result<void, DomainError> {
    return ok(undefined);
  }

  visitTableRename(_spec: TableRenameSpec): Result<void, DomainError> {
    return ok(undefined);
  }

  visitTableAddField(spec: TableAddFieldSpec): Result<void, DomainError> {
    this.fieldsValue.push(spec.field());
    return ok(undefined);
  }

  visitTableAddFields(spec: TableAddFieldsSpec): Result<void, DomainError> {
    this.fieldsValue.push(...spec.fields());
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

  visitTableByIncomingReferenceToTable(
    _spec: TableByIncomingReferenceToTableSpec
  ): Result<void, DomainError> {
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

  visitTableUpdateFieldType(_spec: TableUpdateFieldTypeSpec): Result<void, DomainError> {
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

  visitUpdateLongTextShowAs(_spec: UpdateLongTextShowAsSpec): Result<void, DomainError> {
    return ok(undefined);
  }

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

  visitUpdateRatingMax(_spec: UpdateRatingMaxSpec): Result<void, DomainError> {
    return ok(undefined);
  }

  visitUpdateRatingIcon(_spec: UpdateRatingIconSpec): Result<void, DomainError> {
    return ok(undefined);
  }

  visitUpdateRatingColor(_spec: UpdateRatingColorSpec): Result<void, DomainError> {
    return ok(undefined);
  }

  // ============ User Update specs ============

  visitUpdateUserMultiplicity(_spec: UpdateUserMultiplicitySpec): Result<void, DomainError> {
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

  visitUpdateButtonWorkflow(_spec: UpdateButtonWorkflowSpec): Result<void, DomainError> {
    return ok(undefined);
  }

  // ============ SingleSelect Update specs ============

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

  // ============ MultipleSelect Update specs ============

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

  // ============ Formula Update specs ============

  visitUpdateFormulaExpression(_spec: UpdateFormulaExpressionSpec): Result<void, DomainError> {
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

  // ============ Link Update specs ============

  visitUpdateLinkConfig(_spec: UpdateLinkConfigSpec): Result<void, DomainError> {
    return ok(undefined);
  }

  visitUpdateLinkRelationship(_spec: UpdateLinkRelationshipSpec): Result<void, DomainError> {
    return ok(undefined);
  }

  // ============ Lookup Update specs ============

  visitUpdateLookupOptions(_spec: UpdateLookupOptionsSpec): Result<void, DomainError> {
    return ok(undefined);
  }

  // ============ Rollup Update specs ============

  visitUpdateRollupConfig(_spec: UpdateRollupConfigSpec): Result<void, DomainError> {
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

  // RemoveSymmetricLinkField
  visitRemoveSymmetricLinkField(_spec: RemoveSymmetricLinkFieldSpec): Result<void, DomainError> {
    return ok(undefined);
  }
}
