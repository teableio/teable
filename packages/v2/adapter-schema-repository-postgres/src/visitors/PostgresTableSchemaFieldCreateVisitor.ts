import {
  AbstractFieldVisitor,
  getRandomString,
  type AttachmentField,
  type AutoNumberField,
  type ButtonField,
  type CheckboxField,
  type CreatedByField,
  type CreatedTimeField,
  type DateField,
  type Field,
  type FormulaField,
  type LastModifiedByField,
  type LastModifiedTimeField,
  type LinkField,
  type LongTextField,
  type LookupField,
  type MultipleSelectField,
  type NumberField,
  type RatingField,
  type RollupField,
  type SingleLineTextField,
  type SingleSelectField,
  type Table,
  type UserField,
  checkFieldNotNullValidationEnabled,
  checkFieldUniqueValidationEnabled,
  type DomainError,
} from '@teable/v2-core';
import type { V1TeableDatabase } from '@teable/v2-postgres-schema';
import type {
  ColumnDefinitionBuilder,
  CompiledQuery,
  CreateTableBuilder,
  Kysely,
  QueryExecutorProvider,
} from 'kysely';
import { sql } from 'kysely';
import { ok, safeTry } from 'neverthrow';
import type { Result } from 'neverthrow';

import {
  resolveColumnName,
  resolveColumnType,
  type TableColumnDataType,
} from './PostgresTableSchemaFieldColumn';

export type TableSchemaStatementBuilder = {
  compile: (executorProvider: QueryExecutorProvider) => CompiledQuery;
};

type TableIdentifier = {
  schema: string | null;
  tableName: string;
};

const buildTableIdentifier = (target: TableIdentifier) => {
  if (!target.schema) return sql.ref(target.tableName);
  return sql`${sql.ref(target.schema)}.${sql.ref(target.tableName)}`;
};

const createIndexStatement = (
  target: TableIdentifier,
  indexName: string,
  columnName: string
): TableSchemaStatementBuilder =>
  sql`create index if not exists ${sql.ref(indexName)} on ${buildTableIdentifier(target)} (${sql.ref(columnName)})`;

const createUniqueIndexStatement = (
  target: TableIdentifier,
  indexName: string,
  columnName: string
): TableSchemaStatementBuilder =>
  sql`create unique index if not exists ${sql.ref(indexName)} on ${buildTableIdentifier(target)} (${sql.ref(columnName)})`;

const buildColumnConstraints = (
  field: Field
): ((col: ColumnDefinitionBuilder) => ColumnDefinitionBuilder) | undefined => {
  const fieldType = field.type().toString();
  const isComputed = field.computed().toBoolean();
  const notNullEnabled = checkFieldNotNullValidationEnabled(fieldType, { isComputed });
  const uniqueEnabled = checkFieldUniqueValidationEnabled(fieldType, { isComputed });
  const notNull = notNullEnabled && field.notNull().toBoolean();
  const unique = uniqueEnabled && field.unique().toBoolean();

  if (!notNull && !unique) return undefined;
  return (col) => {
    let next = col;
    if (notNull) next = next.notNull();
    if (unique) next = next.unique();
    return next;
  };
};

const addGeneratedColumnStatement = (
  target: TableIdentifier,
  columnName: string,
  definition: ReturnType<typeof sql>
): TableSchemaStatementBuilder =>
  sql`alter table ${buildTableIdentifier(target)} add column if not exists ${sql.ref(
    columnName
  )} ${definition}`;

type PostgresTableSchemaFieldCreateVisitorParams = {
  addColumn: (
    columnName: string,
    dataType: TableColumnDataType,
    configure?: (col: ColumnDefinitionBuilder) => ColumnDefinitionBuilder
  ) => Result<ReadonlyArray<TableSchemaStatementBuilder>, DomainError>;
  db: Kysely<V1TeableDatabase>;
  currentSchema: string | null;
  currentTableName: string;
  currentTableId: string;
};

type ICreateTableBuilder = CreateTableBuilder<string, string>;

export interface ICreateTableBuilderRef {
  builder: ICreateTableBuilder;
}

// Owns field-level column creation and any field-specific side statements (e.g. formula references).
export class PostgresTableSchemaFieldCreateVisitor extends AbstractFieldVisitor<
  ReadonlyArray<TableSchemaStatementBuilder>
> {
  constructor(private readonly params: PostgresTableSchemaFieldCreateVisitorParams) {
    super();
  }

  static forTableCreation(params: {
    builderRef: ICreateTableBuilderRef;
    db: Kysely<V1TeableDatabase>;
    schema: string | null;
    tableName: string;
    tableId: string;
  }): PostgresTableSchemaFieldCreateVisitor {
    return new PostgresTableSchemaFieldCreateVisitor({
      addColumn: (columnName, dataType, configure) => {
        params.builderRef.builder = (configure
          ? params.builderRef.builder.addColumn(columnName, dataType, configure)
          : params.builderRef.builder.addColumn(
              columnName,
              dataType
            )) as unknown as ICreateTableBuilder;
        return ok([]);
      },
      db: params.db,
      currentSchema: params.schema,
      currentTableName: params.tableName,
      currentTableId: params.tableId,
    });
  }

  static forSchemaUpdate(params: {
    db: Kysely<V1TeableDatabase>;
    schema: string | null;
    tableName: string;
    tableId: string;
  }): PostgresTableSchemaFieldCreateVisitor {
    const schemaBuilder = params.schema
      ? params.db.schema.withSchema(params.schema)
      : params.db.schema;
    return new PostgresTableSchemaFieldCreateVisitor({
      addColumn: (columnName, dataType, configure) => {
        const statement = configure
          ? schemaBuilder
              .alterTable(params.tableName)
              .addColumn(columnName, dataType, (col) => configure(col).ifNotExists())
          : schemaBuilder
              .alterTable(params.tableName)
              .addColumn(columnName, dataType, (col) => col.ifNotExists());
        return ok([statement]);
      },
      db: params.db,
      currentSchema: params.schema,
      currentTableName: params.tableName,
      currentTableId: params.tableId,
    });
  }

  private static isFieldArray(value: Table | ReadonlyArray<Field>): value is ReadonlyArray<Field> {
    return Array.isArray(value);
  }

  apply(table: Table): Result<ReadonlyArray<TableSchemaStatementBuilder>, DomainError>;
  apply(
    fields: ReadonlyArray<Field>
  ): Result<ReadonlyArray<TableSchemaStatementBuilder>, DomainError>;
  apply(
    tableOrFields: Table | ReadonlyArray<Field>
  ): Result<ReadonlyArray<TableSchemaStatementBuilder>, DomainError> {
    const visitor = this;
    return safeTry<ReadonlyArray<TableSchemaStatementBuilder>, DomainError>(function* () {
      const fields = PostgresTableSchemaFieldCreateVisitor.isFieldArray(tableOrFields)
        ? tableOrFields
        : tableOrFields.getFields();
      const statements: Array<TableSchemaStatementBuilder> = [];

      for (const field of fields) {
        const fieldStatements = yield* field.accept(visitor);
        statements.push(...fieldStatements);
      }

      return ok(statements);
    });
  }

  visitSingleLineTextField(
    field: SingleLineTextField
  ): Result<ReadonlyArray<TableSchemaStatementBuilder>, DomainError> {
    return this.addColumnFromValueType(field);
  }

  visitLongTextField(
    field: LongTextField
  ): Result<ReadonlyArray<TableSchemaStatementBuilder>, DomainError> {
    return this.addColumnFromValueType(field);
  }

  visitNumberField(
    field: NumberField
  ): Result<ReadonlyArray<TableSchemaStatementBuilder>, DomainError> {
    return this.addColumnFromValueType(field);
  }

  visitRatingField(
    field: RatingField
  ): Result<ReadonlyArray<TableSchemaStatementBuilder>, DomainError> {
    return this.addColumnFromValueType(field);
  }

  visitFormulaField(
    field: FormulaField
  ): Result<ReadonlyArray<TableSchemaStatementBuilder>, DomainError> {
    const visitor = this;
    return safeTry<ReadonlyArray<TableSchemaStatementBuilder>, DomainError>(function* () {
      const columnStatements = yield* visitor.addColumnFromValueType(field);
      const referenceStatements = yield* visitor.buildFormulaReferenceStatements(field);
      return ok([...columnStatements, ...referenceStatements]);
    });
  }

  visitRollupField(
    field: RollupField
  ): Result<ReadonlyArray<TableSchemaStatementBuilder>, DomainError> {
    const visitor = this;
    return safeTry<ReadonlyArray<TableSchemaStatementBuilder>, DomainError>(function* () {
      const columnStatements = yield* visitor.addColumnFromValueType(field);
      const referenceStatements = yield* visitor.buildRollupReferenceStatements(field);
      return ok([...columnStatements, ...referenceStatements]);
    });
  }

  visitSingleSelectField(
    field: SingleSelectField
  ): Result<ReadonlyArray<TableSchemaStatementBuilder>, DomainError> {
    return this.addColumnFromValueType(field);
  }

  visitMultipleSelectField(
    field: MultipleSelectField
  ): Result<ReadonlyArray<TableSchemaStatementBuilder>, DomainError> {
    return this.addColumnFromValueType(field);
  }

  visitCheckboxField(
    field: CheckboxField
  ): Result<ReadonlyArray<TableSchemaStatementBuilder>, DomainError> {
    return this.addColumnFromValueType(field);
  }

  visitAttachmentField(
    field: AttachmentField
  ): Result<ReadonlyArray<TableSchemaStatementBuilder>, DomainError> {
    return this.addColumnFromValueType(field);
  }

  visitDateField(
    field: DateField
  ): Result<ReadonlyArray<TableSchemaStatementBuilder>, DomainError> {
    return this.addColumnFromValueType(field);
  }

  visitCreatedTimeField(
    field: CreatedTimeField
  ): Result<ReadonlyArray<TableSchemaStatementBuilder>, DomainError> {
    return this.addGeneratedColumn(field, '__created_time', sql`timestamptz`);
  }

  visitLastModifiedTimeField(
    field: LastModifiedTimeField
  ): Result<ReadonlyArray<TableSchemaStatementBuilder>, DomainError> {
    if (!field.isTrackAll()) {
      return this.addColumnFromValueType(field);
    }
    return this.addGeneratedColumn(field, '__last_modified_time', sql`timestamptz`);
  }

  visitUserField(
    field: UserField
  ): Result<ReadonlyArray<TableSchemaStatementBuilder>, DomainError> {
    return this.addColumnFromValueType(field);
  }

  visitCreatedByField(
    field: CreatedByField
  ): Result<ReadonlyArray<TableSchemaStatementBuilder>, DomainError> {
    return this.addGeneratedColumn(field, '__created_by', sql`text`);
  }

  visitLastModifiedByField(
    field: LastModifiedByField
  ): Result<ReadonlyArray<TableSchemaStatementBuilder>, DomainError> {
    if (!field.isTrackAll()) {
      return this.addColumnFromValueType(field);
    }
    return this.addGeneratedColumn(field, '__last_modified_by', sql`text`);
  }

  visitAutoNumberField(
    field: AutoNumberField
  ): Result<ReadonlyArray<TableSchemaStatementBuilder>, DomainError> {
    return this.addGeneratedColumn(field, '__auto_number', sql`double precision`);
  }

  visitButtonField(
    field: ButtonField
  ): Result<ReadonlyArray<TableSchemaStatementBuilder>, DomainError> {
    return this.addColumnFromValueType(field);
  }

  visitLinkField(
    field: LinkField
  ): Result<ReadonlyArray<TableSchemaStatementBuilder>, DomainError> {
    const addLinkValueColumn = this.addLinkValueColumn.bind(this);
    const buildManyManyStatements = this.buildManyManyStatements.bind(this);
    const buildOneManyJunctionStatements = this.buildOneManyJunctionStatements.bind(this);
    const resolveFkHostTable = this.resolveFkHostTable.bind(this);
    const isCurrentTable = this.isCurrentTable.bind(this);
    const addForeignKeyColumns = this.addForeignKeyColumns.bind(this);
    const buildLinkReferenceStatements = this.buildLinkReferenceStatements.bind(this);
    const buildLinkOrderMetaStatements = this.buildLinkOrderMetaStatements.bind(this);

    return safeTry<ReadonlyArray<TableSchemaStatementBuilder>, DomainError>(function* () {
      const valueColumnStatements = yield* addLinkValueColumn(field);
      const referenceStatements = yield* buildLinkReferenceStatements(field);
      const relationship = field.relationship().toString();
      if (relationship === 'manyMany') {
        const statements = yield* buildManyManyStatements(field);
        const metaStatements = yield* buildLinkOrderMetaStatements(field);
        return ok([
          ...valueColumnStatements,
          ...referenceStatements,
          ...statements,
          ...metaStatements,
        ]);
      }
      if (relationship === 'oneMany' && field.isOneWay()) {
        const statements = yield* buildOneManyJunctionStatements(field);
        return ok([...valueColumnStatements, ...referenceStatements, ...statements]);
      }

      const fkHostTable = yield* resolveFkHostTable(field);
      if (!isCurrentTable(fkHostTable)) {
        return ok([...valueColumnStatements, ...referenceStatements]);
      }

      const statements = yield* addForeignKeyColumns(field);
      const metaStatements = yield* buildLinkOrderMetaStatements(field);
      return ok([
        ...valueColumnStatements,
        ...referenceStatements,
        ...statements,
        ...metaStatements,
      ]);
    });
  }

  override visitLookupField(
    field: LookupField
  ): Result<ReadonlyArray<TableSchemaStatementBuilder>, DomainError> {
    // Lookup fields store data similarly to rollup fields
    // They need both a column AND reference records
    const visitor = this;
    return safeTry<ReadonlyArray<TableSchemaStatementBuilder>, DomainError>(function* () {
      const columnStatements = yield* visitor.addColumnFromValueType(field);
      const referenceStatements = yield* visitor.buildLookupReferenceStatements(field);
      return ok([...columnStatements, ...referenceStatements]);
    });
  }

  private addColumnFromValueType(
    field: Field
  ): Result<ReadonlyArray<TableSchemaStatementBuilder>, DomainError> {
    const params = this.params;
    return safeTry<ReadonlyArray<TableSchemaStatementBuilder>, DomainError>(function* () {
      const columnName = yield* resolveColumnName(field);
      const dataType = yield* resolveColumnType(field);
      const statements = yield* params.addColumn(
        columnName,
        dataType,
        buildColumnConstraints(field)
      );
      return ok(statements);
    });
  }

  private addGeneratedColumn(
    field: Field,
    sourceColumn: string,
    columnType: ReturnType<typeof sql>
  ): Result<ReadonlyArray<TableSchemaStatementBuilder>, DomainError> {
    const params = this.params;
    return safeTry<ReadonlyArray<TableSchemaStatementBuilder>, DomainError>(function* () {
      const columnName = yield* resolveColumnName(field);
      const definition = sql`${columnType} generated always as (${sql.ref(sourceColumn)}) stored`;
      const statement = addGeneratedColumnStatement(
        { schema: params.currentSchema, tableName: params.currentTableName },
        columnName,
        definition
      );
      const updateMeta = params.db
        .updateTable('field')
        .set({ meta: JSON.stringify({ persistedAsGeneratedColumn: true }) })
        .where('id', '=', field.id().toString());
      return ok([statement, updateMeta]);
    });
  }

  private addLinkValueColumn(
    field: LinkField
  ): Result<ReadonlyArray<TableSchemaStatementBuilder>, DomainError> {
    const params = this.params;
    return safeTry<ReadonlyArray<TableSchemaStatementBuilder>, DomainError>(function* () {
      const columnName = yield* resolveColumnName(field);
      const statements = yield* params.addColumn(
        columnName,
        'jsonb',
        buildColumnConstraints(field)
      );
      return ok(statements);
    });
  }

  private addForeignKeyColumns(
    field: LinkField
  ): Result<ReadonlyArray<TableSchemaStatementBuilder>, DomainError> {
    const relationship = field.relationship().toString();
    const keyNameResult =
      relationship === 'oneMany' ? field.selfKeyNameString() : field.foreignKeyNameString();

    const params = this.params;
    const currentTable = this.currentTable.bind(this);
    return safeTry<ReadonlyArray<TableSchemaStatementBuilder>, DomainError>(function* () {
      const keyName = yield* keyNameResult;
      const statements = yield* params.addColumn(keyName, 'text');
      const orderColumnName = yield* field.orderColumnName();
      const orderStatements = yield* params.addColumn(orderColumnName, 'double precision');

      // Create index for FK column
      const indexName = `index_${keyName}`;
      const table = currentTable();

      // OneOne requires UNIQUE index, others use regular index
      const indexStatement =
        relationship === 'oneOne'
          ? createUniqueIndexStatement(table, indexName, keyName)
          : createIndexStatement(table, indexName, keyName);

      return ok([...statements, ...orderStatements, indexStatement]);
    });
  }

  private currentTable(): TableIdentifier {
    return { schema: this.params.currentSchema, tableName: this.params.currentTableName };
  }

  private buildManyManyStatements(
    field: LinkField
  ): Result<ReadonlyArray<TableSchemaStatementBuilder>, DomainError> {
    const params = this.params;
    const resolveFkHostTable = this.resolveFkHostTable.bind(this);
    return safeTry<ReadonlyArray<TableSchemaStatementBuilder>, DomainError>(function* () {
      const fkHostTable = yield* resolveFkHostTable(field);
      const selfKeyName = yield* field.selfKeyNameString();
      const foreignKeyName = yield* field.foreignKeyNameString();
      const schemaBuilder = fkHostTable.schema
        ? params.db.schema.withSchema(fkHostTable.schema)
        : params.db.schema;
      let builder = schemaBuilder
        .createTable(fkHostTable.tableName)
        .ifNotExists()
        .addColumn('__id', 'serial', (col) => col.primaryKey())
        .addColumn(selfKeyName, 'text')
        .addColumn(foreignKeyName, 'text');
      const orderColumnName = yield* field.orderColumnName();
      builder = builder.addColumn(orderColumnName, 'double precision');

      // Create indexes for junction table FK columns
      const selfKeyIndexName = `index_${selfKeyName}`;
      const foreignKeyIndexName = `index_${foreignKeyName}`;
      const selfKeyIndexStatement = createIndexStatement(
        fkHostTable,
        selfKeyIndexName,
        selfKeyName
      );
      const foreignKeyIndexStatement = createIndexStatement(
        fkHostTable,
        foreignKeyIndexName,
        foreignKeyName
      );

      return ok([builder, selfKeyIndexStatement, foreignKeyIndexStatement]);
    });
  }

  private buildOneManyJunctionStatements(
    field: LinkField
  ): Result<ReadonlyArray<TableSchemaStatementBuilder>, DomainError> {
    const params = this.params;
    const resolveFkHostTable = this.resolveFkHostTable.bind(this);
    return safeTry<ReadonlyArray<TableSchemaStatementBuilder>, DomainError>(function* () {
      const fkHostTable = yield* resolveFkHostTable(field);
      const selfKeyName = yield* field.selfKeyNameString();
      const foreignKeyName = yield* field.foreignKeyNameString();
      const schemaBuilder = fkHostTable.schema
        ? params.db.schema.withSchema(fkHostTable.schema)
        : params.db.schema;
      const constraintName = `index_${selfKeyName}_${foreignKeyName}`;
      const builder = schemaBuilder
        .createTable(fkHostTable.tableName)
        .ifNotExists()
        .addColumn('__id', 'serial', (col) => col.primaryKey())
        .addColumn(selfKeyName, 'text')
        .addColumn(foreignKeyName, 'text')
        .addUniqueConstraint(constraintName, [selfKeyName, foreignKeyName]);
      return ok([builder]);
    });
  }

  private buildLinkOrderMetaStatements(
    field: LinkField
  ): Result<ReadonlyArray<TableSchemaStatementBuilder>, DomainError> {
    if (!this.shouldPersistOrderColumnMeta(field)) return ok([]);

    const update = this.params.db
      .updateTable('field')
      .set({ meta: JSON.stringify({ hasOrderColumn: true }) })
      .where('id', '=', field.id().toString());
    return ok([update]);
  }

  private shouldPersistOrderColumnMeta(field: LinkField): boolean {
    const relationship = field.relationship().toString();
    if (relationship === 'oneMany' && field.isOneWay()) return false;
    return true;
  }

  private resolveFkHostTable(
    field: LinkField
  ): Result<{ schema: string | null; tableName: string }, DomainError> {
    return field.fkHostTableName().split({ defaultSchema: this.params.currentSchema });
  }

  private isCurrentTable(target: { schema: string | null; tableName: string }): boolean {
    const currentSchema = this.params.currentSchema ?? null;
    const targetSchema = target.schema ?? null;
    return (
      targetSchema === currentSchema &&
      (target.tableName === this.params.currentTableName ||
        target.tableName === this.params.currentTableId)
    );
  }

  private buildFormulaReferenceStatements(
    field: FormulaField
  ): Result<ReadonlyArray<TableSchemaStatementBuilder>, DomainError> {
    const dependencies = field.dependencies();
    if (dependencies.length === 0) return ok([]);

    const toFieldId = field.id().toString();
    const values = dependencies.map((dependency) => ({
      id: getRandomString(25),
      to_field_id: toFieldId,
      from_field_id: dependency.toString(),
    }));

    const insert = this.params.db
      .insertInto('reference')
      .values(values)
      .onConflict((oc) => oc.columns(['to_field_id', 'from_field_id']).doNothing());
    // TODO: task_reference insertion is handled by a separate spec.
    return ok([insert]);
  }

  private buildLinkReferenceStatements(
    field: LinkField
  ): Result<ReadonlyArray<TableSchemaStatementBuilder>, DomainError> {
    const toFieldId = field.id().toString();
    const fromFieldId = field.lookupFieldId().toString();
    const insert = this.params.db
      .insertInto('reference')
      .values({
        id: getRandomString(25),
        to_field_id: toFieldId,
        from_field_id: fromFieldId,
      })
      .onConflict((oc) => oc.columns(['to_field_id', 'from_field_id']).doNothing());
    return ok([insert]);
  }

  private buildRollupReferenceStatements(
    field: RollupField
  ): Result<ReadonlyArray<TableSchemaStatementBuilder>, DomainError> {
    const toFieldId = field.id().toString();
    const linkFieldId = field.linkFieldId().toString();
    const lookupFieldId = field.lookupFieldId().toString();
    const insert = this.params.db
      .insertInto('reference')
      .values([
        {
          id: getRandomString(25),
          to_field_id: toFieldId,
          from_field_id: linkFieldId,
        },
        {
          id: getRandomString(25),
          to_field_id: toFieldId,
          from_field_id: lookupFieldId,
        },
      ])
      .onConflict((oc) => oc.columns(['to_field_id', 'from_field_id']).doNothing());
    return ok([insert]);
  }

  private buildLookupReferenceStatements(
    field: LookupField
  ): Result<ReadonlyArray<TableSchemaStatementBuilder>, DomainError> {
    const toFieldId = field.id().toString();
    const linkFieldId = field.linkFieldId().toString();
    const lookupFieldId = field.lookupFieldId().toString();
    const insert = this.params.db
      .insertInto('reference')
      .values([
        {
          id: getRandomString(25),
          to_field_id: toFieldId,
          from_field_id: linkFieldId,
        },
        {
          id: getRandomString(25),
          to_field_id: toFieldId,
          from_field_id: lookupFieldId,
        },
      ])
      .onConflict((oc) => oc.columns(['to_field_id', 'from_field_id']).doNothing());
    return ok([insert]);
  }
}
