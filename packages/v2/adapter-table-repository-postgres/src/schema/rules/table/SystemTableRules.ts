import type { DomainError } from '@teable/v2-core';
import { sql } from 'kysely';
import { ok, safeTry } from 'neverthrow';
import type { Result } from 'neverthrow';

import type { ConstraintInfo } from '../context/SchemaIntrospector';
import type { SchemaRuleContext } from '../context/SchemaRuleContext';
import type {
  ISchemaRule,
  SchemaRuleValidationResult,
  TableSchemaStatementBuilder,
} from '../core/ISchemaRule';
import { buildTableIdentifier, dropConstraintStatement, dropColumnStatement } from '../helpers';

export const SYSTEM_RULE_FIELD_ID = '__system__';
export const SYSTEM_RULE_FIELD_NAME = 'System Columns';

type TableTarget = {
  schema: string | null;
  tableName: string;
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
      sql`alter table ${buildTableIdentifier(target)} add column if not exists ${sql.ref(
        this.columnName
      )} ${sql.raw(this.columnDefinition)}`,
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
      sql.raw(
        `ALTER TABLE ${qualifiedTable} ALTER COLUMN ${quoteIdentifier(this.columnName)} SET NOT NULL`
      ),
    ]);
  }

  down(ctx: SchemaRuleContext): Result<ReadonlyArray<TableSchemaStatementBuilder>, DomainError> {
    const qualifiedTable = toQualifiedTableSql({ schema: ctx.schema, tableName: ctx.tableName });
    return ok([
      sql.raw(
        `ALTER TABLE ${qualifiedTable} ALTER COLUMN ${quoteIdentifier(this.columnName)} DROP NOT NULL`
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
      sql.raw(
        `ALTER TABLE ${qualifiedTable} ADD CONSTRAINT ${quoteIdentifier(
          this.constraintName
        )} UNIQUE (${quoteIdentifier(this.columnName)})`
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
      sql.raw(
        `ALTER TABLE ${qualifiedTable} ADD CONSTRAINT ${quoteIdentifier(
          constraintName
        )} PRIMARY KEY (${quoteIdentifier(this.columnName)})`
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
      sql.raw(
        `ALTER TABLE ${qualifiedTable} ALTER COLUMN ${quoteIdentifier(this.columnName)} DROP DEFAULT`
      ),
    ]);
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
    sql.raw(`CREATE SEQUENCE IF NOT EXISTS ${qualifiedSequence}`),
    sql.raw(
      `ALTER SEQUENCE ${qualifiedSequence} OWNED BY ${qualifiedTable}.${quoteIdentifier(
        '__auto_number'
      )}`
    ),
    sql.raw(
      `ALTER TABLE ${qualifiedTable} ALTER COLUMN ${quoteIdentifier(
        '__auto_number'
      )} SET DEFAULT nextval(${sequenceLiteral}::regclass)`
    ),
    sql.raw(
      `SELECT setval(${sequenceLiteral}::regclass, GREATEST(COALESCE((SELECT MAX(${quoteIdentifier(
        '__auto_number'
      )}) FROM ${qualifiedTable}), 0), 1), true)`
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
          sql.raw(
            `ALTER TABLE ${qualifiedTable} ALTER COLUMN ${quoteIdentifier(
              '__created_time'
            )} SET DEFAULT now()`
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

  return rules;
};
