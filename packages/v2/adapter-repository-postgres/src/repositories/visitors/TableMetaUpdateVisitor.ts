import {
  AbstractSpecFilterVisitor,
  TableAddFieldSpec,
  TableAddSelectOptionsSpec,
  TableDuplicateFieldSpec,
  TableRemoveFieldSpec,
  TableByBaseIdSpec,
  TableByIdSpec,
  TableByIdsSpec,
  TableByNameLikeSpec,
  TableByNameSpec,
  TableRenameSpec,
  TableUpdateViewColumnMetaSpec,
  TableUpdateViewQueryDefaultsSpec,
  type TableViewQueryDefaultsUpdate,
  TableUpdateFieldNameSpec,
  TableUpdateFieldTypeSpec,
  TableUpdateFieldConstraintsSpec,
  TableUpdateFieldDbFieldNameSpec,
  TableUpdateFieldAiConfigSpec,
  TableUpdateFieldDescriptionSpec,
  TableUpdateFieldHasErrorSpec,
  type UpdateSingleLineTextShowAsSpec,
  type UpdateSingleLineTextDefaultValueSpec,
  type UpdateLongTextDefaultValueSpec,
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
  type ITableMapper,
  type ITableSpecVisitor,
  type Table,
  type FieldId,
  domainError,
  type DomainError,
} from '@teable/v2-core';
import type { V1TeableDatabase } from '@teable/v2-postgres-schema';
import type {
  DeleteQueryBuilder,
  DeleteResult,
  InsertQueryBuilder,
  InsertResult,
  Kysely,
  RawBuilder,
  UpdateQueryBuilder,
  UpdateResult,
} from 'kysely';
import { sql } from 'kysely';
import { err } from 'neverthrow';
import type { Result } from 'neverthrow';

import { TableFieldPersistenceBuilder, type TableFieldRow } from '../TableFieldPersistenceBuilder';
import type { ITableMetaWhere } from './TableWhereVisitor';

export type TableUpdateBuilder =
  | UpdateQueryBuilder<V1TeableDatabase, 'table_meta', 'table_meta', UpdateResult>
  | UpdateQueryBuilder<V1TeableDatabase, 'view', 'view', UpdateResult>
  | UpdateQueryBuilder<V1TeableDatabase, 'field', 'field', UpdateResult>
  | InsertQueryBuilder<V1TeableDatabase, 'field', InsertResult>
  | DeleteQueryBuilder<V1TeableDatabase, 'reference', DeleteResult>;

type TableMetaUpdateVisitorParams = {
  db: Kysely<V1TeableDatabase>;
  table: Table;
  tableMapper: ITableMapper;
  actorId: string;
  now: Date;
  where: ITableMetaWhere;
};

type TableMetaUpdate = {
  name?: string;
};

export class TableMetaUpdateVisitor
  extends AbstractSpecFilterVisitor<ReadonlyArray<TableUpdateBuilder>>
  implements ITableSpecVisitor<ReadonlyArray<TableUpdateBuilder>>
{
  private readonly fieldRowBuilder: TableFieldPersistenceBuilder;
  private readonly fieldVersionIncrement: RawBuilder<number> = sql<number>`coalesce(version, 0) + 1`;
  private readonly fieldVersionTouches: string[] = [];

  constructor(private readonly params: TableMetaUpdateVisitorParams) {
    super();
    this.fieldRowBuilder = new TableFieldPersistenceBuilder({
      table: params.table,
      tableMapper: params.tableMapper,
      now: params.now,
      actorId: params.actorId,
    });
  }

  fieldVersionTouchOrder(): ReadonlyArray<string> {
    return [...this.fieldVersionTouches];
  }

  visitTableByBaseId(_: TableByBaseIdSpec): Result<ReadonlyArray<TableUpdateBuilder>, DomainError> {
    return err(
      domainError.validation({ message: 'TableByBaseIdSpec is not supported for table updates' })
    );
  }

  visitTableAddField(
    spec: TableAddFieldSpec
  ): Result<ReadonlyArray<TableUpdateBuilder>, DomainError> {
    const fieldRowResult = this.fieldRowBuilder.buildRowForField(spec.field());
    if (fieldRowResult.isErr()) return err(fieldRowResult.error);

    const statements: ReadonlyArray<TableUpdateBuilder> = [
      this.buildInsertOrReviveFieldStatement(fieldRowResult.value),
    ];

    return this.addCond(statements).map(() => statements);
  }

  visitTableAddSelectOptions(
    spec: TableAddSelectOptionsSpec
  ): Result<ReadonlyArray<TableUpdateBuilder>, DomainError> {
    const fieldResult = this.params.table.getField((field) => field.id().equals(spec.fieldId()));
    if (fieldResult.isErr()) return err(fieldResult.error);
    const rowResult = this.fieldRowBuilder.buildRowForField(fieldResult.value);
    if (rowResult.isErr()) return err(rowResult.error);
    this.trackFieldVersionTouch(spec.fieldId());

    const statements: ReadonlyArray<TableUpdateBuilder> = [
      this.params.db
        .updateTable('field')
        .set({
          options: rowResult.value.options,
          version: this.fieldVersionIncrement,
          last_modified_time: this.params.now,
          last_modified_by: this.params.actorId,
        })
        .where('id', '=', spec.fieldId().toString())
        .where('table_id', '=', this.params.table.id().toString())
        .where('deleted_time', 'is', null),
    ];

    return this.addCond(statements).map(() => statements);
  }

  visitTableDuplicateField(
    spec: TableDuplicateFieldSpec
  ): Result<ReadonlyArray<TableUpdateBuilder>, DomainError> {
    // For duplicate field, we insert the new field row just like addField
    const fieldRowResult = this.fieldRowBuilder.buildRowForField(spec.newField());
    if (fieldRowResult.isErr()) return err(fieldRowResult.error);

    const statements: ReadonlyArray<TableUpdateBuilder> = [
      this.buildInsertOrReviveFieldStatement(fieldRowResult.value),
    ];

    return this.addCond(statements).map(() => statements);
  }

  visitTableRemoveField(
    spec: TableRemoveFieldSpec
  ): Result<ReadonlyArray<TableUpdateBuilder>, DomainError> {
    const fieldId = spec.field().id().toString();
    const statements: ReadonlyArray<TableUpdateBuilder> = [
      this.params.db
        .updateTable('field')
        .set({
          deleted_time: this.params.now,
          version: this.fieldVersionIncrement,
          last_modified_time: this.params.now,
          last_modified_by: this.params.actorId,
        })
        .where('id', '=', fieldId)
        .where('table_id', '=', this.params.table.id().toString())
        .where('deleted_time', 'is', null),
      this.params.db
        .deleteFrom('reference')
        .where((eb) =>
          eb.or([eb.eb('from_field_id', '=', fieldId), eb.eb('to_field_id', '=', fieldId)])
        ),
    ];

    return this.addCond(statements).map(() => statements);
  }

  visitTableUpdateViewColumnMeta(
    spec: TableUpdateViewColumnMetaSpec
  ): Result<ReadonlyArray<TableUpdateBuilder>, DomainError> {
    const updates = spec.updates();
    const statements: ReadonlyArray<TableUpdateBuilder> = updates.map((update) =>
      this.params.db
        .updateTable('view')
        .set({
          column_meta: JSON.stringify(update.columnMeta.toDto()),
          last_modified_time: this.params.now,
          last_modified_by: this.params.actorId,
        })
        .where('id', '=', update.viewId.toString())
        .where('deleted_time', 'is', null)
    );

    return this.addCond(statements).map(() => statements);
  }

  visitTableUpdateViewQueryDefaults(
    spec: TableUpdateViewQueryDefaultsSpec
  ): Result<ReadonlyArray<TableUpdateBuilder>, DomainError> {
    const statements: ReadonlyArray<TableUpdateBuilder> = spec
      .updates()
      .map((update: TableViewQueryDefaultsUpdate) => {
        const query = update.queryDefaults.toDto();
        const sortPayload =
          query.sort || query.manualSort !== undefined
            ? {
                ...(query.sort ? { sortObjs: query.sort } : {}),
                ...(query.manualSort !== undefined ? { manualSort: query.manualSort } : {}),
              }
            : null;

        return this.params.db
          .updateTable('view')
          .set({
            filter:
              query.filter === undefined
                ? null
                : this.stringifyLegacyFilter(this.mapRecordFilterToLegacy(query.filter)),
            sort: sortPayload ? JSON.stringify(sortPayload) : null,
            group: query.group ? JSON.stringify(query.group) : null,
            last_modified_time: this.params.now,
            last_modified_by: this.params.actorId,
          })
          .where('id', '=', update.viewId.toString())
          .where('deleted_time', 'is', null);
      });

    return this.addCond(statements).map(() => statements);
  }

  visitTableRename(spec: TableRenameSpec): Result<ReadonlyArray<TableUpdateBuilder>, DomainError> {
    const statements: ReadonlyArray<TableUpdateBuilder> = [
      this.buildTableMetaUpdate({ name: spec.nextName().toString() }),
    ];
    return this.addCond(statements).map(() => statements);
  }

  visitTableById(_: TableByIdSpec): Result<ReadonlyArray<TableUpdateBuilder>, DomainError> {
    return err(
      domainError.validation({ message: 'TableByIdSpec is not supported for table updates' })
    );
  }

  visitTableByIds(_: TableByIdsSpec): Result<ReadonlyArray<TableUpdateBuilder>, DomainError> {
    return err(
      domainError.validation({ message: 'TableByIdsSpec is not supported for table updates' })
    );
  }

  visitTableByName(spec: TableByNameSpec): Result<ReadonlyArray<TableUpdateBuilder>, DomainError> {
    const statements: ReadonlyArray<TableUpdateBuilder> = [
      this.buildTableMetaUpdate({ name: spec.tableName().toString() }),
    ];
    return this.addCond(statements).map(() => statements);
  }

  visitTableByNameLike(
    _: TableByNameLikeSpec
  ): Result<ReadonlyArray<TableUpdateBuilder>, DomainError> {
    return err(
      domainError.validation({ message: 'TableByNameLikeSpec is not supported for table updates' })
    );
  }

  // ============ Common Field Update Specs ============

  visitTableUpdateFieldName(
    spec: TableUpdateFieldNameSpec
  ): Result<ReadonlyArray<TableUpdateBuilder>, DomainError> {
    this.trackFieldVersionTouch(spec.fieldId());
    const statements: ReadonlyArray<TableUpdateBuilder> = [
      this.params.db
        .updateTable('field')
        .set({
          name: spec.nextName().toString(),
          version: this.fieldVersionIncrement,
          last_modified_time: this.params.now,
          last_modified_by: this.params.actorId,
        })
        .where('id', '=', spec.fieldId().toString())
        .where('table_id', '=', this.params.table.id().toString())
        .where('deleted_time', 'is', null),
    ];

    return this.addCond(statements).map(() => statements);
  }

  visitTableUpdateFieldDescription(
    spec: TableUpdateFieldDescriptionSpec
  ): Result<ReadonlyArray<TableUpdateBuilder>, DomainError> {
    this.trackFieldVersionTouch(spec.fieldId());
    const statements: ReadonlyArray<TableUpdateBuilder> = [
      this.params.db
        .updateTable('field')
        .set({
          description: spec.nextDescription(),
          version: this.fieldVersionIncrement,
          last_modified_time: this.params.now,
          last_modified_by: this.params.actorId,
        })
        .where('id', '=', spec.fieldId().toString())
        .where('table_id', '=', this.params.table.id().toString())
        .where('deleted_time', 'is', null),
    ];

    return this.addCond(statements).map(() => statements);
  }

  visitTableUpdateFieldDbFieldName(
    spec: TableUpdateFieldDbFieldNameSpec
  ): Result<ReadonlyArray<TableUpdateBuilder>, DomainError> {
    const nextDbFieldNameResult = spec.nextDbFieldName().value();
    if (nextDbFieldNameResult.isErr()) return err(nextDbFieldNameResult.error);
    this.trackFieldVersionTouch(spec.fieldId());

    const statements: ReadonlyArray<TableUpdateBuilder> = [
      this.params.db
        .updateTable('field')
        .set({
          db_field_name: nextDbFieldNameResult.value,
          version: this.fieldVersionIncrement,
          last_modified_time: this.params.now,
          last_modified_by: this.params.actorId,
        })
        .where('id', '=', spec.fieldId().toString())
        .where('table_id', '=', this.params.table.id().toString())
        .where('deleted_time', 'is', null),
    ];

    return this.addCond(statements).map(() => statements);
  }

  visitTableUpdateFieldType(
    spec: TableUpdateFieldTypeSpec
  ): Result<ReadonlyArray<TableUpdateBuilder>, DomainError> {
    // For type conversion, rebuild the field row and persist all relevant metadata columns.
    const fieldRowResult = this.fieldRowBuilder.buildRowForField(spec.newField());
    if (fieldRowResult.isErr()) return err(fieldRowResult.error);
    const row = fieldRowResult.value;
    this.trackFieldVersionTouch(spec.newField().id());

    const statements: ReadonlyArray<TableUpdateBuilder> = [
      this.params.db
        .updateTable('field')
        .set({
          name: row.name,
          description: row.description,
          type: row.type,
          options: row.options,
          meta: row.meta,
          cell_value_type: row.cell_value_type,
          is_multiple_cell_value: row.is_multiple_cell_value,
          db_field_type: row.db_field_type,
          not_null: row.not_null,
          unique: row.unique,
          is_computed: row.is_computed,
          is_lookup: row.is_lookup,
          is_conditional_lookup: row.is_conditional_lookup,
          has_error: row.has_error,
          lookup_linked_field_id: row.lookup_linked_field_id,
          lookup_options: row.lookup_options,
          version: this.fieldVersionIncrement,
          last_modified_time: this.params.now,
          last_modified_by: this.params.actorId,
        })
        .where('id', '=', spec.oldField().id().toString())
        .where('table_id', '=', this.params.table.id().toString())
        .where('deleted_time', 'is', null),
    ];

    return this.addCond(statements).map(() => statements);
  }

  visitTableUpdateFieldConstraints(
    spec: TableUpdateFieldConstraintsSpec
  ): Result<ReadonlyArray<TableUpdateBuilder>, DomainError> {
    this.trackFieldVersionTouch(spec.fieldId());
    const statements: ReadonlyArray<TableUpdateBuilder> = [
      this.params.db
        .updateTable('field')
        .set({
          not_null: spec.nextNotNull().toBoolean(),
          unique: spec.nextUnique().toBoolean(),
          version: this.fieldVersionIncrement,
          last_modified_time: this.params.now,
          last_modified_by: this.params.actorId,
        })
        .where('id', '=', spec.fieldId().toString())
        .where('table_id', '=', this.params.table.id().toString())
        .where('deleted_time', 'is', null),
    ];

    return this.addCond(statements).map(() => statements);
  }

  visitTableUpdateFieldAiConfig(
    spec: TableUpdateFieldAiConfigSpec
  ): Result<ReadonlyArray<TableUpdateBuilder>, DomainError> {
    const nextAiConfig = spec.nextAiConfig();
    const serializedAiConfig = nextAiConfig == null ? null : JSON.stringify(nextAiConfig);
    this.trackFieldVersionTouch(spec.fieldId());

    const statements: ReadonlyArray<TableUpdateBuilder> = [
      this.params.db
        .updateTable('field')
        .set({
          ai_config: serializedAiConfig,
          version: this.fieldVersionIncrement,
          last_modified_time: this.params.now,
          last_modified_by: this.params.actorId,
        })
        .where('id', '=', spec.fieldId().toString())
        .where('table_id', '=', this.params.table.id().toString())
        .where('deleted_time', 'is', null),
    ];

    return this.addCond(statements).map(() => statements);
  }

  visitTableUpdateFieldHasError(
    spec: TableUpdateFieldHasErrorSpec
  ): Result<ReadonlyArray<TableUpdateBuilder>, DomainError> {
    // Following v1 convention: true means error, null means no error
    const hasErrorValue = spec.nextHasError().isError() ? true : null;
    this.trackFieldVersionTouch(spec.fieldId());
    const statements: ReadonlyArray<TableUpdateBuilder> = [
      this.params.db
        .updateTable('field')
        .set({
          has_error: hasErrorValue,
          version: this.fieldVersionIncrement,
          last_modified_time: this.params.now,
          last_modified_by: this.params.actorId,
        })
        .where('id', '=', spec.fieldId().toString())
        .where('table_id', '=', this.params.table.id().toString())
        .where('deleted_time', 'is', null),
    ];

    return this.addCond(statements).map(() => statements);
  }

  // ============ Field-Type-Specific Update Specs ============
  // These specs update the field's options column by rebuilding the field row

  private buildFieldOptionsUpdate(
    fieldId: FieldId
  ): Result<ReadonlyArray<TableUpdateBuilder>, DomainError> {
    const fieldResult = this.params.table.getField((f) => f.id().equals(fieldId));
    if (fieldResult.isErr()) return err(fieldResult.error);

    const rowResult = this.fieldRowBuilder.buildRowForField(fieldResult.value);
    if (rowResult.isErr()) return err(rowResult.error);
    this.trackFieldVersionTouch(fieldId);

    const statements: ReadonlyArray<TableUpdateBuilder> = [
      this.params.db
        .updateTable('field')
        .set({
          options: rowResult.value.options,
          version: this.fieldVersionIncrement,
          last_modified_time: this.params.now,
          last_modified_by: this.params.actorId,
        })
        .where('id', '=', fieldId.toString())
        .where('table_id', '=', this.params.table.id().toString())
        .where('deleted_time', 'is', null),
    ];

    return this.addCond(statements).map(() => statements);
  }

  private buildFieldStorageMetadataUpdate(
    fieldId: FieldId
  ): Result<ReadonlyArray<TableUpdateBuilder>, DomainError> {
    const fieldResult = this.params.table.getField((f) => f.id().equals(fieldId));
    if (fieldResult.isErr()) return err(fieldResult.error);

    const rowResult = this.fieldRowBuilder.buildRowForField(fieldResult.value);
    if (rowResult.isErr()) return err(rowResult.error);
    const row = rowResult.value;
    this.trackFieldVersionTouch(fieldId);

    const statements: ReadonlyArray<TableUpdateBuilder> = [
      this.params.db
        .updateTable('field')
        .set({
          options: row.options,
          meta: row.meta,
          cell_value_type: row.cell_value_type,
          is_multiple_cell_value: row.is_multiple_cell_value,
          db_field_type: row.db_field_type,
          is_lookup: row.is_lookup,
          is_conditional_lookup: row.is_conditional_lookup,
          lookup_linked_field_id: row.lookup_linked_field_id,
          lookup_options: row.lookup_options,
          version: this.fieldVersionIncrement,
          last_modified_time: this.params.now,
          last_modified_by: this.params.actorId,
        })
        .where('id', '=', fieldId.toString())
        .where('table_id', '=', this.params.table.id().toString())
        .where('deleted_time', 'is', null),
    ];

    return this.addCond(statements).map(() => statements);
  }

  // SingleLineText
  visitUpdateSingleLineTextShowAs(
    spec: UpdateSingleLineTextShowAsSpec
  ): Result<ReadonlyArray<TableUpdateBuilder>, DomainError> {
    return this.buildFieldOptionsUpdate(spec.fieldId());
  }

  visitUpdateSingleLineTextDefaultValue(
    spec: UpdateSingleLineTextDefaultValueSpec
  ): Result<ReadonlyArray<TableUpdateBuilder>, DomainError> {
    return this.buildFieldOptionsUpdate(spec.fieldId());
  }

  // LongText
  visitUpdateLongTextDefaultValue(
    spec: UpdateLongTextDefaultValueSpec
  ): Result<ReadonlyArray<TableUpdateBuilder>, DomainError> {
    return this.buildFieldOptionsUpdate(spec.fieldId());
  }

  // Number
  visitUpdateNumberFormatting(
    spec: UpdateNumberFormattingSpec
  ): Result<ReadonlyArray<TableUpdateBuilder>, DomainError> {
    return this.buildFieldOptionsUpdate(spec.fieldId());
  }

  visitUpdateNumberShowAs(
    spec: UpdateNumberShowAsSpec
  ): Result<ReadonlyArray<TableUpdateBuilder>, DomainError> {
    return this.buildFieldOptionsUpdate(spec.fieldId());
  }

  visitUpdateNumberDefaultValue(
    spec: UpdateNumberDefaultValueSpec
  ): Result<ReadonlyArray<TableUpdateBuilder>, DomainError> {
    return this.buildFieldOptionsUpdate(spec.fieldId());
  }

  // Date
  visitUpdateDateFormatting(
    spec: UpdateDateFormattingSpec
  ): Result<ReadonlyArray<TableUpdateBuilder>, DomainError> {
    return this.buildFieldOptionsUpdate(spec.fieldId());
  }

  visitUpdateDateDefaultValue(
    spec: UpdateDateDefaultValueSpec
  ): Result<ReadonlyArray<TableUpdateBuilder>, DomainError> {
    return this.buildFieldOptionsUpdate(spec.fieldId());
  }

  // Checkbox
  visitUpdateCheckboxDefaultValue(
    spec: UpdateCheckboxDefaultValueSpec
  ): Result<ReadonlyArray<TableUpdateBuilder>, DomainError> {
    return this.buildFieldOptionsUpdate(spec.fieldId());
  }

  // Rating
  visitUpdateRatingMax(
    spec: UpdateRatingMaxSpec
  ): Result<ReadonlyArray<TableUpdateBuilder>, DomainError> {
    return this.buildFieldOptionsUpdate(spec.fieldId());
  }

  visitUpdateRatingIcon(
    spec: UpdateRatingIconSpec
  ): Result<ReadonlyArray<TableUpdateBuilder>, DomainError> {
    return this.buildFieldOptionsUpdate(spec.fieldId());
  }

  visitUpdateRatingColor(
    spec: UpdateRatingColorSpec
  ): Result<ReadonlyArray<TableUpdateBuilder>, DomainError> {
    return this.buildFieldOptionsUpdate(spec.fieldId());
  }

  // User
  visitUpdateUserMultiplicity(
    spec: UpdateUserMultiplicitySpec
  ): Result<ReadonlyArray<TableUpdateBuilder>, DomainError> {
    return this.buildFieldOptionsUpdate(spec.fieldId());
  }

  visitUpdateUserNotification(
    spec: UpdateUserNotificationSpec
  ): Result<ReadonlyArray<TableUpdateBuilder>, DomainError> {
    return this.buildFieldOptionsUpdate(spec.fieldId());
  }

  visitUpdateUserDefaultValue(
    spec: UpdateUserDefaultValueSpec
  ): Result<ReadonlyArray<TableUpdateBuilder>, DomainError> {
    return this.buildFieldOptionsUpdate(spec.fieldId());
  }

  // Button
  visitUpdateButtonLabel(
    spec: UpdateButtonLabelSpec
  ): Result<ReadonlyArray<TableUpdateBuilder>, DomainError> {
    return this.buildFieldOptionsUpdate(spec.fieldId());
  }

  visitUpdateButtonColor(
    spec: UpdateButtonColorSpec
  ): Result<ReadonlyArray<TableUpdateBuilder>, DomainError> {
    return this.buildFieldOptionsUpdate(spec.fieldId());
  }

  visitUpdateButtonMaxCount(
    spec: UpdateButtonMaxCountSpec
  ): Result<ReadonlyArray<TableUpdateBuilder>, DomainError> {
    return this.buildFieldOptionsUpdate(spec.fieldId());
  }

  visitUpdateButtonWorkflow(
    spec: UpdateButtonWorkflowSpec
  ): Result<ReadonlyArray<TableUpdateBuilder>, DomainError> {
    return this.buildFieldOptionsUpdate(spec.fieldId());
  }

  // SingleSelect
  visitUpdateSingleSelectOptions(
    spec: UpdateSingleSelectOptionsSpec
  ): Result<ReadonlyArray<TableUpdateBuilder>, DomainError> {
    return this.buildFieldOptionsUpdate(spec.fieldId());
  }

  visitUpdateSingleSelectDefaultValue(
    spec: UpdateSingleSelectDefaultValueSpec
  ): Result<ReadonlyArray<TableUpdateBuilder>, DomainError> {
    return this.buildFieldOptionsUpdate(spec.fieldId());
  }

  visitUpdateSingleSelectAutoNewOptions(
    spec: UpdateSingleSelectAutoNewOptionsSpec
  ): Result<ReadonlyArray<TableUpdateBuilder>, DomainError> {
    return this.buildFieldOptionsUpdate(spec.fieldId());
  }

  // MultipleSelect
  visitUpdateMultipleSelectOptions(
    spec: UpdateMultipleSelectOptionsSpec
  ): Result<ReadonlyArray<TableUpdateBuilder>, DomainError> {
    return this.buildFieldOptionsUpdate(spec.fieldId());
  }

  visitUpdateMultipleSelectDefaultValue(
    spec: UpdateMultipleSelectDefaultValueSpec
  ): Result<ReadonlyArray<TableUpdateBuilder>, DomainError> {
    return this.buildFieldOptionsUpdate(spec.fieldId());
  }

  visitUpdateMultipleSelectAutoNewOptions(
    spec: UpdateMultipleSelectAutoNewOptionsSpec
  ): Result<ReadonlyArray<TableUpdateBuilder>, DomainError> {
    return this.buildFieldOptionsUpdate(spec.fieldId());
  }

  // Formula
  visitUpdateFormulaExpression(
    spec: UpdateFormulaExpressionSpec
  ): Result<ReadonlyArray<TableUpdateBuilder>, DomainError> {
    return this.buildFieldStorageMetadataUpdate(spec.fieldId());
  }

  visitUpdateFormulaFormatting(
    spec: UpdateFormulaFormattingSpec
  ): Result<ReadonlyArray<TableUpdateBuilder>, DomainError> {
    return this.buildFieldOptionsUpdate(spec.fieldId());
  }

  visitUpdateFormulaShowAs(
    spec: UpdateFormulaShowAsSpec
  ): Result<ReadonlyArray<TableUpdateBuilder>, DomainError> {
    return this.buildFieldOptionsUpdate(spec.fieldId());
  }

  visitUpdateFormulaTimeZone(
    spec: UpdateFormulaTimeZoneSpec
  ): Result<ReadonlyArray<TableUpdateBuilder>, DomainError> {
    return this.buildFieldOptionsUpdate(spec.fieldId());
  }

  // Link
  visitUpdateLinkConfig(
    spec: UpdateLinkConfigSpec
  ): Result<ReadonlyArray<TableUpdateBuilder>, DomainError> {
    if (spec.isRelationshipChanging() || spec.isOneWayChanging()) {
      // Relationship or oneWay changes can alter meta (hasOrderColumn) and storage metadata.
      return this.buildFieldStorageMetadataUpdate(spec.fieldId());
    }
    return this.buildFieldOptionsUpdate(spec.fieldId());
  }

  visitUpdateLinkRelationship(
    spec: UpdateLinkRelationshipSpec
  ): Result<ReadonlyArray<TableUpdateBuilder>, DomainError> {
    // Relationship changes can alter multiplicity/storage metadata, not just options.
    return this.buildFieldStorageMetadataUpdate(spec.fieldId());
  }

  // Lookup
  visitUpdateLookupOptions(
    spec: UpdateLookupOptionsSpec
  ): Result<ReadonlyArray<TableUpdateBuilder>, DomainError> {
    // Use full storage metadata update so that type, options, cell_value_type,
    // is_multiple_cell_value, db_field_type, lookup_options, and lookup_linked_field_id
    // are all persisted. When the lookupFieldId changes, the inner field type changes
    // too, so a partial update of only lookup_options would leave stale metadata.
    return this.buildFieldStorageMetadataUpdate(spec.fieldId());
  }

  // Rollup
  visitUpdateRollupConfig(
    spec: UpdateRollupConfigSpec
  ): Result<ReadonlyArray<TableUpdateBuilder>, DomainError> {
    return this.buildFieldOptionsUpdate(spec.fieldId());
  }

  visitUpdateRollupExpression(
    spec: UpdateRollupExpressionSpec
  ): Result<ReadonlyArray<TableUpdateBuilder>, DomainError> {
    return this.buildFieldOptionsUpdate(spec.fieldId());
  }

  visitUpdateRollupFormatting(
    spec: UpdateRollupFormattingSpec
  ): Result<ReadonlyArray<TableUpdateBuilder>, DomainError> {
    return this.buildFieldOptionsUpdate(spec.fieldId());
  }

  visitUpdateRollupShowAs(
    spec: UpdateRollupShowAsSpec
  ): Result<ReadonlyArray<TableUpdateBuilder>, DomainError> {
    return this.buildFieldOptionsUpdate(spec.fieldId());
  }

  visitUpdateRollupTimeZone(
    spec: UpdateRollupTimeZoneSpec
  ): Result<ReadonlyArray<TableUpdateBuilder>, DomainError> {
    return this.buildFieldOptionsUpdate(spec.fieldId());
  }

  // RemoveSymmetricLinkField - same as TableRemoveField for metadata
  visitRemoveSymmetricLinkField(
    spec: RemoveSymmetricLinkFieldSpec
  ): Result<ReadonlyArray<TableUpdateBuilder>, DomainError> {
    const fieldId = spec.fieldId().toString();
    const statements: ReadonlyArray<TableUpdateBuilder> = [
      this.params.db
        .updateTable('field')
        .set({
          deleted_time: this.params.now,
          version: this.fieldVersionIncrement,
          last_modified_time: this.params.now,
          last_modified_by: this.params.actorId,
        })
        .where('id', '=', fieldId)
        .where('table_id', '=', this.params.table.id().toString())
        .where('deleted_time', 'is', null),
    ];

    return this.addCond(statements).map(() => statements);
  }

  // ============ Utility Methods ============

  clone(): this {
    return new TableMetaUpdateVisitor(this.params) as this;
  }

  and(
    left: ReadonlyArray<TableUpdateBuilder>,
    right: ReadonlyArray<TableUpdateBuilder>
  ): ReadonlyArray<TableUpdateBuilder> {
    return [...left, ...right];
  }

  or(
    left: ReadonlyArray<TableUpdateBuilder>,
    right: ReadonlyArray<TableUpdateBuilder>
  ): ReadonlyArray<TableUpdateBuilder> {
    return [...left, ...right];
  }

  not(inner: ReadonlyArray<TableUpdateBuilder>): ReadonlyArray<TableUpdateBuilder> {
    return [...inner];
  }

  private buildInsertOrReviveFieldStatement(fieldRow: TableFieldRow): TableUpdateBuilder {
    return this.params.db
      .insertInto('field')
      .values(fieldRow)
      .onConflict((oc) =>
        oc.column('id').doUpdateSet({
          name: fieldRow.name,
          description: fieldRow.description,
          options: fieldRow.options,
          meta: fieldRow.meta,
          ai_config: fieldRow.ai_config,
          type: fieldRow.type,
          cell_value_type: fieldRow.cell_value_type,
          is_multiple_cell_value: fieldRow.is_multiple_cell_value,
          db_field_type: fieldRow.db_field_type,
          db_field_name: fieldRow.db_field_name,
          not_null: fieldRow.not_null,
          unique: fieldRow.unique,
          is_primary: fieldRow.is_primary,
          is_computed: fieldRow.is_computed,
          is_lookup: fieldRow.is_lookup,
          is_conditional_lookup: fieldRow.is_conditional_lookup,
          is_pending: fieldRow.is_pending,
          has_error: fieldRow.has_error,
          lookup_linked_field_id: fieldRow.lookup_linked_field_id,
          lookup_options: fieldRow.lookup_options,
          table_id: fieldRow.table_id,
          order: fieldRow.order,
          version: sql<number>`coalesce(field.version, 0) + 1`,
          deleted_time: null,
          last_modified_time: fieldRow.last_modified_time,
          last_modified_by: fieldRow.last_modified_by,
        })
      );
  }

  private buildTableMetaUpdate(
    updates: Partial<TableMetaUpdate>
  ): UpdateQueryBuilder<V1TeableDatabase, 'table_meta', 'table_meta', UpdateResult> {
    const { db, now, actorId, where } = this.params;

    return db
      .updateTable('table_meta')
      .set({
        ...updates,
        last_modified_time: now,
        last_modified_by: actorId,
      })
      .where((eb) => where(eb));
  }

  private mapRecordFilterToLegacy(filter: unknown): unknown {
    if (filter == null || typeof filter !== 'object') {
      return filter;
    }

    const record = filter as Record<string, unknown>;

    if ('fieldId' in record && 'operator' in record) {
      return {
        fieldId: record.fieldId,
        operator: record.operator,
        value: record.value,
      };
    }

    if ('items' in record && Array.isArray(record.items)) {
      return {
        conjunction: record.conjunction,
        filterSet: record.items
          .map((item) => this.mapRecordFilterToLegacy(item))
          .filter((item) => item != null),
      };
    }

    if ('not' in record) {
      return {
        not: this.mapRecordFilterToLegacy(record.not),
      };
    }

    return record;
  }

  private stringifyLegacyFilter(filter: unknown): string | null {
    if (filter == null) {
      return null;
    }
    return JSON.stringify(filter);
  }

  private trackFieldVersionTouch(fieldId: FieldId): void {
    this.fieldVersionTouches.push(fieldId.toString());
  }
}
