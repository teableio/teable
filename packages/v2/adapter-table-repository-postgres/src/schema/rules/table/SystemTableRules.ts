import type { DomainError } from '@teable/v2-core';
import type { RawBuilder } from 'kysely';
import { sql } from 'kysely';
import { ok, safeTry } from 'neverthrow';
import type { Result } from 'neverthrow';

import type { ConstraintInfo } from '../context/SchemaIntrospector';
import type { SchemaRuleContext } from '../context/SchemaRuleContext';
import type {
  ISchemaRule,
  SchemaRuleValidationResult,
  TableSchemaStatementBuilder,
  TableSchemaStatementExecutorProvider,
} from '../core/ISchemaRule';
import {
  buildTableIdentifier,
  dataStatement,
  dropColumnStatement,
  dropConstraintStatement,
  dropTableStatement,
} from '../helpers';

export const SYSTEM_RULE_FIELD_ID = '__system__';
export const SYSTEM_RULE_FIELD_NAME = 'System Columns';

type TableTarget = {
  schema: string | null;
  tableName: string;
};

type LinkStorageRef = {
  schema: string;
  tableName: string;
  columnName: string;
};

type OrphanedLinkStorageConstraint = {
  constraintName: string;
  childSchemaName: string;
  childTableName: string;
  childColumnName: string;
};

const normalize = (value: string | null | undefined): string =>
  value?.replace(/\s+/g, ' ').trim().toLowerCase() ?? '';

const hasSingleColumnConstraint = (
  constraints: ReadonlyArray<ConstraintInfo>,
  constraintTypes: ReadonlyArray<ConstraintInfo['constraintType']>,
  columnName: string
): boolean =>
  constraints.some(
    (constraint) =>
      constraintTypes.includes(constraint.constraintType) &&
      constraint.columnNames.length === 1 &&
      constraint.columnNames[0] === columnName
  );

const hasSingleColumnUniqueIndex = (
  indexes: ReadonlyArray<{
    columnNames: ReadonlyArray<string>;
    isUnique: boolean;
  }>,
  columnName: string
): boolean =>
  indexes.some(
    (index) =>
      index.isUnique && index.columnNames.length === 1 && index.columnNames[0] === columnName
  );

const quoteIdentifier = (value: string): string => `"${value.replaceAll('"', '""')}"`;

const quoteLiteral = (value: string): string => `'${value.replaceAll("'", "''")}'`;

const toQualifiedTableSql = (target: TableTarget): string =>
  target.schema
    ? `${quoteIdentifier(target.schema)}.${quoteIdentifier(target.tableName)}`
    : quoteIdentifier(target.tableName);

const toSequenceName = (tableName: string, columnName: string): string =>
  `${tableName}_${columnName}_seq`;

const toQualifiedSequenceSql = (target: TableTarget, sequenceName: string): string =>
  target.schema
    ? `${quoteIdentifier(target.schema)}.${quoteIdentifier(sequenceName)}`
    : quoteIdentifier(sequenceName);

const toQualifiedSequenceLiteral = (target: TableTarget, sequenceName: string): string =>
  quoteLiteral(
    target.schema
      ? `${quoteIdentifier(target.schema)}.${quoteIdentifier(sequenceName)}`
      : quoteIdentifier(sequenceName)
  );

const executeRawRows = async <T>(
  executor: TableSchemaStatementExecutorProvider,
  query: RawBuilder<T>
): Promise<T[]> => {
  const result = await executor.executeQuery<T>(query.compile(executor));
  return result.rows;
};

const executeSchemaStatement = async (
  executor: TableSchemaStatementExecutorProvider,
  statement: TableSchemaStatementBuilder
): Promise<void> => {
  await executor.executeQuery(statement.compile(executor));
};

const splitStorageTableName = (value: string, defaultSchema: string): TableTarget => {
  const dotIndex = value.indexOf('.');
  if (dotIndex === -1) {
    return { schema: defaultSchema, tableName: value };
  }

  return {
    schema: value.slice(0, dotIndex),
    tableName: value.slice(dotIndex + 1),
  };
};

const linkStorageRefKey = (ref: LinkStorageRef): string =>
  `${ref.schema}\0${ref.tableName}\0${ref.columnName}`;

const linkStorageTableKey = (schema: string, tableName: string): string =>
  `${schema}\0${tableName}`;

const collectActiveLinkStorageRefs = async (
  metaDb: TableSchemaStatementExecutorProvider,
  defaultSchema: string
): Promise<ReadonlySet<string> | undefined> => {
  let rows: Array<{ options: unknown }>;
  try {
    rows = await executeRawRows<{
      options: unknown;
    }>(
      metaDb,
      sql`
        select options
        from field
        where type = 'link'
          and deleted_time is null
          and is_lookup is null
      `
    );
  } catch (error) {
    if (error instanceof Error && error.message.includes('relation "field" does not exist')) {
      return undefined;
    }
    throw error;
  }

  const refs: LinkStorageRef[] = [];

  for (const row of rows) {
    const options = typeof row.options === 'string' ? JSON.parse(row.options) : row.options;
    if (!options || typeof options !== 'object') continue;

    const {
      fkHostTableName,
      selfKeyName,
      foreignKeyName,
    }: {
      fkHostTableName?: unknown;
      selfKeyName?: unknown;
      foreignKeyName?: unknown;
    } = options;

    if (typeof fkHostTableName !== 'string') continue;

    const storageTable = splitStorageTableName(fkHostTableName, defaultSchema);
    if (typeof selfKeyName === 'string') {
      refs.push({
        schema: storageTable.schema ?? defaultSchema,
        tableName: storageTable.tableName,
        columnName: selfKeyName,
      });
    }
    if (typeof foreignKeyName === 'string') {
      refs.push({
        schema: storageTable.schema ?? defaultSchema,
        tableName: storageTable.tableName,
        columnName: foreignKeyName,
      });
    }
  }

  return new Set(refs.map(linkStorageRefKey));
};

const loadOrphanedLinkStorageConstraints = async (
  dataDb: TableSchemaStatementExecutorProvider,
  target: TableTarget,
  activeRefs: ReadonlySet<string>
): Promise<ReadonlyArray<OrphanedLinkStorageConstraint>> => {
  const targetSchema = target.schema ?? 'public';
  const rows = await executeRawRows<{
    constraint_name: string;
    child_schema_name: string;
    child_table_name: string;
    child_column_name: string;
  }>(
    dataDb,
    sql`
      select
        c.conname as constraint_name,
        child_ns.nspname as child_schema_name,
        child.relname as child_table_name,
        child_attr.attname as child_column_name
      from pg_constraint c
      join pg_class child on child.oid = c.conrelid
      join pg_namespace child_ns on child_ns.oid = child.relnamespace
      join pg_class parent on parent.oid = c.confrelid
      join pg_namespace parent_ns on parent_ns.oid = parent.relnamespace
      join unnest(c.conkey) with ordinality as child_key(attnum, ord) on true
      join unnest(c.confkey) with ordinality as parent_key(attnum, ord)
        on parent_key.ord = child_key.ord
      join pg_attribute child_attr
        on child_attr.attrelid = c.conrelid and child_attr.attnum = child_key.attnum
      join pg_attribute parent_attr
        on parent_attr.attrelid = c.confrelid and parent_attr.attnum = parent_key.attnum
      where c.contype = 'f'
        and parent_ns.nspname = ${targetSchema}
        and parent.relname = ${target.tableName}
        and parent_attr.attname = '__id'
        and array_length(c.conkey, 1) = 1
        and array_length(c.confkey, 1) = 1
    `
  );

  return rows.flatMap((row) => {
    const isLinkStorage =
      row.child_table_name.startsWith('junction_') || row.child_column_name.startsWith('__fk_');
    if (!isLinkStorage) return [];

    const isActive = activeRefs.has(
      linkStorageRefKey({
        schema: row.child_schema_name,
        tableName: row.child_table_name,
        columnName: row.child_column_name,
      })
    );
    if (isActive) return [];

    return [
      {
        constraintName: row.constraint_name,
        childSchemaName: row.child_schema_name,
        childTableName: row.child_table_name,
        childColumnName: row.child_column_name,
      },
    ];
  });
};

const createOrphanedLinkStorageRepairStatement = (
  target: TableTarget
): TableSchemaStatementBuilder => ({
  scope: 'data',
  compile: (executorProvider) =>
    sql.raw(`select 'repair orphaned link storage' as schema_repair`).compile(executorProvider),
  execute: async ({ dataDb, metaDb }) => {
    const defaultSchema = target.schema ?? 'public';
    const activeRefs = await collectActiveLinkStorageRefs(metaDb, defaultSchema);
    if (!activeRefs) return;

    const constraints = await loadOrphanedLinkStorageConstraints(dataDb, target, activeRefs);
    const activeTables = new Set(
      [...activeRefs].map((refKey) => {
        const [schema, tableName] = refKey.split('\0');
        return linkStorageTableKey(schema ?? defaultSchema, tableName ?? '');
      })
    );

    const droppedTables = new Set<string>();
    for (const constraint of constraints) {
      const childTarget = {
        schema: constraint.childSchemaName,
        tableName: constraint.childTableName,
      };
      const tableKey = linkStorageTableKey(constraint.childSchemaName, constraint.childTableName);

      if (constraint.childTableName.startsWith('junction_') && !activeTables.has(tableKey)) {
        if (droppedTables.has(tableKey)) continue;

        await executeSchemaStatement(dataDb, dropTableStatement(childTarget));
        droppedTables.add(tableKey);
        continue;
      }

      await executeSchemaStatement(
        dataDb,
        dropColumnStatement(childTarget, constraint.childColumnName)
      );
    }
  },
});

class SystemColumnExistsRule implements ISchemaRule {
  readonly id: string;
  readonly description: string;
  readonly dependencies: ReadonlyArray<string> = [];
  readonly required = true;

  constructor(
    private readonly columnName: string,
    private readonly columnDefinition: string
  ) {
    this.id = `system_column:${columnName}`;
    this.description = `System column "${columnName}" (${columnDefinition})`;
  }

  async isValid(ctx: SchemaRuleContext): Promise<Result<SchemaRuleValidationResult, DomainError>> {
    const columnName = this.columnName;
    return safeTry(async function* () {
      const column = yield* await ctx.introspector.getColumn(ctx.schema, ctx.tableName, columnName);
      if (!column) {
        return ok({
          valid: false,
          missing: [`system column "${columnName}" not found`],
        });
      }

      return ok({ valid: true });
    });
  }

  up(ctx: SchemaRuleContext): Result<ReadonlyArray<TableSchemaStatementBuilder>, DomainError> {
    const target = { schema: ctx.schema, tableName: ctx.tableName };
    return ok([
      dataStatement(
        sql`alter table ${buildTableIdentifier(target)} add column if not exists ${sql.ref(
          this.columnName
        )} ${sql.raw(this.columnDefinition)}`
      ),
    ]);
  }

  down(ctx: SchemaRuleContext): Result<ReadonlyArray<TableSchemaStatementBuilder>, DomainError> {
    return ok([
      dropColumnStatement({ schema: ctx.schema, tableName: ctx.tableName }, this.columnName),
    ]);
  }
}

class SystemColumnNotNullRule implements ISchemaRule {
  readonly id: string;
  readonly description: string;
  readonly dependencies: ReadonlyArray<string>;
  readonly required = true;

  constructor(
    private readonly columnName: string,
    parent: ISchemaRule
  ) {
    this.id = `system_not_null:${columnName}`;
    this.description = `NOT NULL constraint on system column "${columnName}"`;
    this.dependencies = [parent.id];
  }

  async isValid(ctx: SchemaRuleContext): Promise<Result<SchemaRuleValidationResult, DomainError>> {
    const columnName = this.columnName;
    return safeTry(async function* () {
      const column = yield* await ctx.introspector.getColumn(ctx.schema, ctx.tableName, columnName);
      if (!column) {
        return ok({
          valid: false,
          missing: [`system column "${columnName}" not found`],
        });
      }

      if (column.isNullable) {
        return ok({
          valid: false,
          missing: [`system column "${columnName}" should be NOT NULL`],
        });
      }

      return ok({ valid: true });
    });
  }

  up(ctx: SchemaRuleContext): Result<ReadonlyArray<TableSchemaStatementBuilder>, DomainError> {
    const qualifiedTable = toQualifiedTableSql({ schema: ctx.schema, tableName: ctx.tableName });
    return ok([
      dataStatement(
        sql.raw(
          `ALTER TABLE ${qualifiedTable} ALTER COLUMN ${quoteIdentifier(this.columnName)} SET NOT NULL`
        )
      ),
    ]);
  }

  down(ctx: SchemaRuleContext): Result<ReadonlyArray<TableSchemaStatementBuilder>, DomainError> {
    const qualifiedTable = toQualifiedTableSql({ schema: ctx.schema, tableName: ctx.tableName });
    return ok([
      dataStatement(
        sql.raw(
          `ALTER TABLE ${qualifiedTable} ALTER COLUMN ${quoteIdentifier(this.columnName)} DROP NOT NULL`
        )
      ),
    ]);
  }
}

class SystemUniqueIndexRule implements ISchemaRule {
  readonly id: string;
  readonly description: string;
  readonly dependencies: ReadonlyArray<string>;
  readonly required = true;

  constructor(
    private readonly columnName: string,
    parent: ISchemaRule
  ) {
    this.id = `system_unique:${columnName}`;
    this.description = `UNIQUE index on system column "${columnName}"`;
    this.dependencies = [parent.id];
  }

  private get constraintName(): string {
    return `sys_${this.columnName}_unique`;
  }

  async isValid(ctx: SchemaRuleContext): Promise<Result<SchemaRuleValidationResult, DomainError>> {
    const columnName = this.columnName;
    return safeTry(async function* () {
      const indexes = yield* await ctx.introspector.getIndexes(ctx.schema, ctx.tableName);
      if (hasSingleColumnUniqueIndex(indexes, columnName)) {
        return ok({ valid: true });
      }

      return ok({
        valid: false,
        missing: [`system column "${columnName}" should have UNIQUE index`],
      });
    });
  }

  up(ctx: SchemaRuleContext): Result<ReadonlyArray<TableSchemaStatementBuilder>, DomainError> {
    const qualifiedTable = toQualifiedTableSql({ schema: ctx.schema, tableName: ctx.tableName });
    return ok([
      dataStatement(
        sql.raw(
          `ALTER TABLE ${qualifiedTable} ADD CONSTRAINT ${quoteIdentifier(
            this.constraintName
          )} UNIQUE (${quoteIdentifier(this.columnName)})`
        )
      ),
    ]);
  }

  down(ctx: SchemaRuleContext): Result<ReadonlyArray<TableSchemaStatementBuilder>, DomainError> {
    return ok([
      dropConstraintStatement(
        { schema: ctx.schema, tableName: ctx.tableName },
        this.constraintName
      ),
    ]);
  }
}

class SystemPrimaryKeyRule implements ISchemaRule {
  readonly id: string;
  readonly description: string;
  readonly dependencies: ReadonlyArray<string>;
  readonly required = true;

  constructor(
    private readonly columnName: string,
    parent: ISchemaRule
  ) {
    this.id = `system_primary_key:${columnName}`;
    this.description = `PRIMARY KEY on system column "${columnName}"`;
    this.dependencies = [parent.id];
  }

  private constraintName(tableName: string): string {
    return `${tableName}_pkey`;
  }

  async isValid(ctx: SchemaRuleContext): Promise<Result<SchemaRuleValidationResult, DomainError>> {
    const columnName = this.columnName;
    return safeTry(async function* () {
      const constraints = yield* await ctx.introspector.getConstraints(ctx.schema, ctx.tableName);
      if (hasSingleColumnConstraint(constraints, ['PRIMARY KEY'], columnName)) {
        return ok({ valid: true });
      }

      return ok({
        valid: false,
        missing: [`system column "${columnName}" should be PRIMARY KEY`],
      });
    });
  }

  up(ctx: SchemaRuleContext): Result<ReadonlyArray<TableSchemaStatementBuilder>, DomainError> {
    const qualifiedTable = toQualifiedTableSql({ schema: ctx.schema, tableName: ctx.tableName });
    const constraintName = this.constraintName(ctx.tableName);
    return ok([
      dataStatement(
        sql.raw(
          `ALTER TABLE ${qualifiedTable} ADD CONSTRAINT ${quoteIdentifier(
            constraintName
          )} PRIMARY KEY (${quoteIdentifier(this.columnName)})`
        )
      ),
    ]);
  }

  down(ctx: SchemaRuleContext): Result<ReadonlyArray<TableSchemaStatementBuilder>, DomainError> {
    return ok([
      dropConstraintStatement(
        { schema: ctx.schema, tableName: ctx.tableName },
        this.constraintName(ctx.tableName)
      ),
    ]);
  }
}

class SystemDefaultRule implements ISchemaRule {
  readonly id: string;
  readonly description: string;
  readonly dependencies: ReadonlyArray<string>;
  readonly required = true;

  constructor(
    private readonly columnName: string,
    private readonly descriptionSuffix: string,
    private readonly expectedFragments: ReadonlyArray<string>,
    private readonly statementFactory: (
      ctx: SchemaRuleContext
    ) => ReadonlyArray<TableSchemaStatementBuilder>,
    parent: ISchemaRule
  ) {
    this.id = `system_default:${columnName}`;
    this.description = `${descriptionSuffix} on system column "${columnName}"`;
    this.dependencies = [parent.id];
  }

  async isValid(ctx: SchemaRuleContext): Promise<Result<SchemaRuleValidationResult, DomainError>> {
    const columnName = this.columnName;
    const expectedFragments = this.expectedFragments;
    return safeTry(async function* () {
      const column = yield* await ctx.introspector.getColumn(ctx.schema, ctx.tableName, columnName);
      if (!column) {
        return ok({
          valid: false,
          missing: [`system column "${columnName}" not found`],
        });
      }

      const columnDefault = normalize(column.columnDefault);
      const matches = expectedFragments.some((fragment) =>
        columnDefault.includes(normalize(fragment))
      );
      if (!matches) {
        return ok({
          valid: false,
          missing: [`system column "${columnName}" is missing expected default expression`],
        });
      }

      return ok({ valid: true });
    });
  }

  up(ctx: SchemaRuleContext): Result<ReadonlyArray<TableSchemaStatementBuilder>, DomainError> {
    return ok(this.statementFactory(ctx));
  }

  down(ctx: SchemaRuleContext): Result<ReadonlyArray<TableSchemaStatementBuilder>, DomainError> {
    const qualifiedTable = toQualifiedTableSql({ schema: ctx.schema, tableName: ctx.tableName });
    return ok([
      dataStatement(
        sql.raw(
          `ALTER TABLE ${qualifiedTable} ALTER COLUMN ${quoteIdentifier(this.columnName)} DROP DEFAULT`
        )
      ),
    ]);
  }
}

class OrphanedLinkStorageRule implements ISchemaRule {
  readonly id = 'system_orphaned_link_storage';
  readonly description = 'Orphaned link storage foreign keys referencing this table';
  readonly dependencies: ReadonlyArray<string> = [];
  readonly required = false;
  readonly repairMode = 'auto';

  async isValid(ctx: SchemaRuleContext): Promise<Result<SchemaRuleValidationResult, DomainError>> {
    return safeTry(async function* () {
      const target = { schema: ctx.schema, tableName: ctx.tableName };
      const defaultSchema = target.schema ?? 'public';
      const activeRefs = yield* await ok(
        await collectActiveLinkStorageRefs(ctx.metaDb, defaultSchema)
      );
      if (!activeRefs) {
        return ok({ valid: true });
      }

      const constraints = yield* await ok(
        await loadOrphanedLinkStorageConstraints(ctx.db, target, activeRefs)
      );

      if (constraints.length === 0) {
        return ok({ valid: true });
      }

      return ok({
        valid: false,
        extra: constraints.map(
          (constraint) =>
            `orphaned link storage "${constraint.childSchemaName}.${constraint.childTableName}" via "${constraint.childColumnName}"`
        ),
        extraItems: constraints.map((constraint) => ({
          code: 'orphaned_link_storage',
          message: {
            fallback: `Orphaned link storage ${constraint.childSchemaName}.${constraint.childTableName}.${constraint.childColumnName}`,
          },
          description: {
            fallback: `Constraint "${constraint.constraintName}" references "${defaultSchema}.${ctx.tableName}" but no active link field owns it.`,
          },
        })),
      });
    });
  }

  up(ctx: SchemaRuleContext): Result<ReadonlyArray<TableSchemaStatementBuilder>, DomainError> {
    return ok([
      createOrphanedLinkStorageRepairStatement({ schema: ctx.schema, tableName: ctx.tableName }),
    ]);
  }

  down(): Result<ReadonlyArray<TableSchemaStatementBuilder>, DomainError> {
    return ok([]);
  }
}

const createAutoNumberDefaultStatements = (
  ctx: SchemaRuleContext
): ReadonlyArray<TableSchemaStatementBuilder> => {
  const target = { schema: ctx.schema, tableName: ctx.tableName };
  const sequenceName = toSequenceName(ctx.tableName, '__auto_number');
  const qualifiedTable = toQualifiedTableSql(target);
  const qualifiedSequence = toQualifiedSequenceSql(target, sequenceName);
  const sequenceLiteral = toQualifiedSequenceLiteral(target, sequenceName);

  return [
    dataStatement(sql.raw(`CREATE SEQUENCE IF NOT EXISTS ${qualifiedSequence}`)),
    dataStatement(
      sql.raw(
        `ALTER SEQUENCE ${qualifiedSequence} OWNED BY ${qualifiedTable}.${quoteIdentifier(
          '__auto_number'
        )}`
      )
    ),
    dataStatement(
      sql.raw(
        `ALTER TABLE ${qualifiedTable} ALTER COLUMN ${quoteIdentifier(
          '__auto_number'
        )} SET DEFAULT nextval(${sequenceLiteral}::regclass)`
      )
    ),
    dataStatement(
      sql.raw(
        `SELECT setval(${sequenceLiteral}::regclass, GREATEST(COALESCE((SELECT MAX(${quoteIdentifier(
          '__auto_number'
        )}) FROM ${qualifiedTable}), 0), 1), true)`
      )
    ),
  ];
};

export const createSystemTableRules = (): ReadonlyArray<ISchemaRule> => {
  const rules: ISchemaRule[] = [];

  const idColumnRule = new SystemColumnExistsRule('__id', 'text');
  rules.push(idColumnRule);
  rules.push(new SystemColumnNotNullRule('__id', idColumnRule));
  rules.push(new SystemUniqueIndexRule('__id', idColumnRule));

  const autoNumberColumnRule = new SystemColumnExistsRule('__auto_number', 'integer');
  rules.push(autoNumberColumnRule);
  rules.push(new SystemPrimaryKeyRule('__auto_number', autoNumberColumnRule));
  rules.push(
    new SystemDefaultRule(
      '__auto_number',
      'Sequence-backed default',
      ['nextval('],
      createAutoNumberDefaultStatements,
      autoNumberColumnRule
    )
  );

  const createdTimeColumnRule = new SystemColumnExistsRule('__created_time', 'timestamptz');
  rules.push(createdTimeColumnRule);
  rules.push(new SystemColumnNotNullRule('__created_time', createdTimeColumnRule));
  rules.push(
    new SystemDefaultRule(
      '__created_time',
      'Default expression',
      ['now()', 'current_timestamp'],
      (ctx) => {
        const qualifiedTable = toQualifiedTableSql({
          schema: ctx.schema,
          tableName: ctx.tableName,
        });
        return [
          dataStatement(
            sql.raw(
              `ALTER TABLE ${qualifiedTable} ALTER COLUMN ${quoteIdentifier(
                '__created_time'
              )} SET DEFAULT now()`
            )
          ),
        ];
      },
      createdTimeColumnRule
    )
  );

  rules.push(new SystemColumnExistsRule('__last_modified_time', 'timestamptz'));

  const createdByColumnRule = new SystemColumnExistsRule('__created_by', 'text');
  rules.push(createdByColumnRule);
  rules.push(new SystemColumnNotNullRule('__created_by', createdByColumnRule));

  rules.push(new SystemColumnExistsRule('__last_modified_by', 'text'));

  const versionColumnRule = new SystemColumnExistsRule('__version', 'integer');
  rules.push(versionColumnRule);
  rules.push(new SystemColumnNotNullRule('__version', versionColumnRule));

  rules.push(new OrphanedLinkStorageRule());

  return rules;
};
