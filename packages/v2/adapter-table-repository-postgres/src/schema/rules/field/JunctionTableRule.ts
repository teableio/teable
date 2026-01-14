import type { DomainError, LinkField } from '@teable/v2-core';
import { ok, safeTry } from 'neverthrow';
import type { Result } from 'neverthrow';

import type { SchemaRuleContext } from '../context/SchemaRuleContext';
import type {
  ISchemaRule,
  SchemaRuleValidationResult,
  TableSchemaStatementBuilder,
} from '../core/ISchemaRule';
import {
  createForeignKeyConstraintStatement,
  createIndexStatement,
  dropConstraintStatement,
  dropIndexStatement,
  dropTableStatement,
  type TableIdentifier,
} from '../helpers/StatementBuilders';

/**
 * Configuration for junction table creation.
 */
export interface JunctionTableConfig {
  /** The junction table identifier (schema + name) */
  junctionTable: TableIdentifier;
  /** Column name for the "self" side of the relationship */
  selfKeyName: string;
  /** Column name for the "foreign" side of the relationship */
  foreignKeyName: string;
  /** Column name for ordering */
  orderColumnName?: string;
  /** The current (source) table identifier */
  sourceTable: TableIdentifier;
  /** The foreign (target) table identifier */
  foreignTable: TableIdentifier;
  /** Whether to add indexes (default: true for ManyMany, false for OneWay) */
  withIndexes?: boolean;
}

/**
 * Schema rule for creating/dropping the junction table with columns only.
 * This is the base rule that other junction table rules depend on.
 *
 * Child rules (unique constraint, indexes, foreign keys) should be created via factory methods.
 */
export class JunctionTableExistsRule implements ISchemaRule {
  readonly id: string;
  readonly description: string;
  readonly dependencies: ReadonlyArray<string> = [];
  readonly required = true;

  constructor(
    private readonly field: LinkField,
    private readonly config: JunctionTableConfig
  ) {
    this.id = `junction_table:${field.id().toString()}`;
    this.description = this.buildDescription();
  }

  private buildDescription(): string {
    const fieldName = this.field.name().toString();
    const relationship = this.field.relationship().toString();
    const source = this.config.sourceTable.tableName;
    const foreign = this.config.foreignTable.tableName;

    const relationshipDesc =
      relationship === 'manyMany'
        ? 'many-to-many'
        : this.field.isOneWay()
          ? 'one-way'
          : 'one-to-one';

    return `Junction table "${this.config.junctionTable.tableName}" for ${relationshipDesc} link "${fieldName}" (${source} ↔ ${foreign})`;
  }

  /**
   * Check if this junction table should have indexes.
   */
  shouldHaveIndexes(): boolean {
    return this.config.withIndexes !== false;
  }

  /**
   * Create unique constraint rule for the junction table.
   */
  createUniqueConstraintRule(): JunctionTableUniqueConstraintRule {
    return new JunctionTableUniqueConstraintRule(
      this.field,
      this.config.junctionTable,
      this.config.selfKeyName,
      this.config.foreignKeyName,
      this
    );
  }

  /**
   * Create index rules for the junction table.
   */
  createIndexRules(): JunctionTableIndexRule[] {
    const rules: JunctionTableIndexRule[] = [];

    rules.push(
      new JunctionTableIndexRule(
        this.field,
        this.config.junctionTable,
        this.config.selfKeyName,
        'self',
        this
      )
    );
    rules.push(
      new JunctionTableIndexRule(
        this.field,
        this.config.junctionTable,
        this.config.foreignKeyName,
        'foreign',
        this
      )
    );

    return rules;
  }

  /**
   * Create foreign key rules for the junction table.
   */
  createForeignKeyRules(): JunctionTableForeignKeyRule[] {
    const rules: JunctionTableForeignKeyRule[] = [];

    rules.push(
      new JunctionTableForeignKeyRule(
        this.field,
        this.config.junctionTable,
        this.config.selfKeyName,
        this.config.sourceTable,
        'self',
        this
      )
    );
    rules.push(
      new JunctionTableForeignKeyRule(
        this.field,
        this.config.junctionTable,
        this.config.foreignKeyName,
        this.config.foreignTable,
        'foreign',
        this
      )
    );

    return rules;
  }

  /**
   * Create all rules for this junction table based on configuration.
   */
  static createRulesFromField(field: LinkField, config: JunctionTableConfig): ISchemaRule[] {
    const junctionRule = new JunctionTableExistsRule(field, config);
    const rules: ISchemaRule[] = [junctionRule];

    // Always add unique constraint (depends on table exists)
    rules.push(junctionRule.createUniqueConstraintRule());

    // Add indexes if configured
    if (junctionRule.shouldHaveIndexes()) {
      rules.push(...junctionRule.createIndexRules());
    }

    // Always add foreign keys
    rules.push(...junctionRule.createForeignKeyRules());

    return rules;
  }

  async isValid(ctx: SchemaRuleContext): Promise<Result<SchemaRuleValidationResult, DomainError>> {
    const config = this.config;
    const junctionTable = config.junctionTable;
    const schemaName = junctionTable.schema ?? 'public';

    return safeTry<SchemaRuleValidationResult, DomainError>(async function* () {
      const missing: string[] = [];

      // 1. Check if table exists
      const tableExistsResult = await ctx.introspector.tableExists(
        junctionTable.schema,
        junctionTable.tableName
      );
      const tableExists = yield* tableExistsResult;

      if (!tableExists) {
        missing.push(`junction table "${schemaName}"."${junctionTable.tableName}"`);
        return ok({ valid: false, missing });
      }

      // 2. Check required columns exist
      const requiredColumns = ['__id', config.selfKeyName, config.foreignKeyName];
      if (config.orderColumnName) {
        requiredColumns.push(config.orderColumnName);
      }

      for (const col of requiredColumns) {
        const colExistsResult = await ctx.introspector.columnExists(
          junctionTable.schema,
          junctionTable.tableName,
          col
        );
        const colExists = yield* colExistsResult;
        if (!colExists) {
          missing.push(`column "${schemaName}"."${junctionTable.tableName}"."${col}"`);
        }
      }

      return ok({
        valid: missing.length === 0,
        missing,
      });
    });
  }

  up(ctx: SchemaRuleContext): Result<ReadonlyArray<TableSchemaStatementBuilder>, DomainError> {
    const config = this.config;
    const schemaBuilder = config.junctionTable.schema
      ? ctx.db.schema.withSchema(config.junctionTable.schema)
      : ctx.db.schema;

    // Only create table with columns, unique constraint is handled by JunctionTableUniqueConstraintRule
    let builder = schemaBuilder
      .createTable(config.junctionTable.tableName)
      .ifNotExists()
      .addColumn('__id', 'serial', (col) => col.primaryKey())
      .addColumn(config.selfKeyName, 'text')
      .addColumn(config.foreignKeyName, 'text');

    if (config.orderColumnName) {
      builder = builder.addColumn(config.orderColumnName, 'double precision');
    }

    return ok([builder]);
  }

  down(_ctx: SchemaRuleContext): Result<ReadonlyArray<TableSchemaStatementBuilder>, DomainError> {
    // DROP TABLE CASCADE will automatically drop FK constraints and indexes
    return ok([dropTableStatement(this.config.junctionTable)]);
  }
}

/**
 * Schema rule for creating/dropping a unique constraint on the junction table.
 * Depends on JunctionTableExistsRule.
 */
export class JunctionTableUniqueConstraintRule implements ISchemaRule {
  readonly id: string;
  readonly description: string;
  readonly dependencies: ReadonlyArray<string>;
  readonly required = false;

  private readonly constraintName: string;

  constructor(
    private readonly field: LinkField,
    private readonly junctionTable: TableIdentifier,
    private readonly selfKeyName: string,
    private readonly foreignKeyName: string,
    parent: ISchemaRule
  ) {
    this.id = `junction_unique:${field.id().toString()}`;
    this.dependencies = [parent.id];
    this.constraintName = `uniq_${selfKeyName}_${foreignKeyName}`;

    const fieldName = field.name().toString();
    this.description = `Unique constraint on (${selfKeyName}, ${foreignKeyName}) in junction table for link "${fieldName}"`;
  }

  async isValid(ctx: SchemaRuleContext): Promise<Result<SchemaRuleValidationResult, DomainError>> {
    const self = this;

    return safeTry<SchemaRuleValidationResult, DomainError>(async function* () {
      const constraintResult = await ctx.introspector.constraintExists(
        self.junctionTable.schema,
        self.junctionTable.tableName,
        self.constraintName
      );
      const exists = yield* constraintResult;

      if (!exists) {
        return ok({
          valid: false,
          missing: [`unique constraint "${self.constraintName}" on junction table`],
        });
      }

      return ok({ valid: true });
    });
  }

  up(ctx: SchemaRuleContext): Result<ReadonlyArray<TableSchemaStatementBuilder>, DomainError> {
    const schemaBuilder = this.junctionTable.schema
      ? ctx.db.schema.withSchema(this.junctionTable.schema)
      : ctx.db.schema;

    const builder = schemaBuilder
      .alterTable(this.junctionTable.tableName)
      .addUniqueConstraint(this.constraintName, [this.selfKeyName, this.foreignKeyName]);

    return ok([builder]);
  }

  down(_ctx: SchemaRuleContext): Result<ReadonlyArray<TableSchemaStatementBuilder>, DomainError> {
    return ok([dropConstraintStatement(this.junctionTable, this.constraintName)]);
  }
}

/**
 * Schema rule for creating/dropping an index on the junction table.
 * Depends on JunctionTableExistsRule.
 */
export class JunctionTableIndexRule implements ISchemaRule {
  readonly id: string;
  readonly description: string;
  readonly dependencies: ReadonlyArray<string>;
  readonly required = false;

  constructor(
    private readonly field: LinkField,
    private readonly junctionTable: TableIdentifier,
    private readonly columnName: string,
    private readonly indexSide: 'self' | 'foreign',
    parent: ISchemaRule
  ) {
    this.id = `junction_index:${field.id().toString()}:${indexSide}`;
    this.dependencies = [parent.id];

    const fieldName = field.name().toString();
    this.description = `Index on "${columnName}" in junction table for link "${fieldName}" (${indexSide} side)`;
  }

  private get indexName(): string {
    return `index_${this.columnName}`;
  }

  async isValid(ctx: SchemaRuleContext): Promise<Result<SchemaRuleValidationResult, DomainError>> {
    const self = this;

    return safeTry<SchemaRuleValidationResult, DomainError>(async function* () {
      const indexResult = await ctx.introspector.indexExists(
        self.junctionTable.schema,
        self.indexName
      );
      const exists = yield* indexResult;

      if (!exists) {
        return ok({
          valid: false,
          missing: [`index "${self.indexName}" on junction table`],
        });
      }

      return ok({ valid: true });
    });
  }

  up(_ctx: SchemaRuleContext): Result<ReadonlyArray<TableSchemaStatementBuilder>, DomainError> {
    return ok([createIndexStatement(this.junctionTable, this.indexName, this.columnName)]);
  }

  down(_ctx: SchemaRuleContext): Result<ReadonlyArray<TableSchemaStatementBuilder>, DomainError> {
    return ok([dropIndexStatement(this.junctionTable, this.indexName)]);
  }
}

/**
 * Schema rule for creating/dropping a foreign key on the junction table.
 * Depends on JunctionTableExistsRule.
 */
export class JunctionTableForeignKeyRule implements ISchemaRule {
  readonly id: string;
  readonly description: string;
  readonly dependencies: ReadonlyArray<string>;
  readonly required = false;

  constructor(
    private readonly field: LinkField,
    private readonly junctionTable: TableIdentifier,
    private readonly columnName: string,
    private readonly targetTable: TableIdentifier,
    private readonly fkSide: 'self' | 'foreign',
    parent: ISchemaRule
  ) {
    this.id = `junction_fk:${field.id().toString()}:${fkSide}`;
    this.dependencies = [parent.id];

    const fieldName = field.name().toString();
    const target = targetTable.tableName;
    this.description = `Foreign key on "${columnName}" → ${target}.__id in junction table for link "${fieldName}" (${fkSide} side)`;
  }

  private get constraintName(): string {
    return `fk_${this.columnName}`;
  }

  async isValid(ctx: SchemaRuleContext): Promise<Result<SchemaRuleValidationResult, DomainError>> {
    const self = this;

    return safeTry<SchemaRuleValidationResult, DomainError>(async function* () {
      const fkResult = await ctx.introspector.foreignKeyExists(
        self.junctionTable.schema,
        self.junctionTable.tableName,
        self.constraintName
      );
      const exists = yield* fkResult;

      if (!exists) {
        return ok({
          valid: false,
          missing: [
            `foreign key "${self.constraintName}" → ${self.targetTable.tableName}.__id on junction table`,
          ],
        });
      }

      return ok({ valid: true });
    });
  }

  up(_ctx: SchemaRuleContext): Result<ReadonlyArray<TableSchemaStatementBuilder>, DomainError> {
    return ok([
      createForeignKeyConstraintStatement(
        this.junctionTable,
        this.constraintName,
        this.columnName,
        this.targetTable,
        '__id',
        'CASCADE'
      ),
    ]);
  }

  down(_ctx: SchemaRuleContext): Result<ReadonlyArray<TableSchemaStatementBuilder>, DomainError> {
    return ok([dropConstraintStatement(this.junctionTable, this.constraintName)]);
  }
}
