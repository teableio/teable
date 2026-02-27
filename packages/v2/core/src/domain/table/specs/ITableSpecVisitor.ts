import type { Result } from 'neverthrow';

import type { DomainError } from '../../shared/DomainError';
import type { ISpecVisitor } from '../../shared/specification/ISpecVisitor';
import type {
  RemoveSymmetricLinkFieldSpec,
  UpdateButtonColorSpec,
  UpdateButtonLabelSpec,
  UpdateButtonMaxCountSpec,
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
import type { TableAddSelectOptionsSpec } from './TableAddSelectOptionsSpec';
import type { TableByBaseIdSpec } from './TableByBaseIdSpec';
import type { TableByIdSpec } from './TableByIdSpec';
import type { TableByIdsSpec } from './TableByIdsSpec';
import type { TableByNameLikeSpec } from './TableByNameLikeSpec';
import type { TableByNameSpec } from './TableByNameSpec';
import type { TableDuplicateFieldSpec } from './TableDuplicateFieldSpec';
import type { TableRemoveFieldSpec } from './TableRemoveFieldSpec';
import type { TableRenameSpec } from './TableRenameSpec';
import type { TableUpdateFieldConstraintsSpec } from './TableUpdateFieldConstraintsSpec';
import type { TableUpdateFieldDbFieldNameSpec } from './TableUpdateFieldDbFieldNameSpec';
import type { TableUpdateFieldAiConfigSpec } from './TableUpdateFieldAiConfigSpec';
import type { TableUpdateFieldDescriptionSpec } from './TableUpdateFieldDescriptionSpec';
import type { TableUpdateFieldHasErrorSpec } from './TableUpdateFieldHasErrorSpec';
import type { TableUpdateFieldNameSpec } from './TableUpdateFieldNameSpec';
import type { TableUpdateFieldTypeSpec } from './TableUpdateFieldTypeSpec';
import type { TableUpdateViewColumnMetaSpec } from './TableUpdateViewColumnMetaSpec';
import type { TableUpdateViewQueryDefaultsSpec } from './TableUpdateViewQueryDefaultsSpec';

export interface ITableSpecVisitor<TResult = unknown> extends ISpecVisitor {
  // ============ Existing specs ============
  visitTableAddField(spec: TableAddFieldSpec): Result<TResult, DomainError>;
  visitTableAddSelectOptions(spec: TableAddSelectOptionsSpec): Result<TResult, DomainError>;
  visitTableDuplicateField(spec: TableDuplicateFieldSpec): Result<TResult, DomainError>;
  visitTableRemoveField(spec: TableRemoveFieldSpec): Result<TResult, DomainError>;
  visitTableUpdateViewColumnMeta(spec: TableUpdateViewColumnMetaSpec): Result<TResult, DomainError>;
  visitTableUpdateViewQueryDefaults(
    spec: TableUpdateViewQueryDefaultsSpec
  ): Result<TResult, DomainError>;
  visitTableRename(spec: TableRenameSpec): Result<TResult, DomainError>;
  visitTableByBaseId(spec: TableByBaseIdSpec): Result<TResult, DomainError>;
  visitTableById(spec: TableByIdSpec): Result<TResult, DomainError>;
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
