import {
  AbstractSpecFilterVisitor,
  DbFieldName,
  domainError,
  FieldValueTypeVisitor,
  FormulaField,
} from '@teable/v2-core';
import type {
  TableAddFieldSpec,
  TableAddFieldsSpec,
  TableAddSelectOptionsSpec,
  TableDuplicateFieldSpec,
  TableRemoveFieldSpec,
  TableByBaseIdSpec,
  TableByIdSpec,
  TableByIncomingReferenceToTableSpec,
  TableByIdsSpec,
  TableByNameLikeSpec,
  TableByNameSpec,
  TableUpdateViewColumnMetaSpec,
  TableUpdateViewQueryDefaultsSpec,
  ITableSpecVisitor,
  DomainError,
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
  FieldId,
  Table,
  Field,
} from '@teable/v2-core';
import type { V1TeableDatabase } from '@teable/v2-postgres-schema';
import type { Kysely } from 'kysely';
import { sql } from 'kysely';
import { err, ok, safeTry } from 'neverthrow';
import type { Result } from 'neverthrow';
import { PostgresSchemaIntrospector } from '../rules/context/PostgresSchemaIntrospector';
import { createSchemaRuleContext } from '../rules/context/SchemaRuleContext';
import { createFieldSchemaRules } from '../rules/field/FieldSchemaRulesFactory';
import { ReferenceRule } from '../rules/field/ReferenceRule';
import {
  generateFieldConversionStatements,
  type FieldConversionParams,
} from './FieldTypeConversionVisitor';
import { FieldValueDuplicateVisitor } from './FieldValueDuplicateVisitor';
import type { TableSchemaStatementBuilder } from './PostgresTableSchemaFieldCreateVisitor';
import { PostgresTableSchemaFieldCreateVisitor } from './PostgresTableSchemaFieldCreateVisitor';
import { PostgresTableSchemaFieldDeleteVisitor } from './PostgresTableSchemaFieldDeleteVisitor';

type TableSchemaUpdateVisitorParams = {
  db: Kysely<V1TeableDatabase>;
  schema: string | null;
  tableName: string;
  tableId: string;
  table: Table;
};

export class TableSchemaUpdateVisitor
  extends AbstractSpecFilterVisitor<ReadonlyArray<TableSchemaStatementBuilder>>
  implements ITableSpecVisitor<ReadonlyArray<TableSchemaStatementBuilder>>
{
  constructor(private readonly params: TableSchemaUpdateVisitorParams) {
    super();
  }

  // ============ Search index (GIN trigram) helpers ============

  /**
   * Compute the GIN trigram search index name for a field.
   * Must match the v1 naming convention in IndexBuilderPostgres.getIndexName.
   */
  private static getSearchIndexName(
    tableName: string,
    fieldId: string,
    dbFieldName: string
  ): string {
    const prefix = 'idx_trgm';
    const maxLen = 63;
    const delimiterLen = 3; // three underscores between parts
    const maxTableDbNameLen = maxLen - fieldId.length - prefix.length - delimiterLen;
    const tableDbNameLen =
      maxTableDbNameLen < tableName.length ? maxTableDbNameLen : tableName.length;
    const dbFieldNameLen =
      maxTableDbNameLen < tableName.length
        ? 0
        : maxLen - fieldId.length - prefix.length - tableDbNameLen - delimiterLen;
    const abbDbFieldName = dbFieldName.slice(0, dbFieldNameLen);
    return `${prefix}_${tableName.slice(0, tableDbNameLen)}_${abbDbFieldName}_${fieldId}`;
  }

  /** Field types that should never participate in search indexing. */
  private static readonly SEARCH_INDEX_UNSUPPORTED_TYPES = new Set(['checkbox', 'button']);

  /**
   * Whether a field type supports search indexes.
   */
  private static fieldSupportsSearchIndex(fieldType: string): boolean {
    return !TableSchemaUpdateVisitor.SEARCH_INDEX_UNSUPPORTED_TYPES.has(fieldType);
  }

  /**
   * Build a DROP INDEX IF EXISTS statement for a field's search index.
   */
  private dropSearchIndexStatement(
    fieldId: string,
    dbFieldName: string
  ): TableSchemaStatementBuilder {
    const { db, schema, tableName } = this.params;
    const indexName = TableSchemaUpdateVisitor.getSearchIndexName(tableName, fieldId, dbFieldName);
    const qualifiedIndex = schema ? `"${schema}"."${indexName}"` : `"${indexName}"`;
    return {
      compile: () => sql`DROP INDEX IF EXISTS ${sql.raw(qualifiedIndex)}`.compile(db),
    };
  }

  /**
   * Build a conditional CREATE INDEX statement for a field's search index.
   * Only creates the index if any idx_trgm indexes already exist on the table
   * (i.e., the table has search indexing enabled).
   */
  private createSearchIndexStatement(
    field: Field,
    dbFieldName: string
  ): TableSchemaStatementBuilder | null {
    const fieldType = field.type().toString();
    if (!TableSchemaUpdateVisitor.fieldSupportsSearchIndex(fieldType)) {
      return null;
    }

    const valueTypeResult = field.accept(new FieldValueTypeVisitor());
    let useBtree = false;
    if (valueTypeResult.isOk()) {
      const cellValueType = valueTypeResult.value.cellValueType.toString();
      const isMultiple = valueTypeResult.value.isMultipleCellValue.isMultiple();
      if (cellValueType === 'boolean') {
        return null;
      }
      if (cellValueType === 'dateTime') {
        if (isMultiple) {
          return null;
        }
        useBtree = true;
      }
    }

    const { db, schema, tableName } = this.params;
    const fieldId = field.id().toString();
    const indexName = TableSchemaUpdateVisitor.getSearchIndexName(tableName, fieldId, dbFieldName);
    const pgSchema = schema ?? 'public';

    // Keep search index expressions text-compatible across field storage types
    // (e.g. numeric/jsonb), matching v1's text-oriented trigram indexing behavior.
    const isMultipleResult = field.isMultipleCellValue();
    const isMultiple = isMultipleResult.isOk() && isMultipleResult.value.toBoolean();
    let expression = `"${dbFieldName}"::text`;
    if (useBtree) {
      expression = `"${dbFieldName}"`;
    } else if (!isMultiple && fieldType === 'longText') {
      expression = `REPLACE(REPLACE(REPLACE("${dbFieldName}"::text, CHR(13), ' '::text), CHR(10), ' '::text), CHR(9), ' '::text)`;
    }

    // Wrap in a DO block that only executes if search indexes are enabled for this table
    const createSql = `
      DO $$
      BEGIN
        IF EXISTS (
          SELECT 1 FROM pg_indexes
          WHERE schemaname = '${pgSchema}'
            AND tablename = '${tableName}'
            AND indexname LIKE 'idx_trgm%'
        ) THEN
          EXECUTE 'CREATE INDEX IF NOT EXISTS "${indexName}" ON "${pgSchema}"."${tableName}" ${useBtree ? `USING btree (${expression.replace(/'/g, "''")})` : `USING gin ((${expression.replace(/'/g, "''")}) gin_trgm_ops)`}';
        END IF;
      END
      $$;
    `;

    return {
      compile: () => sql.raw(createSql).compile(db),
    };
  }

  private resolveDbFieldNameText(field: Field): Result<string, DomainError> {
    const dbFieldNameResult = field.dbFieldName().andThen((name) => name.value());
    if (dbFieldNameResult.isOk()) {
      return ok(dbFieldNameResult.value);
    }

    return DbFieldName.rehydrate(field.id().toString()).andThen((name) => name.value());
  }

  private resolveSpecDbFieldNameText(
    fieldId: FieldId,
    dbFieldName: DbFieldName
  ): Result<string, DomainError> {
    const specDbFieldNameResult = dbFieldName.value();
    if (specDbFieldNameResult.isOk()) {
      return ok(specDbFieldNameResult.value);
    }

    const tableFieldResult = this.params.table.getField((candidate) =>
      candidate.id().equals(fieldId)
    );
    if (tableFieldResult.isErr()) {
      return err(tableFieldResult.error);
    }

    return this.resolveDbFieldNameText(tableFieldResult.value);
  }

  /**
   * Build a conditional ALTER INDEX RENAME statement for a field's search index.
   * Only executes if the old index exists.
   */
  private renameSearchIndexStatement(
    fieldId: string,
    oldDbFieldName: string,
    newDbFieldName: string
  ): TableSchemaStatementBuilder {
    const { db, schema, tableName } = this.params;
    const oldIndexName = TableSchemaUpdateVisitor.getSearchIndexName(
      tableName,
      fieldId,
      oldDbFieldName
    );
    const newIndexName = TableSchemaUpdateVisitor.getSearchIndexName(
      tableName,
      fieldId,
      newDbFieldName
    );
    const pgSchema = schema ?? 'public';
    return {
      compile: () =>
        sql`ALTER INDEX IF EXISTS ${sql.raw(`"${pgSchema}"."${oldIndexName}"`)} RENAME TO ${sql.raw(`"${newIndexName}"`)}`.compile(
          db
        ),
    };
  }

  /**
   * Regenerate reference table entries for a field whose config changed
   * without a type conversion. Deletes old references and inserts new ones.
   */
  private regenerateFieldReferences(
    oldField: Field,
    newField: Field
  ): Result<ReadonlyArray<TableSchemaStatementBuilder>, DomainError> {
    return safeTry<ReadonlyArray<TableSchemaStatementBuilder>, DomainError>(
      function* (this: TableSchemaUpdateVisitor) {
        const rulesContext = {
          schema: this.params.schema,
          tableName: this.params.tableName,
          tableId: this.params.tableId,
        };
        const ctx = createSchemaRuleContext({
          db: this.params.db,
          introspector: new PostgresSchemaIntrospector(this.params.db),
          schema: rulesContext.schema,
          tableName: rulesContext.tableName,
          tableId: rulesContext.tableId,
          field: newField,
        });

        const statements: TableSchemaStatementBuilder[] = [];

        // Delete old references for this field
        const oldRules = yield* createFieldSchemaRules(oldField, rulesContext);
        for (const rule of oldRules) {
          if (rule instanceof ReferenceRule) {
            const downResult = rule.down(ctx);
            if (downResult.isOk()) {
              statements.push(...downResult.value);
            }
          }
        }

        // Insert new references based on updated field config
        const newRules = yield* createFieldSchemaRules(newField, rulesContext);
        for (const rule of newRules) {
          if (rule instanceof ReferenceRule) {
            const upResult = rule.up(ctx);
            if (upResult.isOk()) {
              statements.push(...upResult.value);
            }
          }
        }

        return ok(statements);
      }.bind(this)
    );
  }

  private buildFormulaFieldWithExpression(
    sourceField: FormulaField,
    expression: ReturnType<UpdateFormulaExpressionSpec['nextExpression']>
  ): Result<FormulaField, DomainError> {
    const valueTypeVisitor = new FieldValueTypeVisitor();
    const fieldValueTypes = this.params.table
      .getFields()
      .filter((candidate) => !candidate.id().equals(sourceField.id()))
      .flatMap((candidate) => {
        const valueTypeResult = candidate.accept(valueTypeVisitor);
        if (valueTypeResult.isErr()) return [];
        return [{ id: candidate.id(), valueType: valueTypeResult.value }];
      });

    const inferredResultType = expression.getParsedValueType(fieldValueTypes);
    const tryBuild = (clearStyle: boolean) =>
      FormulaField.create({
        id: sourceField.id(),
        name: sourceField.name(),
        expression,
        timeZone: sourceField.timeZone(),
        formatting: clearStyle ? undefined : sourceField.formatting(),
        showAs: clearStyle ? undefined : sourceField.showAs(),
        meta: sourceField.meta(),
        resultType: inferredResultType.isOk() ? inferredResultType.value : undefined,
        dependencies: sourceField.dependencies(),
      });

    let nextFieldResult = tryBuild(false);
    if (nextFieldResult.isErr()) {
      nextFieldResult = tryBuild(true);
      if (nextFieldResult.isErr()) return err(nextFieldResult.error);
    }

    const dbFieldNameResult = sourceField.dbFieldName();
    if (dbFieldNameResult.isOk()) {
      const setDbFieldNameResult = nextFieldResult.value.setDbFieldName(dbFieldNameResult.value);
      if (setDbFieldNameResult.isErr()) return err(setDbFieldNameResult.error);
    }

    return ok(nextFieldResult.value);
  }

  private buildFormulaConversionStatements(
    spec: UpdateFormulaExpressionSpec
  ): Result<ReadonlyArray<TableSchemaStatementBuilder>, DomainError> {
    const fieldResult = this.params.table.getField((field) => field.id().equals(spec.fieldId()));
    if (fieldResult.isErr()) return err(fieldResult.error);
    const field = fieldResult.value;
    if (!(field instanceof FormulaField)) {
      return ok([]);
    }

    const previousFieldResult = this.buildFormulaFieldWithExpression(
      field,
      spec.previousExpression()
    );
    if (previousFieldResult.isErr()) return err(previousFieldResult.error);
    const nextFieldResult = this.buildFormulaFieldWithExpression(field, spec.nextExpression());
    if (nextFieldResult.isErr()) return err(nextFieldResult.error);

    const dbFieldNameResult = this.resolveDbFieldNameText(field);
    if (dbFieldNameResult.isErr()) return err(dbFieldNameResult.error);

    return generateFieldConversionStatements(
      {
        db: this.params.db,
        schema: this.params.schema,
        tableName: this.params.tableName,
        tableId: this.params.tableId,
        dbFieldName: dbFieldNameResult.value,
        fieldId: field.id().toString(),
      },
      previousFieldResult.value,
      nextFieldResult.value
    );
  }

  visitTableRename(
    _spec: TableRenameSpec
  ): Result<readonly TableSchemaStatementBuilder[], DomainError> {
    const statements: ReadonlyArray<TableSchemaStatementBuilder> = [];
    return this.addCond(statements).map(() => statements);
  }

  visitTableAddField(
    spec: TableAddFieldSpec
  ): Result<ReadonlyArray<TableSchemaStatementBuilder>, DomainError> {
    const visitor = this;
    const fieldVisitor = PostgresTableSchemaFieldCreateVisitor.forSchemaUpdate(this.params);
    const addCond = this.addCond.bind(this);
    return safeTry<ReadonlyArray<TableSchemaStatementBuilder>, DomainError>(function* () {
      const statements = [...(yield* spec.field().accept(fieldVisitor))];
      const dbFieldName = yield* visitor.resolveDbFieldNameText(spec.field());
      const createSearchIdx = visitor.createSearchIndexStatement(spec.field(), dbFieldName);
      if (createSearchIdx) {
        statements.push(createSearchIdx);
      }
      yield* addCond(statements);
      return ok(statements);
    });
  }

  visitTableAddFields(
    spec: TableAddFieldsSpec
  ): Result<ReadonlyArray<TableSchemaStatementBuilder>, DomainError> {
    const visitor = this;
    const fieldVisitor = PostgresTableSchemaFieldCreateVisitor.forSchemaUpdate(this.params);
    const addCond = this.addCond.bind(this);
    return safeTry<ReadonlyArray<TableSchemaStatementBuilder>, DomainError>(function* () {
      const statements: TableSchemaStatementBuilder[] = [];
      for (const field of spec.fields()) {
        statements.push(...(yield* field.accept(fieldVisitor)));
        const dbFieldName = yield* visitor.resolveDbFieldNameText(field);
        const createSearchIdx = visitor.createSearchIndexStatement(field, dbFieldName);
        if (createSearchIdx) {
          statements.push(createSearchIdx);
        }
      }
      yield* addCond(statements);
      return ok(statements);
    });
  }

  visitTableRemoveField(
    spec: TableRemoveFieldSpec
  ): Result<ReadonlyArray<TableSchemaStatementBuilder>, DomainError> {
    const fieldVisitor = PostgresTableSchemaFieldDeleteVisitor.forSchemaUpdate(this.params);
    const addCond = this.addCond.bind(this);
    return safeTry<ReadonlyArray<TableSchemaStatementBuilder>, DomainError>(function* () {
      const statements = yield* spec.field().accept(fieldVisitor);
      yield* addCond(statements);
      return ok(statements);
    });
  }

  visitTableUpdateViewColumnMeta(
    _: TableUpdateViewColumnMetaSpec
  ): Result<ReadonlyArray<TableSchemaStatementBuilder>, DomainError> {
    const statements: ReadonlyArray<TableSchemaStatementBuilder> = [];
    return this.addCond(statements).map(() => statements);
  }

  visitTableUpdateViewQueryDefaults(
    _: TableUpdateViewQueryDefaultsSpec
  ): Result<ReadonlyArray<TableSchemaStatementBuilder>, DomainError> {
    const statements: ReadonlyArray<TableSchemaStatementBuilder> = [];
    return this.addCond(statements).map(() => statements);
  }

  visitTableAddSelectOptions(
    _spec: TableAddSelectOptionsSpec
  ): Result<ReadonlyArray<TableSchemaStatementBuilder>, DomainError> {
    const statements: ReadonlyArray<TableSchemaStatementBuilder> = [];
    return this.addCond(statements).map(() => statements);
  }

  visitTableDuplicateField(
    spec: TableDuplicateFieldSpec
  ): Result<ReadonlyArray<TableSchemaStatementBuilder>, DomainError> {
    const visitor = this;
    const fieldVisitor = PostgresTableSchemaFieldCreateVisitor.forSchemaUpdate(this.params);
    const addCond = this.addCond.bind(this);

    return safeTry<ReadonlyArray<TableSchemaStatementBuilder>, DomainError>(function* () {
      // 1. Create the new column schema (like addField)
      const schemaStatements = yield* spec.newField().accept(fieldVisitor);

      // 2. If includeRecordValues, add value duplication statements
      if (spec.includeRecordValues()) {
        const sourceField = spec.sourceField();
        const newField = spec.newField();

        const sourceDbFieldName = yield* visitor.resolveDbFieldNameText(sourceField);
        const targetDbFieldName = yield* visitor.resolveDbFieldNameText(newField);

        const valueVisitor = FieldValueDuplicateVisitor.create(visitor.params.db, {
          schema: visitor.params.schema,
          tableName: visitor.params.tableName,
          sourceDbFieldName,
          targetDbFieldName,
          newField,
        });
        const valueStatements = yield* sourceField.accept(valueVisitor);
        const valueDuplicationStatements = valueStatements.map((query) => ({
          compile: () => query,
        }));

        const allStatements = [...schemaStatements, ...valueDuplicationStatements];
        yield* addCond(allStatements);
        return ok(allStatements);
      }

      yield* addCond(schemaStatements);
      return ok(schemaStatements);
    });
  }

  visitTableByBaseId(
    _: TableByBaseIdSpec
  ): Result<ReadonlyArray<TableSchemaStatementBuilder>, DomainError> {
    return err(
      domainError.validation({
        message: 'TableByBaseIdSpec is not supported for table schema updates',
      })
    );
  }

  visitTableById(
    _: TableByIdSpec
  ): Result<ReadonlyArray<TableSchemaStatementBuilder>, DomainError> {
    return err(
      domainError.validation({ message: 'TableByIdSpec is not supported for table schema updates' })
    );
  }

  visitTableByIncomingReferenceToTable(
    _: TableByIncomingReferenceToTableSpec
  ): Result<ReadonlyArray<TableSchemaStatementBuilder>, DomainError> {
    return err(
      domainError.validation({
        message: 'TableByIncomingReferenceToTableSpec is not supported for table schema updates',
      })
    );
  }

  visitTableByIds(
    _: TableByIdsSpec
  ): Result<ReadonlyArray<TableSchemaStatementBuilder>, DomainError> {
    return err(
      domainError.validation({
        message: 'TableByIdsSpec is not supported for table schema updates',
      })
    );
  }

  visitTableByName(
    _: TableByNameSpec
  ): Result<ReadonlyArray<TableSchemaStatementBuilder>, DomainError> {
    const statements: ReadonlyArray<TableSchemaStatementBuilder> = [];
    return this.addCond(statements).map(() => statements);
  }

  visitTableByNameLike(
    _: TableByNameLikeSpec
  ): Result<ReadonlyArray<TableSchemaStatementBuilder>, DomainError> {
    return err(
      domainError.validation({
        message: 'TableByNameLikeSpec is not supported for table schema updates',
      })
    );
  }

  // ============ Common Field Update specs ============
  // These don't change the database schema, only metadata

  visitTableUpdateFieldName(
    _spec: TableUpdateFieldNameSpec
  ): Result<ReadonlyArray<TableSchemaStatementBuilder>, DomainError> {
    // Field name changes don't affect schema - db_field_name stays the same
    const statements: ReadonlyArray<TableSchemaStatementBuilder> = [];
    return this.addCond(statements).map(() => statements);
  }

  visitTableUpdateFieldDbFieldName(
    spec: TableUpdateFieldDbFieldNameSpec
  ): Result<ReadonlyArray<TableSchemaStatementBuilder>, DomainError> {
    const { db, schema, tableName } = this.params;
    const addCond = this.addCond.bind(this);
    const visitor = this;

    return safeTry<ReadonlyArray<TableSchemaStatementBuilder>, DomainError>(function* () {
      const previousName = yield* spec.previousDbFieldName().value();
      const nextName = yield* spec.nextDbFieldName().value();
      const fullTableName = schema ? `"${schema}"."${tableName}"` : `"${tableName}"`;
      const fieldId = spec.fieldId().toString();

      const statements: TableSchemaStatementBuilder[] = [
        {
          compile: () =>
            sql`ALTER TABLE ${sql.raw(fullTableName)} RENAME COLUMN ${sql.ref(previousName)} TO ${sql.ref(nextName)}`.compile(
              db
            ),
        },
        // Rename the search index to match the new db field name
        visitor.renameSearchIndexStatement(fieldId, previousName, nextName),
      ];

      yield* addCond(statements);
      return ok(statements);
    });
  }

  visitTableUpdateFieldType(
    spec: TableUpdateFieldTypeSpec
  ): Result<ReadonlyArray<TableSchemaStatementBuilder>, DomainError> {
    const visitor = this;
    const addCond = this.addCond.bind(this);

    return safeTry<ReadonlyArray<TableSchemaStatementBuilder>, DomainError>(function* () {
      if (!spec.isTypeConversion()) {
        // Even without a type conversion, references may have changed
        // (e.g., ConditionalRollup filter/config changed). Regenerate reference entries.
        const statements = yield* visitor.regenerateFieldReferences(
          spec.oldField(),
          spec.newField()
        );
        yield* addCond(statements);
        return ok(statements);
      }

      const oldField = spec.oldField();
      const newField = spec.newField();

      // Get the db field name from the old field
      const dbFieldNameResult = visitor.resolveDbFieldNameText(oldField);
      if (dbFieldNameResult.isErr()) {
        return err(dbFieldNameResult.error);
      }
      const dbFieldName = dbFieldNameResult.value;

      // Generate conversion statements
      const conversionParams: FieldConversionParams = {
        db: visitor.params.db,
        schema: visitor.params.schema,
        tableName: visitor.params.tableName,
        tableId: visitor.params.tableId,
        dbFieldName,
        fieldId: newField.id().toString(),
      };

      const conversionStatements = yield* generateFieldConversionStatements(
        conversionParams,
        oldField,
        newField
      );

      // Regenerate reference entries so the reference table reflects the new
      // field type's dependencies (e.g., ConditionalRollup filter field refs).
      const referenceStatements = yield* visitor.regenerateFieldReferences(oldField, newField);

      // Search index management: drop old index before conversion, create new after
      const fieldId = newField.id().toString();
      const dropSearchIdx = visitor.dropSearchIndexStatement(fieldId, dbFieldName);
      const createSearchIdx = visitor.createSearchIndexStatement(newField, dbFieldName);

      const statements = [
        dropSearchIdx,
        ...conversionStatements,
        ...referenceStatements,
        ...(createSearchIdx ? [createSearchIdx] : []),
      ];
      yield* addCond(statements);
      return ok(statements);
    });
  }

  visitTableUpdateFieldConstraints(
    spec: TableUpdateFieldConstraintsSpec
  ): Result<ReadonlyArray<TableSchemaStatementBuilder>, DomainError> {
    const visitor = this;
    const { db, schema, tableName } = this.params;
    const addCond = this.addCond.bind(this);

    return safeTry<ReadonlyArray<TableSchemaStatementBuilder>, DomainError>(function* () {
      const dbFieldName = yield* visitor.resolveSpecDbFieldNameText(
        spec.fieldId(),
        spec.dbFieldName()
      );
      const statements: TableSchemaStatementBuilder[] = [];

      // Build schema-qualified table name
      const fullTableName = schema ? `"${schema}"."${tableName}"` : `"${tableName}"`;

      // Handle NOT NULL constraint changes
      if (spec.isNotNullChanging()) {
        if (spec.nextNotNull().toBoolean()) {
          // Add NOT NULL constraint
          statements.push({
            compile: () =>
              sql`ALTER TABLE ${sql.raw(fullTableName)} ALTER COLUMN ${sql.ref(dbFieldName)} SET NOT NULL`.compile(
                db
              ),
          });
        } else {
          // Remove NOT NULL constraint
          statements.push({
            compile: () =>
              sql`ALTER TABLE ${sql.raw(fullTableName)} ALTER COLUMN ${sql.ref(dbFieldName)} DROP NOT NULL`.compile(
                db
              ),
          });
        }
      }

      // Handle UNIQUE constraint changes
      if (spec.isUniqueChanging()) {
        // Generate constraint name based on table and column
        const constraintName = `${tableName}_${dbFieldName}_unique`;

        if (spec.nextUnique().toBoolean()) {
          // Add UNIQUE constraint
          statements.push({
            compile: () =>
              sql`ALTER TABLE ${sql.raw(fullTableName)} ADD CONSTRAINT ${sql.ref(constraintName)} UNIQUE (${sql.ref(dbFieldName)})`.compile(
                db
              ),
          });
        } else {
          // Remove UNIQUE constraint
          statements.push({
            compile: () =>
              sql`ALTER TABLE ${sql.raw(fullTableName)} DROP CONSTRAINT IF EXISTS ${sql.ref(constraintName)}`.compile(
                db
              ),
          });
        }
      }

      yield* addCond(statements);
      return ok(statements);
    });
  }

  visitTableUpdateFieldHasError(
    spec: TableUpdateFieldHasErrorSpec
  ): Result<ReadonlyArray<TableSchemaStatementBuilder>, DomainError> {
    const visitor = this;
    const addCond = this.addCond.bind(this);
    return safeTry<ReadonlyArray<TableSchemaStatementBuilder>, DomainError>(function* () {
      const statements: TableSchemaStatementBuilder[] = [];
      const field = yield* visitor.params.table.getField((candidate) =>
        candidate.id().equals(spec.fieldId())
      );
      const ctx = createSchemaRuleContext({
        db: visitor.params.db,
        introspector: new PostgresSchemaIntrospector(visitor.params.db),
        schema: visitor.params.schema,
        tableName: visitor.params.tableName,
        tableId: visitor.params.tableId,
        field,
      });
      const rules = yield* createFieldSchemaRules(field, {
        schema: visitor.params.schema,
        tableName: visitor.params.tableName,
        tableId: visitor.params.tableId,
      });

      for (const rule of rules) {
        if (!(rule instanceof ReferenceRule)) {
          continue;
        }
        const downResult = rule.down(ctx);
        if (downResult.isOk()) {
          statements.push(...downResult.value);
        }
      }

      if (spec.isSettingError()) {
        const dbFieldName = yield* visitor.resolveDbFieldNameText(field);
        const fullTableName = visitor.params.schema
          ? `"${visitor.params.schema}"."${visitor.params.tableName}"`
          : `"${visitor.params.tableName}"`;
        // Keep errored computed fields aligned with query behavior (undefined/null)
        // by clearing any stale persisted values.
        statements.push({
          compile: () =>
            sql`UPDATE ${sql.raw(fullTableName)} SET ${sql.ref(dbFieldName)} = NULL`.compile(
              visitor.params.db
            ),
        });
      } else {
        for (const rule of rules) {
          if (!(rule instanceof ReferenceRule)) {
            continue;
          }
          const upResult = rule.up(ctx);
          if (upResult.isOk()) {
            statements.push(...upResult.value);
          }
        }
      }
      yield* addCond(statements);
      return ok(statements);
    });
  }

  visitTableUpdateFieldAiConfig(
    _spec: TableUpdateFieldAiConfigSpec
  ): Result<ReadonlyArray<TableSchemaStatementBuilder>, DomainError> {
    const statements: ReadonlyArray<TableSchemaStatementBuilder> = [];
    return this.addCond(statements).map(() => statements);
  }

  visitTableUpdateFieldDescription(
    _spec: TableUpdateFieldDescriptionSpec
  ): Result<ReadonlyArray<TableSchemaStatementBuilder>, DomainError> {
    const statements: ReadonlyArray<TableSchemaStatementBuilder> = [];
    return this.addCond(statements).map(() => statements);
  }

  // ============ SingleLineText Update specs ============

  visitUpdateSingleLineTextShowAs(
    _spec: UpdateSingleLineTextShowAsSpec
  ): Result<ReadonlyArray<TableSchemaStatementBuilder>, DomainError> {
    const statements: ReadonlyArray<TableSchemaStatementBuilder> = [];
    return this.addCond(statements).map(() => statements);
  }

  visitUpdateSingleLineTextDefaultValue(
    _spec: UpdateSingleLineTextDefaultValueSpec
  ): Result<ReadonlyArray<TableSchemaStatementBuilder>, DomainError> {
    const statements: ReadonlyArray<TableSchemaStatementBuilder> = [];
    return this.addCond(statements).map(() => statements);
  }

  // ============ LongText Update specs ============

  visitUpdateLongTextShowAs(
    _spec: UpdateLongTextShowAsSpec
  ): Result<ReadonlyArray<TableSchemaStatementBuilder>, DomainError> {
    const statements: ReadonlyArray<TableSchemaStatementBuilder> = [];
    return this.addCond(statements).map(() => statements);
  }

  visitUpdateLongTextDefaultValue(
    _spec: UpdateLongTextDefaultValueSpec
  ): Result<ReadonlyArray<TableSchemaStatementBuilder>, DomainError> {
    const statements: ReadonlyArray<TableSchemaStatementBuilder> = [];
    return this.addCond(statements).map(() => statements);
  }

  // ============ Number Update specs ============

  visitUpdateNumberFormatting(
    _spec: UpdateNumberFormattingSpec
  ): Result<ReadonlyArray<TableSchemaStatementBuilder>, DomainError> {
    const statements: ReadonlyArray<TableSchemaStatementBuilder> = [];
    return this.addCond(statements).map(() => statements);
  }

  visitUpdateNumberShowAs(
    _spec: UpdateNumberShowAsSpec
  ): Result<ReadonlyArray<TableSchemaStatementBuilder>, DomainError> {
    const statements: ReadonlyArray<TableSchemaStatementBuilder> = [];
    return this.addCond(statements).map(() => statements);
  }

  visitUpdateNumberDefaultValue(
    _spec: UpdateNumberDefaultValueSpec
  ): Result<ReadonlyArray<TableSchemaStatementBuilder>, DomainError> {
    const statements: ReadonlyArray<TableSchemaStatementBuilder> = [];
    return this.addCond(statements).map(() => statements);
  }

  // ============ Date Update specs ============

  visitUpdateDateFormatting(
    _spec: UpdateDateFormattingSpec
  ): Result<ReadonlyArray<TableSchemaStatementBuilder>, DomainError> {
    const statements: ReadonlyArray<TableSchemaStatementBuilder> = [];
    return this.addCond(statements).map(() => statements);
  }

  visitUpdateDateDefaultValue(
    _spec: UpdateDateDefaultValueSpec
  ): Result<ReadonlyArray<TableSchemaStatementBuilder>, DomainError> {
    const statements: ReadonlyArray<TableSchemaStatementBuilder> = [];
    return this.addCond(statements).map(() => statements);
  }

  // ============ Checkbox Update specs ============

  visitUpdateCheckboxDefaultValue(
    _spec: UpdateCheckboxDefaultValueSpec
  ): Result<ReadonlyArray<TableSchemaStatementBuilder>, DomainError> {
    const statements: ReadonlyArray<TableSchemaStatementBuilder> = [];
    return this.addCond(statements).map(() => statements);
  }

  // ============ Rating Update specs ============

  visitUpdateRatingMax(
    spec: UpdateRatingMaxSpec
  ): Result<ReadonlyArray<TableSchemaStatementBuilder>, DomainError> {
    // Only clamp values if max is being reduced
    if (!spec.isMaxReducing()) {
      const statements: ReadonlyArray<TableSchemaStatementBuilder> = [];
      return this.addCond(statements).map(() => statements);
    }

    const visitor = this;
    const { db, schema, tableName } = this.params;
    const addCond = this.addCond.bind(this);

    return safeTry<ReadonlyArray<TableSchemaStatementBuilder>, DomainError>(function* () {
      const dbFieldName = yield* visitor.resolveSpecDbFieldNameText(
        spec.fieldId(),
        spec.dbFieldName()
      );
      const newMax = spec.nextMax().toNumber();

      // Build schema-qualified table name
      const fullTableName = schema ? `"${schema}"."${tableName}"` : `"${tableName}"`;

      // Clamp values: UPDATE records SET col = newMax WHERE col > newMax
      const statements: TableSchemaStatementBuilder[] = [
        {
          compile: () =>
            sql`UPDATE ${sql.raw(fullTableName)} SET ${sql.ref(dbFieldName)} = ${newMax} WHERE ${sql.ref(dbFieldName)} > ${newMax}`.compile(
              db
            ),
        },
      ];

      yield* addCond(statements);
      return ok(statements);
    });
  }

  visitUpdateRatingIcon(
    _spec: UpdateRatingIconSpec
  ): Result<ReadonlyArray<TableSchemaStatementBuilder>, DomainError> {
    const statements: ReadonlyArray<TableSchemaStatementBuilder> = [];
    return this.addCond(statements).map(() => statements);
  }

  visitUpdateRatingColor(
    _spec: UpdateRatingColorSpec
  ): Result<ReadonlyArray<TableSchemaStatementBuilder>, DomainError> {
    const statements: ReadonlyArray<TableSchemaStatementBuilder> = [];
    return this.addCond(statements).map(() => statements);
  }

  // ============ User Update specs ============

  visitUpdateUserMultiplicity(
    spec: UpdateUserMultiplicitySpec
  ): Result<ReadonlyArray<TableSchemaStatementBuilder>, DomainError> {
    // Only process if multiplicity is actually changing
    if (!spec.isMultipleToSingle() && !spec.isSingleToMultiple()) {
      const statements: ReadonlyArray<TableSchemaStatementBuilder> = [];
      return this.addCond(statements).map(() => statements);
    }

    const visitor = this;
    const { db, schema, tableName } = this.params;
    const addCond = this.addCond.bind(this);

    return safeTry<ReadonlyArray<TableSchemaStatementBuilder>, DomainError>(function* () {
      const dbFieldName = yield* visitor.resolveSpecDbFieldNameText(
        spec.fieldId(),
        spec.dbFieldName()
      );
      const statements: TableSchemaStatementBuilder[] = [];

      // Build schema-qualified table name
      const fullTableName = schema ? `"${schema}"."${tableName}"` : `"${tableName}"`;

      if (spec.isMultipleToSingle()) {
        // Array → Single: Extract first element from jsonb array
        // User field stores as jsonb, so we extract the first element
        statements.push({
          compile: () =>
            sql`UPDATE ${sql.raw(fullTableName)} SET ${sql.ref(dbFieldName)} = (${sql.ref(dbFieldName)}->0) WHERE ${sql.ref(dbFieldName)} IS NOT NULL AND jsonb_array_length(${sql.ref(dbFieldName)}) > 0`.compile(
              db
            ),
        });
      } else if (spec.isSingleToMultiple()) {
        // Single → Array: Wrap in jsonb array
        statements.push({
          compile: () =>
            sql`UPDATE ${sql.raw(fullTableName)} SET ${sql.ref(dbFieldName)} = jsonb_build_array(${sql.ref(dbFieldName)}) WHERE ${sql.ref(dbFieldName)} IS NOT NULL`.compile(
              db
            ),
        });
      }

      yield* addCond(statements);
      return ok(statements);
    });
  }

  visitUpdateUserNotification(
    _spec: UpdateUserNotificationSpec
  ): Result<ReadonlyArray<TableSchemaStatementBuilder>, DomainError> {
    const statements: ReadonlyArray<TableSchemaStatementBuilder> = [];
    return this.addCond(statements).map(() => statements);
  }

  visitUpdateUserDefaultValue(
    _spec: UpdateUserDefaultValueSpec
  ): Result<ReadonlyArray<TableSchemaStatementBuilder>, DomainError> {
    const statements: ReadonlyArray<TableSchemaStatementBuilder> = [];
    return this.addCond(statements).map(() => statements);
  }

  // ============ Button Update specs ============

  visitUpdateButtonLabel(
    _spec: UpdateButtonLabelSpec
  ): Result<ReadonlyArray<TableSchemaStatementBuilder>, DomainError> {
    const statements: ReadonlyArray<TableSchemaStatementBuilder> = [];
    return this.addCond(statements).map(() => statements);
  }

  visitUpdateButtonColor(
    _spec: UpdateButtonColorSpec
  ): Result<ReadonlyArray<TableSchemaStatementBuilder>, DomainError> {
    const statements: ReadonlyArray<TableSchemaStatementBuilder> = [];
    return this.addCond(statements).map(() => statements);
  }

  visitUpdateButtonMaxCount(
    _spec: UpdateButtonMaxCountSpec
  ): Result<ReadonlyArray<TableSchemaStatementBuilder>, DomainError> {
    const statements: ReadonlyArray<TableSchemaStatementBuilder> = [];
    return this.addCond(statements).map(() => statements);
  }

  visitUpdateButtonWorkflow(
    spec: UpdateButtonWorkflowSpec
  ): Result<ReadonlyArray<TableSchemaStatementBuilder>, DomainError> {
    const visitor = this;
    const addCond = this.addCond.bind(this);

    return safeTry<ReadonlyArray<TableSchemaStatementBuilder>, DomainError>(function* () {
      const statements: TableSchemaStatementBuilder[] = [];

      // When the workflow changes, clear all existing button cell values
      // to prevent stale workflow execution data from persisting.
      const field = yield* visitor.params.table.getField((candidate) =>
        candidate.id().equals(spec.fieldId())
      );
      const dbFieldName = yield* visitor.resolveDbFieldNameText(field);
      const fullTableName = visitor.params.schema
        ? `"${visitor.params.schema}"."${visitor.params.tableName}"`
        : `"${visitor.params.tableName}"`;

      statements.push({
        compile: () =>
          sql`UPDATE ${sql.raw(fullTableName)} SET ${sql.ref(dbFieldName)} = NULL WHERE ${sql.ref(dbFieldName)} IS NOT NULL`.compile(
            visitor.params.db
          ),
      });

      yield* addCond(statements);
      return ok(statements);
    });
  }

  // ============ SingleSelect Update specs ============

  visitUpdateSingleSelectOptions(
    spec: UpdateSingleSelectOptionsSpec
  ): Result<ReadonlyArray<TableSchemaStatementBuilder>, DomainError> {
    const visitor = this;
    const { db, schema, tableName } = this.params;
    const addCond = this.addCond.bind(this);

    return safeTry<ReadonlyArray<TableSchemaStatementBuilder>, DomainError>(function* () {
      const dbFieldName = yield* visitor.resolveSpecDbFieldNameText(
        spec.fieldId(),
        spec.dbFieldName()
      );
      const statements: TableSchemaStatementBuilder[] = [];

      // Build schema-qualified table name
      const fullTableName = schema ? `"${schema}"."${tableName}"` : `"${tableName}"`;

      // Handle renamed options: UPDATE records SET col = 'new_name' WHERE col = 'old_name'
      for (const { previous, next } of spec.renamedOptions()) {
        const oldName = previous.name().toString();
        const newName = next.name().toString();
        statements.push({
          compile: () =>
            sql`UPDATE ${sql.raw(fullTableName)} SET ${sql.ref(dbFieldName)} = ${newName} WHERE ${sql.ref(dbFieldName)} = ${oldName}`.compile(
              db
            ),
        });
      }

      // Handle removed options: UPDATE records SET col = NULL WHERE col = 'deleted_name'
      for (const removed of spec.removedOptions()) {
        const deletedName = removed.name().toString();
        statements.push({
          compile: () =>
            sql`UPDATE ${sql.raw(fullTableName)} SET ${sql.ref(dbFieldName)} = NULL WHERE ${sql.ref(dbFieldName)} = ${deletedName}`.compile(
              db
            ),
        });
      }

      yield* addCond(statements);
      return ok(statements);
    });
  }

  visitUpdateSingleSelectDefaultValue(
    _spec: UpdateSingleSelectDefaultValueSpec
  ): Result<ReadonlyArray<TableSchemaStatementBuilder>, DomainError> {
    const statements: ReadonlyArray<TableSchemaStatementBuilder> = [];
    return this.addCond(statements).map(() => statements);
  }

  visitUpdateSingleSelectAutoNewOptions(
    _spec: UpdateSingleSelectAutoNewOptionsSpec
  ): Result<ReadonlyArray<TableSchemaStatementBuilder>, DomainError> {
    const statements: ReadonlyArray<TableSchemaStatementBuilder> = [];
    return this.addCond(statements).map(() => statements);
  }

  // ============ MultipleSelect Update specs ============

  visitUpdateMultipleSelectOptions(
    spec: UpdateMultipleSelectOptionsSpec
  ): Result<ReadonlyArray<TableSchemaStatementBuilder>, DomainError> {
    const visitor = this;
    const { db, schema, tableName } = this.params;
    const addCond = this.addCond.bind(this);

    return safeTry<ReadonlyArray<TableSchemaStatementBuilder>, DomainError>(function* () {
      const dbFieldName = yield* visitor.resolveSpecDbFieldNameText(
        spec.fieldId(),
        spec.dbFieldName()
      );
      const statements: TableSchemaStatementBuilder[] = [];

      // Build schema-qualified table name
      const fullTableName = schema ? `"${schema}"."${tableName}"` : `"${tableName}"`;

      // Handle renamed options: replace JSONB array values
      for (const { previous, next } of spec.renamedOptions()) {
        const oldName = previous.name().toString();
        const newName = next.name().toString();
        statements.push({
          compile: () =>
            sql`
              UPDATE ${sql.raw(fullTableName)}
              SET ${sql.ref(dbFieldName)} = (
                SELECT jsonb_agg(CASE WHEN value = ${oldName} THEN ${newName} ELSE value END)
                FROM jsonb_array_elements_text(${sql.ref(dbFieldName)}) AS value
              )
              WHERE jsonb_typeof(${sql.ref(dbFieldName)}) = 'array'
                AND ${sql.ref(dbFieldName)} ? ${oldName}
            `.compile(db),
        });
      }

      // Handle removed options: filter JSONB array values
      for (const removed of spec.removedOptions()) {
        const deletedName = removed.name().toString();
        statements.push({
          compile: () =>
            sql`
              UPDATE ${sql.raw(fullTableName)}
              SET ${sql.ref(dbFieldName)} = (
                  SELECT jsonb_agg(value)
                  FROM jsonb_array_elements_text(${sql.ref(dbFieldName)}) AS value
                  WHERE value <> ${deletedName}
                )
              WHERE jsonb_typeof(${sql.ref(dbFieldName)}) = 'array'
                AND ${sql.ref(dbFieldName)} ? ${deletedName}
            `.compile(db),
        });
      }

      yield* addCond(statements);
      return ok(statements);
    });
  }

  visitUpdateMultipleSelectDefaultValue(
    _spec: UpdateMultipleSelectDefaultValueSpec
  ): Result<ReadonlyArray<TableSchemaStatementBuilder>, DomainError> {
    const statements: ReadonlyArray<TableSchemaStatementBuilder> = [];
    return this.addCond(statements).map(() => statements);
  }

  visitUpdateMultipleSelectAutoNewOptions(
    _spec: UpdateMultipleSelectAutoNewOptionsSpec
  ): Result<ReadonlyArray<TableSchemaStatementBuilder>, DomainError> {
    const statements: ReadonlyArray<TableSchemaStatementBuilder> = [];
    return this.addCond(statements).map(() => statements);
  }

  // ============ Formula Update specs ============

  visitUpdateFormulaExpression(
    spec: UpdateFormulaExpressionSpec
  ): Result<ReadonlyArray<TableSchemaStatementBuilder>, DomainError> {
    const visitor = this;
    const addCond = this.addCond.bind(this);
    return safeTry<ReadonlyArray<TableSchemaStatementBuilder>, DomainError>(function* () {
      const statements = yield* visitor.buildFormulaConversionStatements(spec);
      yield* addCond(statements);
      return ok(statements);
    });
  }

  visitUpdateFormulaFormatting(
    _spec: UpdateFormulaFormattingSpec
  ): Result<ReadonlyArray<TableSchemaStatementBuilder>, DomainError> {
    const statements: ReadonlyArray<TableSchemaStatementBuilder> = [];
    return this.addCond(statements).map(() => statements);
  }

  visitUpdateFormulaShowAs(
    _spec: UpdateFormulaShowAsSpec
  ): Result<ReadonlyArray<TableSchemaStatementBuilder>, DomainError> {
    const statements: ReadonlyArray<TableSchemaStatementBuilder> = [];
    return this.addCond(statements).map(() => statements);
  }

  visitUpdateFormulaTimeZone(
    _spec: UpdateFormulaTimeZoneSpec
  ): Result<ReadonlyArray<TableSchemaStatementBuilder>, DomainError> {
    const statements: ReadonlyArray<TableSchemaStatementBuilder> = [];
    return this.addCond(statements).map(() => statements);
  }

  // ============ Link Update specs ============

  visitUpdateLinkConfig(
    _spec: UpdateLinkConfigSpec
  ): Result<ReadonlyArray<TableSchemaStatementBuilder>, DomainError> {
    // Link config changes (relationship type, oneWay↔twoWay) may require junction table updates
    // Deferred to link relationship implementation phase - currently only metadata is updated
    const statements: ReadonlyArray<TableSchemaStatementBuilder> = [];
    return this.addCond(statements).map(() => statements);
  }

  visitUpdateLinkRelationship(
    spec: UpdateLinkRelationshipSpec
  ): Result<ReadonlyArray<TableSchemaStatementBuilder>, DomainError> {
    const { db } = this.params;
    const addCond = this.addCond.bind(this);
    const fullHostTableName = this.params.schema
      ? `"${this.params.schema}"."${this.params.tableName}"`
      : `"${this.params.tableName}"`;
    const dbFieldNameResult = this.resolveSpecDbFieldNameText(spec.fieldId(), spec.dbFieldName());
    if (dbFieldNameResult.isErr()) {
      return err(dbFieldNameResult.error);
    }
    const dbFieldName = dbFieldNameResult.value;
    const previousIsMultiple = spec.previousRelationship().isMultipleValue();
    const nextIsMultiple = spec.nextRelationship().isMultipleValue();

    const buildLinkValueShapeRewriteStatements = (): TableSchemaStatementBuilder[] => {
      if (previousIsMultiple === nextIsMultiple) {
        return [];
      }

      if (nextIsMultiple) {
        return [
          {
            compile: () =>
              sql`UPDATE ${sql.raw(fullHostTableName)}
                  SET ${sql.ref(dbFieldName)} = CASE
                    WHEN ${sql.ref(dbFieldName)} IS NULL THEN NULL
                    WHEN jsonb_typeof(${sql.ref(dbFieldName)}::jsonb) = 'array'
                      THEN ${sql.ref(dbFieldName)}::jsonb
                    ELSE jsonb_build_array(${sql.ref(dbFieldName)}::jsonb)
                  END`.compile(db),
          },
        ];
      }

      return [
        {
          compile: () =>
            sql`UPDATE ${sql.raw(fullHostTableName)}
                SET ${sql.ref(dbFieldName)} = CASE
                  WHEN ${sql.ref(dbFieldName)} IS NULL THEN NULL
                  WHEN jsonb_typeof(${sql.ref(dbFieldName)}::jsonb) = 'array' THEN
                    CASE
                      WHEN jsonb_array_length(${sql.ref(dbFieldName)}::jsonb) > 0
                        THEN (${sql.ref(dbFieldName)}::jsonb -> 0)
                      ELSE NULL
                    END
                  ELSE ${sql.ref(dbFieldName)}::jsonb
                END`.compile(db),
        },
      ];
    };

    // Helper to build fully-qualified table name from fkHostTableName (which is "baseId.tableName")
    const quoteIdentifier = (name: string): string => `"${name.replaceAll('"', '""')}"`;
    const quoteTableName = (name: string): string => {
      if (!name.includes('.')) return quoteIdentifier(name);
      const [s, t] = name.split('.');
      return `${quoteIdentifier(s)}.${quoteIdentifier(t)}`;
    };
    const quoteColumn = (name: string): string => quoteIdentifier(name);
    const currentTableDbName = this.params.schema
      ? `${this.params.schema}.${this.params.tableName}`
      : this.params.tableName;
    const normalizeCurrentTableHostName = (rawName: string): string => {
      if (rawName.includes('.')) {
        const [schemaPart, tablePart] = rawName.split('.');
        const sameSchema = (schemaPart || null) === (this.params.schema || null);
        if (sameSchema && tablePart === this.params.tableId) {
          return currentTableDbName;
        }
        return rawName;
      }
      if (!this.params.schema && rawName === this.params.tableId) {
        return currentTableDbName;
      }
      return rawName;
    };
    const quoteIndexNameForTable = (tableName: string, indexName: string): string => {
      const normalizedTableName = normalizeCurrentTableHostName(tableName);
      if (!normalizedTableName.includes('.')) {
        return quoteIdentifier(indexName);
      }

      const [schemaName] = normalizedTableName.split('.');
      return `${quoteIdentifier(schemaName)}.${quoteIdentifier(indexName)}`;
    };
    const buildFkIndexExclusivityStatements = (params: {
      fkHostTableName: string;
      fkColumnName: string;
      previousRelationship: string;
      nextRelationship: string;
    }): TableSchemaStatementBuilder[] => {
      const previousUnique = params.previousRelationship === 'oneOne';
      const nextUnique = params.nextRelationship === 'oneOne';
      if (previousUnique === nextUnique) {
        return [];
      }

      const normalizedHostTableName = normalizeCurrentTableHostName(params.fkHostTableName);
      const fullHostTableName = quoteTableName(normalizedHostTableName);
      const indexName = `index_${params.fkColumnName}`;
      const fullIndexName = quoteIndexNameForTable(normalizedHostTableName, indexName);
      const createIndexName = quoteIdentifier(indexName);
      const indexKind = nextUnique ? 'UNIQUE ' : '';

      return [
        {
          compile: () =>
            sql
              .raw(
                `ALTER TABLE ${fullHostTableName} DROP CONSTRAINT IF EXISTS ${quoteIdentifier(indexName)}`
              )
              .compile(db),
        },
        {
          compile: () => sql`DROP INDEX IF EXISTS ${sql.raw(fullIndexName)}`.compile(db),
        },
        {
          compile: () =>
            sql
              .raw(
                `CREATE ${indexKind}INDEX IF NOT EXISTS ${createIndexName} ON ${fullHostTableName} (${quoteColumn(params.fkColumnName)})`
              )
              .compile(db),
        },
      ];
    };

    // For oneWay conversions that don't change storage type
    // (both manyMany and oneMany oneWay use junction table, or both manyOne and oneOne use FK):
    // handle junction layout changes (e.g., adding/removing __order column).
    if (
      spec.previousIsOneWay() &&
      spec.nextIsOneWay() &&
      !spec.isJunctionToFkConversion() &&
      !spec.isFkToJunctionConversion()
    ) {
      // Check if junction __order column needs to change.
      // ManyMany junction has __order; OneMany OneWay junction does not.
      const prevRel = spec.previousRelationship().toString();
      const nextRel = spec.nextRelationship().toString();
      const prevHasOrder = prevRel === 'manyMany';
      const nextHasOrder = nextRel === 'manyMany';

      if (prevHasOrder !== nextHasOrder) {
        return safeTry<ReadonlyArray<TableSchemaStatementBuilder>, DomainError>(function* () {
          const previousConfig = spec.previousConfig();
          const oldFkHostTableName = yield* previousConfig.fkHostTableNameString();
          const fullJunctionTableName = quoteTableName(oldFkHostTableName);

          const statements: TableSchemaStatementBuilder[] = [];
          if (nextHasOrder && !prevHasOrder) {
            // Add __order column to junction table
            statements.push({
              compile: () =>
                sql`ALTER TABLE ${sql.raw(fullJunctionTableName)} ADD COLUMN IF NOT EXISTS "__order" double precision`.compile(
                  db
                ),
            });
          } else if (prevHasOrder && !nextHasOrder) {
            // Drop __order column from junction table
            statements.push({
              compile: () =>
                sql`ALTER TABLE ${sql.raw(fullJunctionTableName)} DROP COLUMN IF EXISTS "__order"`.compile(
                  db
                ),
            });
          }
          statements.push(...buildLinkValueShapeRewriteStatements());
          yield* addCond(statements);
          return ok(statements);
        });
      }

      // No junction layout changes needed
      const statements: ReadonlyArray<TableSchemaStatementBuilder> = [];
      return this.addCond(statements).map(() => statements);
    }

    // TwoWay FK host-switch conversion (manyOne/oneOne ↔ oneMany twoWay).
    // Both sides use FK storage, but the FK host table moves between host/foreign tables.
    if (
      spec.isRelationshipTypeChanging() &&
      !spec.previousIsOneWay() &&
      !spec.nextIsOneWay() &&
      !spec.isJunctionToFkConversion() &&
      !spec.isFkToJunctionConversion()
    ) {
      return safeTry<ReadonlyArray<TableSchemaStatementBuilder>, DomainError>(function* () {
        const previousConfig = spec.previousConfig();
        const nextConfig = spec.computedNextConfig() ?? spec.nextConfig();
        if (!previousConfig.hasDbConfig() || !nextConfig.hasDbConfig()) {
          const statements: ReadonlyArray<TableSchemaStatementBuilder> = [];
          yield* addCond(statements);
          return ok(statements);
        }

        const oldFkHostTableName = normalizeCurrentTableHostName(
          yield* previousConfig.fkHostTableNameString()
        );
        const newFkHostTableName = normalizeCurrentTableHostName(
          yield* nextConfig.fkHostTableNameString()
        );

        const oldSelfKeyName = yield* previousConfig.selfKeyNameString();
        const oldForeignKeyName = yield* previousConfig.foreignKeyNameString();
        const oldFkColumnName = oldSelfKeyName === '__id' ? oldForeignKeyName : oldSelfKeyName;
        const oldOrderColumnName = `${oldFkColumnName}_order`;

        const newSelfKeyName = yield* nextConfig.selfKeyNameString();
        const newForeignKeyName = yield* nextConfig.foreignKeyNameString();
        const newFkColumnName = newSelfKeyName === '__id' ? newForeignKeyName : newSelfKeyName;
        const newOrderColumnName = `${newFkColumnName}_order`;

        // No FK host movement; only value shape rewrite may be needed.
        if (oldFkHostTableName === newFkHostTableName) {
          const statements = [
            ...(oldFkColumnName === newFkColumnName
              ? buildFkIndexExclusivityStatements({
                  fkHostTableName: oldFkHostTableName,
                  fkColumnName: oldFkColumnName,
                  previousRelationship: spec.previousRelationship().toString(),
                  nextRelationship: spec.nextRelationship().toString(),
                })
              : []),
            ...buildLinkValueShapeRewriteStatements(),
          ];
          yield* addCond(statements);
          return ok(statements);
        }

        const fullOldHostTableName = quoteTableName(oldFkHostTableName);
        const fullNewHostTableName = quoteTableName(newFkHostTableName);

        const statements: TableSchemaStatementBuilder[] = [];

        // 1. Create FK columns on the new host table.
        statements.push({
          compile: () =>
            sql`ALTER TABLE ${sql.raw(fullNewHostTableName)} ADD COLUMN IF NOT EXISTS ${sql.ref(newFkColumnName)} text`.compile(
              db
            ),
        });
        statements.push({
          compile: () =>
            sql`ALTER TABLE ${sql.raw(fullNewHostTableName)} ADD COLUMN IF NOT EXISTS ${sql.ref(newOrderColumnName)} double precision`.compile(
              db
            ),
        });

        // 2. Move relationships from old host FK to new host FK.
        statements.push({
          compile: () =>
            sql`UPDATE ${sql.raw(fullNewHostTableName)} AS n
                SET ${sql.ref(newFkColumnName)} = (
                  SELECT o."__id"
                  FROM ${sql.raw(fullOldHostTableName)} AS o
                  WHERE o.${sql.ref(oldFkColumnName)} = n."__id"
                  ORDER BY o.${sql.ref(oldOrderColumnName)} NULLS LAST, o."__auto_number" NULLS LAST, o."__id"
                  LIMIT 1
                )
                WHERE EXISTS (
                  SELECT 1
                  FROM ${sql.raw(fullOldHostTableName)} AS o
                  WHERE o.${sql.ref(oldFkColumnName)} = n."__id"
                )`.compile(db),
        });

        // 3. Drop old FK columns from the old host table.
        statements.push({
          compile: () =>
            sql`ALTER TABLE ${sql.raw(fullOldHostTableName)} DROP COLUMN IF EXISTS ${sql.ref(oldFkColumnName)}`.compile(
              db
            ),
        });
        statements.push({
          compile: () =>
            sql`ALTER TABLE ${sql.raw(fullOldHostTableName)} DROP COLUMN IF EXISTS ${sql.ref(oldOrderColumnName)}`.compile(
              db
            ),
        });

        statements.push(...buildLinkValueShapeRewriteStatements());

        yield* addCond(statements);
        return ok(statements);
      });
    }

    // Junction → FK conversion (manyMany/oneMany oneWay → manyOne/oneOne or oneMany twoWay)
    if (spec.isJunctionToFkConversion()) {
      return safeTry<ReadonlyArray<TableSchemaStatementBuilder>, DomainError>(function* () {
        const previousConfig = spec.previousConfig();
        const nextConfig = spec.computedNextConfig() ?? spec.nextConfig();
        if (!nextConfig.hasDbConfig()) {
          // No computed config available, skip
          const statements: ReadonlyArray<TableSchemaStatementBuilder> = [];
          yield* addCond(statements);
          return ok(statements);
        }

        // Old storage: junction table
        const oldFkHostTableName = yield* previousConfig.fkHostTableNameString();
        const oldSelfKeyName = yield* previousConfig.selfKeyNameString();
        const oldForeignKeyName = yield* previousConfig.foreignKeyNameString();
        // OneMany OneWay junction tables don't have __order column;
        // ManyMany junction tables do.
        const prevRel = spec.previousRelationship().toString();
        const junctionHasOrder = prevRel === 'manyMany';

        // New storage: FK column on FK host table
        const newFkHostTableName = yield* nextConfig.fkHostTableNameString();
        const normalizedNewFkHostTableName = normalizeCurrentTableHostName(newFkHostTableName);
        const newSelfKeyName = yield* nextConfig.selfKeyNameString();
        const newForeignKeyName = yield* nextConfig.foreignKeyNameString();
        const newFkColumnName = newSelfKeyName === '__id' ? newForeignKeyName : newSelfKeyName;
        const newOrderColumnName = `${newFkColumnName}_order`;

        const fullJunctionTableName = quoteTableName(oldFkHostTableName);
        const fullFkHostTableName = quoteTableName(normalizedNewFkHostTableName);
        const isFkHostCurrentTable = normalizedNewFkHostTableName === currentTableDbName;
        const hostRowIdKey = isFkHostCurrentTable ? oldSelfKeyName : oldForeignKeyName;
        const targetFkValueKey = isFkHostCurrentTable ? oldForeignKeyName : oldSelfKeyName;

        const statements: TableSchemaStatementBuilder[] = [];

        // 1. Add FK column to FK host table
        statements.push({
          compile: () =>
            sql`ALTER TABLE ${sql.raw(fullFkHostTableName)} ADD COLUMN IF NOT EXISTS ${sql.ref(newFkColumnName)} text`.compile(
              db
            ),
        });

        // 2. Add order column to FK host table
        statements.push({
          compile: () =>
            sql`ALTER TABLE ${sql.raw(fullFkHostTableName)} ADD COLUMN IF NOT EXISTS ${sql.ref(newOrderColumnName)} double precision`.compile(
              db
            ),
        });

        // 3. Migrate data from junction table to FK column
        // Use __order for ordering only if the junction table has it (manyMany).
        // OneMany OneWay junction tables don't have __order column.
        const orderByClause = junctionHasOrder
          ? `ORDER BY j."__order", j."__id"`
          : `ORDER BY j."__id"`;
        statements.push({
          compile: () =>
            sql`UPDATE ${sql.raw(fullFkHostTableName)} AS h
                SET ${sql.ref(newFkColumnName)} = (
                  SELECT j.${sql.ref(targetFkValueKey)}
                  FROM ${sql.raw(fullJunctionTableName)} AS j
                  WHERE j.${sql.ref(hostRowIdKey)} = h."__id"
                  ${sql.raw(orderByClause)}
                  LIMIT 1
                )
                WHERE EXISTS (
                  SELECT 1
                  FROM ${sql.raw(fullJunctionTableName)} AS j
                  WHERE j.${sql.ref(hostRowIdKey)} = h."__id"
                )`.compile(db),
        });

        // 4. Drop junction table
        statements.push({
          compile: () =>
            sql`DROP TABLE IF EXISTS ${sql.raw(fullJunctionTableName)} CASCADE`.compile(db),
        });

        const symmetricFieldId = nextConfig.symmetricFieldId();
        if (symmetricFieldId) {
          const nextRelationship = spec.nextRelationship().toString();
          const symmetricIsMultiple = nextRelationship === 'manyOne';
          const escapedSymmetricFieldId = symmetricFieldId.toString().replace(/'/g, "''");
          const escapedForeignTableId = nextConfig.foreignTableId().toString().replace(/'/g, "''");
          const escapedFkColumnName = newFkColumnName.replace(/'/g, "''");

          const trimSymmetricSql = `
DO $v2_link_trim$
DECLARE
  sym_col text;
  foreign_tbl text;
  foreign_schema text;
  foreign_name text;
BEGIN
  IF to_regclass('public.field') IS NULL OR to_regclass('public.table_meta') IS NULL THEN
    RETURN;
  END IF;

  SELECT db_field_name INTO sym_col
  FROM field
  WHERE id = '${escapedSymmetricFieldId}' AND deleted_time IS NULL
  LIMIT 1;

  SELECT db_table_name INTO foreign_tbl
  FROM table_meta
  WHERE id = '${escapedForeignTableId}' AND deleted_time IS NULL
  LIMIT 1;

  IF sym_col IS NULL OR foreign_tbl IS NULL THEN
    RETURN;
  END IF;

  IF strpos(foreign_tbl, '.') > 0 THEN
    foreign_schema := split_part(foreign_tbl, '.', 1);
    foreign_name := split_part(foreign_tbl, '.', 2);
  ELSE
    foreign_schema := 'public';
    foreign_name := foreign_tbl;
  END IF;

  IF ${symmetricIsMultiple ? 'TRUE' : 'FALSE'} THEN
    EXECUTE format(
      'UPDATE %I.%I AS f
       SET %I = (
         SELECT CASE
           WHEN filtered.value IS NULL OR jsonb_array_length(filtered.value) = 0 THEN NULL
           ELSE filtered.value
         END
         FROM (
           SELECT jsonb_agg(elem) AS value
           FROM jsonb_array_elements(
             CASE
               WHEN f.%I IS NULL THEN ''[]''::jsonb
               WHEN jsonb_typeof(f.%I::jsonb) = ''array'' THEN f.%I::jsonb
               ELSE jsonb_build_array(f.%I::jsonb)
             END
           ) AS elem
           WHERE EXISTS (
             SELECT 1
             FROM ${fullFkHostTableName} AS h
             WHERE h.%I = f.__id
               AND h.__id = elem->>''id''
           )
         ) AS filtered
       )',
      foreign_schema,
      foreign_name,
      sym_col,
      sym_col,
      sym_col,
      sym_col,
      sym_col,
      '${escapedFkColumnName}'
    );
  ELSE
    EXECUTE format(
      'UPDATE %I.%I AS f
       SET %I = (
         SELECT filtered.elem
         FROM (
           SELECT elem
           FROM jsonb_array_elements(
             CASE
               WHEN f.%I IS NULL THEN ''[]''::jsonb
               WHEN jsonb_typeof(f.%I::jsonb) = ''array'' THEN f.%I::jsonb
               ELSE jsonb_build_array(f.%I::jsonb)
             END
           ) AS elem
           WHERE EXISTS (
             SELECT 1
             FROM ${fullFkHostTableName} AS h
             WHERE h.%I = f.__id
               AND h.__id = elem->>''id''
           )
           LIMIT 1
         ) AS filtered
       )',
      foreign_schema,
      foreign_name,
      sym_col,
      sym_col,
      sym_col,
      sym_col,
      sym_col,
      '${escapedFkColumnName}'
    );
  END IF;
END
$v2_link_trim$;`;

          statements.push({
            compile: () => sql.raw(trimSymmetricSql).compile(db),
          });
        }

        statements.push(...buildLinkValueShapeRewriteStatements());

        yield* addCond(statements);
        return ok(statements);
      });
    }

    // FK → junction conversion (manyOne/oneOne/oneMany twoWay → manyMany or oneMany oneWay)
    if (spec.isFkToJunctionConversion()) {
      return safeTry<ReadonlyArray<TableSchemaStatementBuilder>, DomainError>(function* () {
        const previousConfig = spec.previousConfig();
        const nextConfig = spec.computedNextConfig() ?? spec.nextConfig();
        if (!nextConfig.hasDbConfig()) {
          const statements: ReadonlyArray<TableSchemaStatementBuilder> = [];
          yield* addCond(statements);
          return ok(statements);
        }

        // Old storage: FK column on one table (host differs by relationship):
        // - oneMany: FK is on foreign table
        // - manyOne/oneOne: FK is on current table
        const oldFkHostTableName = yield* previousConfig.fkHostTableNameString();
        const normalizedOldFkHostTableName = normalizeCurrentTableHostName(oldFkHostTableName);
        const oldSelfKeyName = yield* previousConfig.selfKeyNameString();
        const oldForeignKeyName = yield* previousConfig.foreignKeyNameString();
        const oldFkColumnName = oldSelfKeyName === '__id' ? oldForeignKeyName : oldSelfKeyName;
        const oldOrderColumnName = `${oldFkColumnName}_order`;
        const previousRelationship = spec.previousRelationship().toString();
        const isFkOnCurrentTable =
          previousRelationship === 'manyOne' || previousRelationship === 'oneOne';

        // New storage: junction table
        const newFkHostTableName = yield* nextConfig.fkHostTableNameString();
        const newSelfKeyName = yield* nextConfig.selfKeyNameString();
        const newForeignKeyName = yield* nextConfig.foreignKeyNameString();
        // ManyMany junction tables have __order; OneMany OneWay junction tables do not.
        const nextRel = spec.nextRelationship().toString();
        const junctionNeedsOrder = nextRel === 'manyMany';

        const fullForeignTableName = quoteTableName(normalizedOldFkHostTableName);
        const fullJunctionTableName = quoteTableName(newFkHostTableName);
        const linkJsonIdExpr = `CASE
              WHEN ${quoteColumn(dbFieldName)} IS NULL THEN NULL
              WHEN jsonb_typeof(${quoteColumn(dbFieldName)}::jsonb) = 'array' THEN (${quoteColumn(dbFieldName)}::jsonb -> 0 ->> 'id')
              ELSE (${quoteColumn(dbFieldName)}::jsonb ->> 'id')
            END`;
        const sourceLinkedIdExpr = isFkOnCurrentTable
          ? `COALESCE(${quoteColumn(oldFkColumnName)}, ${linkJsonIdExpr})`
          : quoteColumn(oldFkColumnName);
        const junctionSelfSourceExpr = isFkOnCurrentTable ? `"__id"` : quoteColumn(oldFkColumnName);
        const junctionForeignSourceExpr = isFkOnCurrentTable ? sourceLinkedIdExpr : `"__id"`;

        const statements: TableSchemaStatementBuilder[] = [];

        // 1. Create junction table, with or without __order column depending on target relationship
        if (junctionNeedsOrder) {
          statements.push({
            compile: () =>
              sql`CREATE TABLE IF NOT EXISTS ${sql.raw(fullJunctionTableName)} ("__id" serial PRIMARY KEY, ${sql.ref(newSelfKeyName)} text, ${sql.ref(newForeignKeyName)} text, "__order" double precision)`.compile(
                db
              ),
          });
        } else {
          statements.push({
            compile: () =>
              sql`CREATE TABLE IF NOT EXISTS ${sql.raw(fullJunctionTableName)} ("__id" serial PRIMARY KEY, ${sql.ref(newSelfKeyName)} text, ${sql.ref(newForeignKeyName)} text)`.compile(
                db
              ),
          });
        }

        // 2. Migrate data from FK column to junction table
        statements.push({
          compile: () =>
            sql`INSERT INTO ${sql.raw(fullJunctionTableName)} (${sql.ref(newSelfKeyName)}, ${sql.ref(newForeignKeyName)}) SELECT ${sql.raw(junctionSelfSourceExpr)}, ${sql.raw(junctionForeignSourceExpr)} FROM ${sql.raw(fullForeignTableName)} WHERE ${sql.raw(sourceLinkedIdExpr)} IS NOT NULL`.compile(
              db
            ),
        });

        // 3. Drop FK column from foreign table
        statements.push({
          compile: () =>
            sql`ALTER TABLE ${sql.raw(fullForeignTableName)} DROP COLUMN IF EXISTS ${sql.ref(oldFkColumnName)}`.compile(
              db
            ),
        });

        // 4. Drop order column from foreign table
        statements.push({
          compile: () =>
            sql`ALTER TABLE ${sql.raw(fullForeignTableName)} DROP COLUMN IF EXISTS ${sql.ref(oldOrderColumnName)}`.compile(
              db
            ),
        });

        statements.push(...buildLinkValueShapeRewriteStatements());

        yield* addCond(statements);
        return ok(statements);
      });
    }

    // Junction-to-junction migration when oneWay flag changes
    // (e.g., ManyMany OneWay → ManyMany TwoWay).
    // Both use junction storage but the junction table name and key names change
    // because oneWay uses a generated symmetricFieldId for naming.
    if (
      spec.isOneWayChanging() &&
      !spec.isJunctionToFkConversion() &&
      !spec.isFkToJunctionConversion()
    ) {
      return safeTry<ReadonlyArray<TableSchemaStatementBuilder>, DomainError>(function* () {
        const previousConfig = spec.previousConfig();
        const nextConfig = spec.computedNextConfig() ?? spec.nextConfig();
        if (!previousConfig.hasDbConfig() || !nextConfig.hasDbConfig()) {
          const statements: ReadonlyArray<TableSchemaStatementBuilder> = [];
          yield* addCond(statements);
          return ok(statements);
        }

        const oldFkHostTableName = yield* previousConfig.fkHostTableNameString();
        const newFkHostTableName = yield* nextConfig.fkHostTableNameString();

        // If the junction table name hasn't changed, only value shape rewrite is needed
        if (oldFkHostTableName === newFkHostTableName) {
          const statements = [...buildLinkValueShapeRewriteStatements()];
          yield* addCond(statements);
          return ok(statements);
        }

        const oldSelfKeyName = yield* previousConfig.selfKeyNameString();
        const oldForeignKeyName = yield* previousConfig.foreignKeyNameString();

        const newSelfKeyName = yield* nextConfig.selfKeyNameString();
        const newForeignKeyName = yield* nextConfig.foreignKeyNameString();

        const fullOldJunctionTableName = quoteTableName(oldFkHostTableName);
        const fullNewJunctionTableName = quoteTableName(newFkHostTableName);

        const prevRel = spec.previousRelationship().toString();
        const nextRel = spec.nextRelationship().toString();
        const prevHasOrder = prevRel === 'manyMany';
        const nextHasOrder = nextRel === 'manyMany';

        const statements: TableSchemaStatementBuilder[] = [];

        // 1. Create new junction table with proper columns
        const newOrderCol = nextHasOrder ? `, "__order" double precision` : '';
        statements.push({
          compile: () =>
            sql`CREATE TABLE IF NOT EXISTS ${sql.raw(fullNewJunctionTableName)} (
                "__id" serial PRIMARY KEY,
                ${sql.ref(newSelfKeyName)} text NOT NULL,
                ${sql.ref(newForeignKeyName)} text NOT NULL${sql.raw(newOrderCol)}
              )`.compile(db),
        });

        // 2. Copy data from old junction table to new junction table
        const selectColumns: string[] = [];
        const insertColumns: string[] = [];

        selectColumns.push(quoteColumn(oldSelfKeyName));
        insertColumns.push(quoteColumn(newSelfKeyName));
        selectColumns.push(quoteColumn(oldForeignKeyName));
        insertColumns.push(quoteColumn(newForeignKeyName));

        if (prevHasOrder && nextHasOrder) {
          selectColumns.push('"__order"');
          insertColumns.push('"__order"');
        }

        statements.push({
          compile: () =>
            sql`INSERT INTO ${sql.raw(fullNewJunctionTableName)} (${sql.raw(insertColumns.join(', '))})
                SELECT ${sql.raw(selectColumns.join(', '))}
                FROM ${sql.raw(fullOldJunctionTableName)}`.compile(db),
        });

        // 3. Drop old junction table
        statements.push({
          compile: () =>
            sql`DROP TABLE IF EXISTS ${sql.raw(fullOldJunctionTableName)} CASCADE`.compile(db),
        });

        statements.push(...buildLinkValueShapeRewriteStatements());

        yield* addCond(statements);
        return ok(statements);
      });
    }

    // For other changes, no schema changes needed
    const statements: ReadonlyArray<TableSchemaStatementBuilder> = [];
    return this.addCond(statements).map(() => statements);
  }

  // ============ Lookup Update specs ============

  visitUpdateLookupOptions(
    _spec: UpdateLookupOptionsSpec
  ): Result<ReadonlyArray<TableSchemaStatementBuilder>, DomainError> {
    const statements: ReadonlyArray<TableSchemaStatementBuilder> = [];
    return this.addCond(statements).map(() => statements);
  }

  // ============ Rollup Update specs ============

  visitUpdateRollupConfig(
    _spec: UpdateRollupConfigSpec
  ): Result<ReadonlyArray<TableSchemaStatementBuilder>, DomainError> {
    const statements: ReadonlyArray<TableSchemaStatementBuilder> = [];
    return this.addCond(statements).map(() => statements);
  }

  visitUpdateRollupExpression(
    _spec: UpdateRollupExpressionSpec
  ): Result<ReadonlyArray<TableSchemaStatementBuilder>, DomainError> {
    const statements: ReadonlyArray<TableSchemaStatementBuilder> = [];
    return this.addCond(statements).map(() => statements);
  }

  visitUpdateRollupFormatting(
    _spec: UpdateRollupFormattingSpec
  ): Result<ReadonlyArray<TableSchemaStatementBuilder>, DomainError> {
    const statements: ReadonlyArray<TableSchemaStatementBuilder> = [];
    return this.addCond(statements).map(() => statements);
  }

  visitUpdateRollupShowAs(
    _spec: UpdateRollupShowAsSpec
  ): Result<ReadonlyArray<TableSchemaStatementBuilder>, DomainError> {
    const statements: ReadonlyArray<TableSchemaStatementBuilder> = [];
    return this.addCond(statements).map(() => statements);
  }

  visitUpdateRollupTimeZone(
    _spec: UpdateRollupTimeZoneSpec
  ): Result<ReadonlyArray<TableSchemaStatementBuilder>, DomainError> {
    const statements: ReadonlyArray<TableSchemaStatementBuilder> = [];
    return this.addCond(statements).map(() => statements);
  }

  /**
   * Remove a symmetric link field during twoWay → oneWay conversion.
   * This only drops the JSONB column, NOT the shared junction table.
   */
  visitRemoveSymmetricLinkField(
    spec: RemoveSymmetricLinkFieldSpec
  ): Result<ReadonlyArray<TableSchemaStatementBuilder>, DomainError> {
    const { db, schema, tableName } = this.params;
    const addCond = this.addCond.bind(this);
    const visitor = this;

    return safeTry<ReadonlyArray<TableSchemaStatementBuilder>, DomainError>(function* () {
      const field = spec.field();
      const dbFieldNameResult = visitor.resolveDbFieldNameText(field);
      if (dbFieldNameResult.isErr()) {
        return err(dbFieldNameResult.error);
      }
      const dbFieldName = dbFieldNameResult.value;

      // Build schema-qualified table name
      const fullTableName = schema ? `"${schema}"."${tableName}"` : `"${tableName}"`;

      // Only drop the JSONB column, NOT the junction table
      const statements: TableSchemaStatementBuilder[] = [
        {
          compile: () =>
            sql`ALTER TABLE ${sql.raw(fullTableName)} DROP COLUMN IF EXISTS ${sql.ref(dbFieldName)}`.compile(
              db
            ),
        },
      ];

      yield* addCond(statements);
      return ok(statements);
    });
  }

  clone(): this {
    return new TableSchemaUpdateVisitor(this.params) as this;
  }

  and(
    left: ReadonlyArray<TableSchemaStatementBuilder>,
    right: ReadonlyArray<TableSchemaStatementBuilder>
  ): ReadonlyArray<TableSchemaStatementBuilder> {
    return [...left, ...right];
  }

  or(
    left: ReadonlyArray<TableSchemaStatementBuilder>,
    right: ReadonlyArray<TableSchemaStatementBuilder>
  ): ReadonlyArray<TableSchemaStatementBuilder> {
    return [...left, ...right];
  }

  not(
    inner: ReadonlyArray<TableSchemaStatementBuilder>
  ): ReadonlyArray<TableSchemaStatementBuilder> {
    return [...inner];
  }
}
