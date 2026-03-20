import {
  AbstractSpecFilterVisitor,
  type ITableSpecVisitor,
  TableAddFieldSpec,
  TableAddFieldsSpec,
  TableAddSelectOptionsSpec,
  TableDuplicateFieldSpec,
  TableRemoveFieldSpec,
  TableUpdateViewColumnMetaSpec,
  TableUpdateViewQueryDefaultsSpec,
  TableRenameSpec,
  TableByBaseIdSpec,
  TableByIdSpec,
  TableByIncomingReferenceToTableSpec,
  TableByIdsSpec,
  TableByNameLikeSpec,
  TableByNameSpec,
  domainError,
  type DomainError,
  // Common field update specs
  type TableUpdateFieldNameSpec,
  type TableUpdateFieldTypeSpec,
  type TableUpdateFieldConstraintsSpec,
  type TableUpdateFieldDbFieldNameSpec,
  type TableUpdateFieldAiConfigSpec,
  type TableUpdateFieldDescriptionSpec,
  type TableUpdateFieldHasErrorSpec,
  // Field-type-specific update specs
  type UpdateSingleLineTextShowAsSpec,
  type UpdateSingleLineTextDefaultValueSpec,
  type UpdateLongTextDefaultValueSpec,
  type UpdateLongTextShowAsSpec,
  type UpdateNumberFormattingSpec,
  type UpdateNumberShowAsSpec,
  type UpdateNumberDefaultValueSpec,
  type UpdateDateFormattingSpec,
  type UpdateDateDefaultValueSpec,
  type UpdateCheckboxDefaultValueSpec,
  type UpdateRatingMaxSpec,
  type UpdateRatingIconSpec,
  type UpdateRatingColorSpec,
  type UpdateUserMultiplicitySpec,
  type UpdateUserNotificationSpec,
  type UpdateUserDefaultValueSpec,
  type UpdateButtonLabelSpec,
  type UpdateButtonColorSpec,
  type UpdateButtonMaxCountSpec,
  type UpdateButtonWorkflowSpec,
  type UpdateSingleSelectOptionsSpec,
  type UpdateSingleSelectDefaultValueSpec,
  type UpdateSingleSelectAutoNewOptionsSpec,
  type UpdateMultipleSelectOptionsSpec,
  type UpdateMultipleSelectDefaultValueSpec,
  type UpdateMultipleSelectAutoNewOptionsSpec,
  type UpdateFormulaExpressionSpec,
  type UpdateFormulaFormattingSpec,
  type UpdateFormulaShowAsSpec,
  type UpdateFormulaTimeZoneSpec,
  type UpdateLinkConfigSpec,
  type UpdateLinkRelationshipSpec,
  type UpdateLookupOptionsSpec,
  type UpdateRollupConfigSpec,
  type UpdateRollupExpressionSpec,
  type UpdateRollupFormattingSpec,
  type UpdateRollupShowAsSpec,
  type UpdateRollupTimeZoneSpec,
  type RemoveSymmetricLinkFieldSpec,
  type TableQueryState,
} from '@teable/v2-core';
import type { V1TeableDatabase } from '@teable/v2-postgres-schema';
import { sql, type Expression, type ExpressionBuilder, type SqlBool } from 'kysely';
import { err } from 'neverthrow';
import type { Result } from 'neverthrow';

export type ITableMetaWhere = (
  eb: ExpressionBuilder<V1TeableDatabase, 'table_meta'>
) => Expression<SqlBool>;

export type TableWhereSpecInfo = {
  readonly specName?: string;
  readonly tableId?: string;
  readonly incomingReferenceToTableId?: string;
  readonly baseId?: string;
  readonly tableIds?: ReadonlyArray<string>;
  readonly tableName?: string;
  readonly nameLike?: string;
};

export class TableWhereVisitor
  extends AbstractSpecFilterVisitor<ITableMetaWhere>
  implements ITableSpecVisitor<ITableMetaWhere>
{
  private specInfo: TableWhereSpecInfo = {};

  constructor(private readonly state: TableQueryState = 'active') {
    super();
    if (state === 'active') {
      this.addCond((eb) => eb.eb('deleted_time', 'is', null));
    } else if (state === 'deleted') {
      this.addCond((eb) => eb.eb('deleted_time', 'is not', null));
    }
  }

  describe(): TableWhereSpecInfo {
    return { ...this.specInfo };
  }

  private mergeSpecInfo(info: TableWhereSpecInfo) {
    this.specInfo = {
      ...this.specInfo,
      ...info,
    };
  }

  visitTableAddField(_: TableAddFieldSpec): Result<ITableMetaWhere, DomainError> {
    return err(
      domainError.validation({ message: 'TableAddFieldSpec is not supported for table filters' })
    );
  }

  visitTableAddFields(_: TableAddFieldsSpec): Result<ITableMetaWhere, DomainError> {
    return err(
      domainError.validation({ message: 'TableAddFieldsSpec is not supported for table filters' })
    );
  }

  visitTableAddSelectOptions(_: TableAddSelectOptionsSpec): Result<ITableMetaWhere, DomainError> {
    return err(
      domainError.validation({
        message: 'TableAddSelectOptionsSpec is not supported for table filters',
      })
    );
  }

  visitTableDuplicateField(_: TableDuplicateFieldSpec): Result<ITableMetaWhere, DomainError> {
    return err(
      domainError.validation({
        message: 'TableDuplicateFieldSpec is not supported for table filters',
      })
    );
  }

  visitTableRemoveField(_: TableRemoveFieldSpec): Result<ITableMetaWhere, DomainError> {
    return err(
      domainError.validation({ message: 'TableRemoveFieldSpec is not supported for table filters' })
    );
  }

  visitTableUpdateViewColumnMeta(
    _: TableUpdateViewColumnMetaSpec
  ): Result<ITableMetaWhere, DomainError> {
    return err(
      domainError.validation({
        message: 'TableUpdateViewColumnMetaSpec is not supported for table filters',
      })
    );
  }

  visitTableUpdateViewQueryDefaults(
    _: TableUpdateViewQueryDefaultsSpec
  ): Result<ITableMetaWhere, DomainError> {
    return err(
      domainError.validation({
        message: 'TableUpdateViewQueryDefaultsSpec is not supported for table filters',
      })
    );
  }

  visitTableRename(_: TableRenameSpec): Result<ITableMetaWhere, DomainError> {
    return err(
      domainError.validation({ message: 'TableRenameSpec is not supported for table filters' })
    );
  }

  visitTableByBaseId(spec: TableByBaseIdSpec): Result<ITableMetaWhere, DomainError> {
    const cond: ITableMetaWhere = (eb) => eb.eb('base_id', '=', spec.baseId().toString());
    this.mergeSpecInfo({ specName: 'TableByBaseIdSpec', baseId: spec.baseId().toString() });
    return this.addCond(cond).map(() => cond);
  }

  visitTableById(spec: TableByIdSpec): Result<ITableMetaWhere, DomainError> {
    const cond: ITableMetaWhere = (eb) => eb.eb('id', '=', spec.tableId().toString());
    this.mergeSpecInfo({ specName: 'TableByIdSpec', tableId: spec.tableId().toString() });
    return this.addCond(cond).map(() => cond);
  }

  visitTableByIncomingReferenceToTable(
    spec: TableByIncomingReferenceToTableSpec
  ): Result<ITableMetaWhere, DomainError> {
    const incomingReferenceToTableId = spec.tableId().toString();
    const targetFieldDeletedPredicate =
      this.state === 'deleted'
        ? sql`"target_field"."deleted_time" is not null`
        : sql`"target_field"."deleted_time" is null`;
    const cond: ITableMetaWhere = () => sql<boolean>`
      exists (
        select 1
        from "reference"
        inner join "field" as "source_field" on "source_field"."id" = "reference"."from_field_id"
        inner join "field" as "target_field" on "target_field"."id" = "reference"."to_field_id"
        where "source_field"."table_id" = ${incomingReferenceToTableId}
          and ${targetFieldDeletedPredicate}
          and "target_field"."table_id" = ${sql.ref('table_meta.id')}
      )
    `;
    this.mergeSpecInfo({
      specName: 'TableByIncomingReferenceToTableSpec',
      incomingReferenceToTableId,
    });
    return this.addCond(cond).map(() => cond);
  }

  visitTableByIds(spec: TableByIdsSpec): Result<ITableMetaWhere, DomainError> {
    const ids = spec.tableIds().map((id) => id.toString());
    if (ids.length === 0)
      return err(domainError.unexpected({ message: 'TableByIdsSpec requires at least one id' }));
    const cond: ITableMetaWhere = (eb) => eb.eb('id', 'in', ids);
    this.mergeSpecInfo({ specName: 'TableByIdsSpec', tableIds: ids });
    return this.addCond(cond).map(() => cond);
  }

  visitTableByName(spec: TableByNameSpec): Result<ITableMetaWhere, DomainError> {
    const cond: ITableMetaWhere = (eb) => eb.eb('name', '=', spec.tableName().toString());
    this.mergeSpecInfo({ specName: 'TableByNameSpec', tableName: spec.tableName().toString() });
    return this.addCond(cond).map(() => cond);
  }

  visitTableByNameLike(spec: TableByNameLikeSpec): Result<ITableMetaWhere, DomainError> {
    const pattern = `%${spec.tableName().toString()}%`;
    const cond: ITableMetaWhere = (eb) => eb.eb('name', 'like', pattern);
    this.mergeSpecInfo({ specName: 'TableByNameLikeSpec', nameLike: spec.tableName().toString() });
    return this.addCond(cond).map(() => cond);
  }

  // ============ Common Field Update specs ============
  // All field update specs are not supported for table filters

  visitTableUpdateFieldDbFieldName(
    _spec: TableUpdateFieldDbFieldNameSpec
  ): Result<ITableMetaWhere, DomainError> {
    return err(
      domainError.validation({
        message: 'TableUpdateFieldDbFieldNameSpec is not supported for table filters',
      })
    );
  }

  visitTableUpdateFieldName(_spec: TableUpdateFieldNameSpec): Result<ITableMetaWhere, DomainError> {
    return err(
      domainError.validation({
        message: 'TableUpdateFieldNameSpec is not supported for table filters',
      })
    );
  }

  visitTableUpdateFieldType(_spec: TableUpdateFieldTypeSpec): Result<ITableMetaWhere, DomainError> {
    return err(
      domainError.validation({
        message: 'TableUpdateFieldTypeSpec is not supported for table filters',
      })
    );
  }

  visitTableUpdateFieldConstraints(
    _spec: TableUpdateFieldConstraintsSpec
  ): Result<ITableMetaWhere, DomainError> {
    return err(
      domainError.validation({
        message: 'TableUpdateFieldConstraintsSpec is not supported for table filters',
      })
    );
  }

  visitTableUpdateFieldAiConfig(
    _spec: TableUpdateFieldAiConfigSpec
  ): Result<ITableMetaWhere, DomainError> {
    return err(
      domainError.validation({
        message: 'TableUpdateFieldAiConfigSpec is not supported for table filters',
      })
    );
  }

  visitTableUpdateFieldDescription(
    _spec: TableUpdateFieldDescriptionSpec
  ): Result<ITableMetaWhere, DomainError> {
    return err(
      domainError.validation({
        message: 'TableUpdateFieldDescriptionSpec is not supported for table filters',
      })
    );
  }

  visitTableUpdateFieldHasError(
    _spec: TableUpdateFieldHasErrorSpec
  ): Result<ITableMetaWhere, DomainError> {
    return err(
      domainError.validation({
        message: 'TableUpdateFieldHasErrorSpec is not supported for table filters',
      })
    );
  }

  // ============ SingleLineText Update specs ============

  visitUpdateSingleLineTextShowAs(
    _spec: UpdateSingleLineTextShowAsSpec
  ): Result<ITableMetaWhere, DomainError> {
    return err(
      domainError.validation({
        message: 'UpdateSingleLineTextShowAsSpec is not supported for table filters',
      })
    );
  }

  visitUpdateSingleLineTextDefaultValue(
    _spec: UpdateSingleLineTextDefaultValueSpec
  ): Result<ITableMetaWhere, DomainError> {
    return err(
      domainError.validation({
        message: 'UpdateSingleLineTextDefaultValueSpec is not supported for table filters',
      })
    );
  }

  // ============ LongText Update specs ============

  visitUpdateLongTextShowAs(_spec: UpdateLongTextShowAsSpec): Result<ITableMetaWhere, DomainError> {
    return err(
      domainError.validation({
        message: 'UpdateLongTextShowAsSpec is not supported for table filters',
      })
    );
  }

  visitUpdateLongTextDefaultValue(
    _spec: UpdateLongTextDefaultValueSpec
  ): Result<ITableMetaWhere, DomainError> {
    return err(
      domainError.validation({
        message: 'UpdateLongTextDefaultValueSpec is not supported for table filters',
      })
    );
  }

  // ============ Number Update specs ============

  visitUpdateNumberFormatting(
    _spec: UpdateNumberFormattingSpec
  ): Result<ITableMetaWhere, DomainError> {
    return err(
      domainError.validation({
        message: 'UpdateNumberFormattingSpec is not supported for table filters',
      })
    );
  }

  visitUpdateNumberShowAs(_spec: UpdateNumberShowAsSpec): Result<ITableMetaWhere, DomainError> {
    return err(
      domainError.validation({
        message: 'UpdateNumberShowAsSpec is not supported for table filters',
      })
    );
  }

  visitUpdateNumberDefaultValue(
    _spec: UpdateNumberDefaultValueSpec
  ): Result<ITableMetaWhere, DomainError> {
    return err(
      domainError.validation({
        message: 'UpdateNumberDefaultValueSpec is not supported for table filters',
      })
    );
  }

  // ============ Date Update specs ============

  visitUpdateDateFormatting(_spec: UpdateDateFormattingSpec): Result<ITableMetaWhere, DomainError> {
    return err(
      domainError.validation({
        message: 'UpdateDateFormattingSpec is not supported for table filters',
      })
    );
  }

  visitUpdateDateDefaultValue(
    _spec: UpdateDateDefaultValueSpec
  ): Result<ITableMetaWhere, DomainError> {
    return err(
      domainError.validation({
        message: 'UpdateDateDefaultValueSpec is not supported for table filters',
      })
    );
  }

  // ============ Checkbox Update specs ============

  visitUpdateCheckboxDefaultValue(
    _spec: UpdateCheckboxDefaultValueSpec
  ): Result<ITableMetaWhere, DomainError> {
    return err(
      domainError.validation({
        message: 'UpdateCheckboxDefaultValueSpec is not supported for table filters',
      })
    );
  }

  // ============ Rating Update specs ============

  visitUpdateRatingMax(_spec: UpdateRatingMaxSpec): Result<ITableMetaWhere, DomainError> {
    return err(
      domainError.validation({ message: 'UpdateRatingMaxSpec is not supported for table filters' })
    );
  }

  visitUpdateRatingIcon(_spec: UpdateRatingIconSpec): Result<ITableMetaWhere, DomainError> {
    return err(
      domainError.validation({ message: 'UpdateRatingIconSpec is not supported for table filters' })
    );
  }

  visitUpdateRatingColor(_spec: UpdateRatingColorSpec): Result<ITableMetaWhere, DomainError> {
    return err(
      domainError.validation({
        message: 'UpdateRatingColorSpec is not supported for table filters',
      })
    );
  }

  // ============ User Update specs ============

  visitUpdateUserMultiplicity(
    _spec: UpdateUserMultiplicitySpec
  ): Result<ITableMetaWhere, DomainError> {
    return err(
      domainError.validation({
        message: 'UpdateUserMultiplicitySpec is not supported for table filters',
      })
    );
  }

  visitUpdateUserNotification(
    _spec: UpdateUserNotificationSpec
  ): Result<ITableMetaWhere, DomainError> {
    return err(
      domainError.validation({
        message: 'UpdateUserNotificationSpec is not supported for table filters',
      })
    );
  }

  visitUpdateUserDefaultValue(
    _spec: UpdateUserDefaultValueSpec
  ): Result<ITableMetaWhere, DomainError> {
    return err(
      domainError.validation({
        message: 'UpdateUserDefaultValueSpec is not supported for table filters',
      })
    );
  }

  // ============ Button Update specs ============

  visitUpdateButtonLabel(_spec: UpdateButtonLabelSpec): Result<ITableMetaWhere, DomainError> {
    return err(
      domainError.validation({
        message: 'UpdateButtonLabelSpec is not supported for table filters',
      })
    );
  }

  visitUpdateButtonColor(_spec: UpdateButtonColorSpec): Result<ITableMetaWhere, DomainError> {
    return err(
      domainError.validation({
        message: 'UpdateButtonColorSpec is not supported for table filters',
      })
    );
  }

  visitUpdateButtonMaxCount(_spec: UpdateButtonMaxCountSpec): Result<ITableMetaWhere, DomainError> {
    return err(
      domainError.validation({
        message: 'UpdateButtonMaxCountSpec is not supported for table filters',
      })
    );
  }

  visitUpdateButtonWorkflow(_spec: UpdateButtonWorkflowSpec): Result<ITableMetaWhere, DomainError> {
    return err(
      domainError.validation({
        message: 'UpdateButtonWorkflowSpec is not supported for table filters',
      })
    );
  }

  // ============ SingleSelect Update specs ============

  visitUpdateSingleSelectOptions(
    _spec: UpdateSingleSelectOptionsSpec
  ): Result<ITableMetaWhere, DomainError> {
    return err(
      domainError.validation({
        message: 'UpdateSingleSelectOptionsSpec is not supported for table filters',
      })
    );
  }

  visitUpdateSingleSelectDefaultValue(
    _spec: UpdateSingleSelectDefaultValueSpec
  ): Result<ITableMetaWhere, DomainError> {
    return err(
      domainError.validation({
        message: 'UpdateSingleSelectDefaultValueSpec is not supported for table filters',
      })
    );
  }

  visitUpdateSingleSelectAutoNewOptions(
    _spec: UpdateSingleSelectAutoNewOptionsSpec
  ): Result<ITableMetaWhere, DomainError> {
    return err(
      domainError.validation({
        message: 'UpdateSingleSelectAutoNewOptionsSpec is not supported for table filters',
      })
    );
  }

  // ============ MultipleSelect Update specs ============

  visitUpdateMultipleSelectOptions(
    _spec: UpdateMultipleSelectOptionsSpec
  ): Result<ITableMetaWhere, DomainError> {
    return err(
      domainError.validation({
        message: 'UpdateMultipleSelectOptionsSpec is not supported for table filters',
      })
    );
  }

  visitUpdateMultipleSelectDefaultValue(
    _spec: UpdateMultipleSelectDefaultValueSpec
  ): Result<ITableMetaWhere, DomainError> {
    return err(
      domainError.validation({
        message: 'UpdateMultipleSelectDefaultValueSpec is not supported for table filters',
      })
    );
  }

  visitUpdateMultipleSelectAutoNewOptions(
    _spec: UpdateMultipleSelectAutoNewOptionsSpec
  ): Result<ITableMetaWhere, DomainError> {
    return err(
      domainError.validation({
        message: 'UpdateMultipleSelectAutoNewOptionsSpec is not supported for table filters',
      })
    );
  }

  // ============ Formula Update specs ============

  visitUpdateFormulaExpression(
    _spec: UpdateFormulaExpressionSpec
  ): Result<ITableMetaWhere, DomainError> {
    return err(
      domainError.validation({
        message: 'UpdateFormulaExpressionSpec is not supported for table filters',
      })
    );
  }

  visitUpdateFormulaFormatting(
    _spec: UpdateFormulaFormattingSpec
  ): Result<ITableMetaWhere, DomainError> {
    return err(
      domainError.validation({
        message: 'UpdateFormulaFormattingSpec is not supported for table filters',
      })
    );
  }

  visitUpdateFormulaShowAs(_spec: UpdateFormulaShowAsSpec): Result<ITableMetaWhere, DomainError> {
    return err(
      domainError.validation({
        message: 'UpdateFormulaShowAsSpec is not supported for table filters',
      })
    );
  }

  visitUpdateFormulaTimeZone(
    _spec: UpdateFormulaTimeZoneSpec
  ): Result<ITableMetaWhere, DomainError> {
    return err(
      domainError.validation({
        message: 'UpdateFormulaTimeZoneSpec is not supported for table filters',
      })
    );
  }

  // ============ Link Update specs ============

  visitUpdateLinkConfig(_spec: UpdateLinkConfigSpec): Result<ITableMetaWhere, DomainError> {
    return err(
      domainError.validation({ message: 'UpdateLinkConfigSpec is not supported for table filters' })
    );
  }

  visitUpdateLinkRelationship(
    _spec: UpdateLinkRelationshipSpec
  ): Result<ITableMetaWhere, DomainError> {
    return err(
      domainError.validation({
        message: 'UpdateLinkRelationshipSpec is not supported for table filters',
      })
    );
  }

  // ============ Lookup Update specs ============

  visitUpdateLookupOptions(_spec: UpdateLookupOptionsSpec): Result<ITableMetaWhere, DomainError> {
    return err(
      domainError.validation({
        message: 'UpdateLookupOptionsSpec is not supported for table filters',
      })
    );
  }

  // ============ Rollup Update specs ============

  visitUpdateRollupConfig(_spec: UpdateRollupConfigSpec): Result<ITableMetaWhere, DomainError> {
    return err(
      domainError.validation({
        message: 'UpdateRollupConfigSpec is not supported for table filters',
      })
    );
  }

  visitUpdateRollupExpression(
    _spec: UpdateRollupExpressionSpec
  ): Result<ITableMetaWhere, DomainError> {
    return err(
      domainError.validation({
        message: 'UpdateRollupExpressionSpec is not supported for table filters',
      })
    );
  }

  visitUpdateRollupFormatting(
    _spec: UpdateRollupFormattingSpec
  ): Result<ITableMetaWhere, DomainError> {
    return err(
      domainError.validation({
        message: 'UpdateRollupFormattingSpec is not supported for table filters',
      })
    );
  }

  visitUpdateRollupShowAs(_spec: UpdateRollupShowAsSpec): Result<ITableMetaWhere, DomainError> {
    return err(
      domainError.validation({
        message: 'UpdateRollupShowAsSpec is not supported for table filters',
      })
    );
  }

  visitUpdateRollupTimeZone(_spec: UpdateRollupTimeZoneSpec): Result<ITableMetaWhere, DomainError> {
    return err(
      domainError.validation({
        message: 'UpdateRollupTimeZoneSpec is not supported for table filters',
      })
    );
  }

  visitRemoveSymmetricLinkField(
    _spec: RemoveSymmetricLinkFieldSpec
  ): Result<ITableMetaWhere, DomainError> {
    return err(
      domainError.validation({
        message: 'RemoveSymmetricLinkFieldSpec is not supported for table filters',
      })
    );
  }

  clone(): this {
    return new TableWhereVisitor(this.state) as this;
  }

  and(left: ITableMetaWhere, right: ITableMetaWhere): ITableMetaWhere {
    return (eb) => eb.and([left(eb), right(eb)]);
  }

  or(left: ITableMetaWhere, right: ITableMetaWhere): ITableMetaWhere {
    return (eb) => eb.or([left(eb), right(eb)]);
  }

  not(inner: ITableMetaWhere): ITableMetaWhere {
    return (eb) => eb.not(inner(eb));
  }
}
