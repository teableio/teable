import type { Result } from 'neverthrow';

import type { DomainError } from '../../shared/DomainError';
import type { ISpecVisitor } from '../../shared/specification/ISpecVisitor';
import type {
  RemoveSymmetricLinkFieldSpec,
  UpdateButtonColorSpec,
  UpdateButtonLabelSpec,
  UpdateButtonMaxCountSpec,
  UpdateButtonResetCountSpec,
  UpdateButtonWorkflowSpec,
  UpdateCheckboxDefaultValueSpec,
  UpdateDateDefaultValueSpec,
  UpdateDateFormattingSpec,
  UpdateFormulaExpressionSpec,
  UpdateFormulaFormattingSpec,
  UpdateFormulaShowAsSpec,
  UpdateFormulaTimeZoneSpec,
  UpdateLinkConfigSpec,
  UpdateLinkRelationshipSpec,
  UpdateLongTextDefaultValueSpec,
  UpdateLongTextShowAsSpec,
  UpdateLookupOptionsSpec,
  UpdateMultipleSelectAutoNewOptionsSpec,
  UpdateMultipleSelectDefaultValueSpec,
  UpdateMultipleSelectOptionsSpec,
  UpdateNumberDefaultValueSpec,
  UpdateNumberFormattingSpec,
  UpdateNumberShowAsSpec,
  UpdateRatingColorSpec,
  UpdateRatingIconSpec,
  UpdateRatingMaxSpec,
  UpdateRollupConfigSpec,
  UpdateRollupExpressionSpec,
  UpdateRollupFormattingSpec,
  UpdateRollupShowAsSpec,
  UpdateRollupTimeZoneSpec,
  UpdateSingleLineTextDefaultValueSpec,
  UpdateSingleLineTextShowAsSpec,
  UpdateSingleSelectAutoNewOptionsSpec,
  UpdateSingleSelectDefaultValueSpec,
  UpdateSingleSelectOptionsSpec,
  UpdateUserDefaultValueSpec,
  UpdateUserMultiplicitySpec,
  UpdateUserNotificationSpec,
} from './field-updates';
import type { TableAddFieldSpec } from './TableAddFieldSpec';
import type { TableAddFieldsSpec } from './TableAddFieldsSpec';
import type { TableAddSelectOptionsSpec } from './TableAddSelectOptionsSpec';
import type { TableAddViewSpec } from './TableAddViewSpec';
import type { TableByBaseIdSpec } from './TableByBaseIdSpec';
import type { TableByIdSpec } from './TableByIdSpec';
import type { TableByIdsSpec } from './TableByIdsSpec';
import type { TableByIncomingReferenceToTableSpec } from './TableByIncomingReferenceToTableSpec';
import type { TableByNameLikeSpec } from './TableByNameLikeSpec';
import type { TableByNameSpec } from './TableByNameSpec';
import type { TableByViewIdSpec } from './TableByViewIdSpec';
import type { TableDuplicateFieldSpec } from './TableDuplicateFieldSpec';
import type { TableEnsureViewRowOrderSpec } from './TableEnsureViewRowOrderSpec';
import type { TableRemoveFieldSpec } from './TableRemoveFieldSpec';
import type { TableRemoveViewSpec } from './TableRemoveViewSpec';
import type { TableRenameSpec } from './TableRenameSpec';
import type { TableRenameViewSpec } from './TableRenameViewSpec';
import type { TableUpdateFieldAiConfigSpec } from './TableUpdateFieldAiConfigSpec';
import type { TableUpdateFieldConstraintsSpec } from './TableUpdateFieldConstraintsSpec';
import type { TableUpdateFieldDbFieldNameSpec } from './TableUpdateFieldDbFieldNameSpec';
import type { TableUpdateFieldDescriptionSpec } from './TableUpdateFieldDescriptionSpec';
import type { TableUpdateFieldHasErrorSpec } from './TableUpdateFieldHasErrorSpec';
import type { TableUpdateFieldNameSpec } from './TableUpdateFieldNameSpec';
import type { TableUpdateFieldTypeSpec } from './TableUpdateFieldTypeSpec';
import type { TableUpdatePropertiesSpec } from './TableUpdatePropertiesSpec';
import type { TableUpdateViewColumnMetaSpec } from './TableUpdateViewColumnMetaSpec';
import type { TableUpdateViewDescriptionSpec } from './TableUpdateViewDescriptionSpec';
import type { TableUpdateViewLockedSpec } from './TableUpdateViewLockedSpec';
import type { TableUpdateViewOptionsSpec } from './TableUpdateViewOptionsSpec';
import type { TableUpdateViewOrderSpec } from './TableUpdateViewOrderSpec';
import type { TableUpdateViewQueryDefaultsSpec } from './TableUpdateViewQueryDefaultsSpec';
import type { TableUpdateViewShareIdSpec } from './TableUpdateViewShareIdSpec';
import type { TableUpdateViewShareMetaSpec } from './TableUpdateViewShareMetaSpec';
import type { TableUpdateViewShareStateSpec } from './TableUpdateViewShareStateSpec';
import type { TableWithViewIdsSpec } from './TableWithViewIdsSpec';
import type { TableWithPrimaryFieldSpec } from './TableWithPrimaryFieldSpec';

export interface ITableSpecVisitor<TResult = unknown> extends ISpecVisitor {
  // ============ Existing specs ============
  visitTableAddField(spec: TableAddFieldSpec): Result<TResult, DomainError>;
  visitTableAddFields(spec: TableAddFieldsSpec): Result<TResult, DomainError>;
  visitTableAddView(spec: TableAddViewSpec): Result<TResult, DomainError>;
  visitTableEnsureViewRowOrder(spec: TableEnsureViewRowOrderSpec): Result<TResult, DomainError>;
  visitTableRemoveView(spec: TableRemoveViewSpec): Result<TResult, DomainError>;
  visitTableRenameView(spec: TableRenameViewSpec): Result<TResult, DomainError>;
  visitTableUpdateViewDescription(
    spec: TableUpdateViewDescriptionSpec
  ): Result<TResult, DomainError>;
  visitTableUpdateViewLocked(spec: TableUpdateViewLockedSpec): Result<TResult, DomainError>;
  visitTableUpdateViewOrder(spec: TableUpdateViewOrderSpec): Result<TResult, DomainError>;
  visitTableAddSelectOptions(spec: TableAddSelectOptionsSpec): Result<TResult, DomainError>;
  visitTableDuplicateField(spec: TableDuplicateFieldSpec): Result<TResult, DomainError>;
  visitTableRemoveField(spec: TableRemoveFieldSpec): Result<TResult, DomainError>;
  visitTableUpdateViewColumnMeta(spec: TableUpdateViewColumnMetaSpec): Result<TResult, DomainError>;
  visitTableUpdateViewOptions(spec: TableUpdateViewOptionsSpec): Result<TResult, DomainError>;
  visitTableUpdateViewShareId(spec: TableUpdateViewShareIdSpec): Result<TResult, DomainError>;
  visitTableUpdateViewShareMeta(spec: TableUpdateViewShareMetaSpec): Result<TResult, DomainError>;
  visitTableUpdateViewShareState(spec: TableUpdateViewShareStateSpec): Result<TResult, DomainError>;
  visitTableUpdateViewQueryDefaults(
    spec: TableUpdateViewQueryDefaultsSpec
  ): Result<TResult, DomainError>;
  visitTableRename(spec: TableRenameSpec): Result<TResult, DomainError>;
  visitTableUpdateProperties(spec: TableUpdatePropertiesSpec): Result<TResult, DomainError>;
  visitTableByBaseId(spec: TableByBaseIdSpec): Result<TResult, DomainError>;
  visitTableById(spec: TableByIdSpec): Result<TResult, DomainError>;
  visitTableByViewId(spec: TableByViewIdSpec): Result<TResult, DomainError>;
  visitTableWithViewIds(spec: TableWithViewIdsSpec): Result<TResult, DomainError>;
  visitTableWithPrimaryField(spec: TableWithPrimaryFieldSpec): Result<TResult, DomainError>;
  visitTableByIncomingReferenceToTable(
    spec: TableByIncomingReferenceToTableSpec
  ): Result<TResult, DomainError>;
  visitTableByIds(spec: TableByIdsSpec): Result<TResult, DomainError>;
  visitTableByName(spec: TableByNameSpec): Result<TResult, DomainError>;
  visitTableByNameLike(spec: TableByNameLikeSpec): Result<TResult, DomainError>;

  // ============ Common Field Update specs ============
  visitTableUpdateFieldName(spec: TableUpdateFieldNameSpec): Result<TResult, DomainError>;
  visitTableUpdateFieldDbFieldName(
    spec: TableUpdateFieldDbFieldNameSpec
  ): Result<TResult, DomainError>;
  visitTableUpdateFieldType(spec: TableUpdateFieldTypeSpec): Result<TResult, DomainError>;
  visitTableUpdateFieldConstraints(
    spec: TableUpdateFieldConstraintsSpec
  ): Result<TResult, DomainError>;
  visitTableUpdateFieldAiConfig(spec: TableUpdateFieldAiConfigSpec): Result<TResult, DomainError>;
  visitTableUpdateFieldDescription(
    spec: TableUpdateFieldDescriptionSpec
  ): Result<TResult, DomainError>;
  visitTableUpdateFieldHasError(spec: TableUpdateFieldHasErrorSpec): Result<TResult, DomainError>;

  // ============ SingleLineText Update specs ============
  visitUpdateSingleLineTextShowAs(
    spec: UpdateSingleLineTextShowAsSpec
  ): Result<TResult, DomainError>;
  visitUpdateSingleLineTextDefaultValue(
    spec: UpdateSingleLineTextDefaultValueSpec
  ): Result<TResult, DomainError>;

  // ============ LongText Update specs ============
  visitUpdateLongTextShowAs(spec: UpdateLongTextShowAsSpec): Result<TResult, DomainError>;
  visitUpdateLongTextDefaultValue(
    spec: UpdateLongTextDefaultValueSpec
  ): Result<TResult, DomainError>;

  // ============ Number Update specs ============
  visitUpdateNumberFormatting(spec: UpdateNumberFormattingSpec): Result<TResult, DomainError>;
  visitUpdateNumberShowAs(spec: UpdateNumberShowAsSpec): Result<TResult, DomainError>;
  visitUpdateNumberDefaultValue(spec: UpdateNumberDefaultValueSpec): Result<TResult, DomainError>;

  // ============ Date Update specs ============
  visitUpdateDateFormatting(spec: UpdateDateFormattingSpec): Result<TResult, DomainError>;
  visitUpdateDateDefaultValue(spec: UpdateDateDefaultValueSpec): Result<TResult, DomainError>;

  // ============ Checkbox Update specs ============
  visitUpdateCheckboxDefaultValue(
    spec: UpdateCheckboxDefaultValueSpec
  ): Result<TResult, DomainError>;

  // ============ Rating Update specs ============
  visitUpdateRatingMax(spec: UpdateRatingMaxSpec): Result<TResult, DomainError>;
  visitUpdateRatingIcon(spec: UpdateRatingIconSpec): Result<TResult, DomainError>;
  visitUpdateRatingColor(spec: UpdateRatingColorSpec): Result<TResult, DomainError>;

  // ============ User Update specs ============
  visitUpdateUserMultiplicity(spec: UpdateUserMultiplicitySpec): Result<TResult, DomainError>;
  visitUpdateUserNotification(spec: UpdateUserNotificationSpec): Result<TResult, DomainError>;
  visitUpdateUserDefaultValue(spec: UpdateUserDefaultValueSpec): Result<TResult, DomainError>;

  // ============ Button Update specs ============
  visitUpdateButtonLabel(spec: UpdateButtonLabelSpec): Result<TResult, DomainError>;
  visitUpdateButtonColor(spec: UpdateButtonColorSpec): Result<TResult, DomainError>;
  visitUpdateButtonMaxCount(spec: UpdateButtonMaxCountSpec): Result<TResult, DomainError>;
  visitUpdateButtonResetCount(spec: UpdateButtonResetCountSpec): Result<TResult, DomainError>;
  visitUpdateButtonWorkflow(spec: UpdateButtonWorkflowSpec): Result<TResult, DomainError>;

  // ============ SingleSelect Update specs ============
  visitUpdateSingleSelectOptions(spec: UpdateSingleSelectOptionsSpec): Result<TResult, DomainError>;
  visitUpdateSingleSelectDefaultValue(
    spec: UpdateSingleSelectDefaultValueSpec
  ): Result<TResult, DomainError>;
  visitUpdateSingleSelectAutoNewOptions(
    spec: UpdateSingleSelectAutoNewOptionsSpec
  ): Result<TResult, DomainError>;

  // ============ MultipleSelect Update specs ============
  visitUpdateMultipleSelectOptions(
    spec: UpdateMultipleSelectOptionsSpec
  ): Result<TResult, DomainError>;
  visitUpdateMultipleSelectDefaultValue(
    spec: UpdateMultipleSelectDefaultValueSpec
  ): Result<TResult, DomainError>;
  visitUpdateMultipleSelectAutoNewOptions(
    spec: UpdateMultipleSelectAutoNewOptionsSpec
  ): Result<TResult, DomainError>;

  // ============ Formula Update specs ============
  visitUpdateFormulaExpression(spec: UpdateFormulaExpressionSpec): Result<TResult, DomainError>;
  visitUpdateFormulaFormatting(spec: UpdateFormulaFormattingSpec): Result<TResult, DomainError>;
  visitUpdateFormulaShowAs(spec: UpdateFormulaShowAsSpec): Result<TResult, DomainError>;
  visitUpdateFormulaTimeZone(spec: UpdateFormulaTimeZoneSpec): Result<TResult, DomainError>;

  // ============ Link Update specs ============
  visitUpdateLinkConfig(spec: UpdateLinkConfigSpec): Result<TResult, DomainError>;
  visitUpdateLinkRelationship(spec: UpdateLinkRelationshipSpec): Result<TResult, DomainError>;
  visitRemoveSymmetricLinkField(spec: RemoveSymmetricLinkFieldSpec): Result<TResult, DomainError>;

  // ============ Lookup Update specs ============
  visitUpdateLookupOptions(spec: UpdateLookupOptionsSpec): Result<TResult, DomainError>;

  // ============ Rollup Update specs ============
  visitUpdateRollupConfig(spec: UpdateRollupConfigSpec): Result<TResult, DomainError>;
  visitUpdateRollupExpression(spec: UpdateRollupExpressionSpec): Result<TResult, DomainError>;
  visitUpdateRollupFormatting(spec: UpdateRollupFormattingSpec): Result<TResult, DomainError>;
  visitUpdateRollupShowAs(spec: UpdateRollupShowAsSpec): Result<TResult, DomainError>;
  visitUpdateRollupTimeZone(spec: UpdateRollupTimeZoneSpec): Result<TResult, DomainError>;
}
