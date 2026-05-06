import { domainError, type DomainError, type LinkField } from '@teable/v2-core';
import { sql } from 'kysely';
import { err, ok, safeTry } from 'neverthrow';
import type { Result } from 'neverthrow';

import { resolveColumnName } from '../../visitors/PostgresTableSchemaFieldColumn';
import type { SchemaRuleContext } from '../context/SchemaRuleContext';
import type {
  ISchemaRule,
  SchemaRuleI18nValue,
  SchemaRuleRepairHint,
  SchemaRuleValidationResult,
  TableSchemaStatementBuilder,
} from '../core/ISchemaRule';
import { countOrphanForeignKeyRows } from '../helpers/ForeignKeyDiagnostics';
import {
  backfillJunctionTableFromLinkValueStatement,
  createForeignKeyConstraintStatement,
  createForeignKeyConstraintStatementFromTableMeta,
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
  /** The logical table id for resolving the foreign physical table name */
  foreignTableMetaId?: string;
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
        this,
        this.config.foreignTableMetaId
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

  getRepairHint(
    _ctx: SchemaRuleContext,
    _validation: SchemaRuleValidationResult
  ): Result<SchemaRuleRepairHint | undefined, DomainError> {
    return ok({
      available: true,
      mode: 'auto',
      reason: {
        fallback: `Automatic repair will recreate the junction table for "${this.field.name().toString()}".`,
      },
      description: {
        fallback:
          'This repair treats the current link-value column in the underlying source table as the recovery source. It recreates only the relation rows that can still be derived from those stored link values. Missing historical links cannot be recovered, and rebuilt ordering/display may follow the stored link-value order.',
      },
    });
  }

  up(ctx: SchemaRuleContext): Result<ReadonlyArray<TableSchemaStatementBuilder>, DomainError> {
    const self = this;
    return safeTry<ReadonlyArray<TableSchemaStatementBuilder>, DomainError>(function* () {
      const config = self.config;
      const schemaBuilder = config.junctionTable.schema
        ? ctx.db.schema.withSchema(config.junctionTable.schema)
        : ctx.db.schema;

      const statements: TableSchemaStatementBuilder[] = [];

      // Create the table if it is entirely missing.
      let createTableBuilder = schemaBuilder
        .createTable(config.junctionTable.tableName)
        .ifNotExists()
        .addColumn('__id', 'serial', (col) => col.primaryKey())
        .addColumn(config.selfKeyName, 'text')
        .addColumn(config.foreignKeyName, 'text');

      if (config.orderColumnName) {
        createTableBuilder = createTableBuilder.addColumn(
          config.orderColumnName,
          'double precision'
        );
      }
      statements.push(createTableBuilder);

      // Also repair partially-created junction tables by adding any missing columns.
      statements.push(
        schemaBuilder
          .alterTable(config.junctionTable.tableName)
          .addColumn('__id', 'serial', (col) => col.ifNotExists())
      );
      statements.push(
        schemaBuilder
          .alterTable(config.junctionTable.tableName)
          .addColumn(config.selfKeyName, 'text', (col) => col.ifNotExists())
      );
      statements.push(
        schemaBuilder
          .alterTable(config.junctionTable.tableName)
          .addColumn(config.foreignKeyName, 'text', (col) => col.ifNotExists())
      );

      if (config.orderColumnName) {
        statements.push(
          schemaBuilder
            .alterTable(config.junctionTable.tableName)
            .addColumn(config.orderColumnName, 'double precision', (col) => col.ifNotExists())
        );
      }

      const sourceLinkValueColumnName = yield* resolveColumnName(self.field);
      statements.push(
        backfillJunctionTableFromLinkValueStatement({
          sourceTable: config.sourceTable,
          sourceTableId: ctx.tableId,
          sourceLinkValueColumnName,
          junctionTable: config.junctionTable,
          selfKeyName: config.selfKeyName,
          foreignKeyName: config.foreignKeyName,
          orderColumnName: config.orderColumnName,
        })
      );

      return ok(statements);
    });
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
    parent: ISchemaRule,
    private readonly targetTableMetaId?: string
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

  private async resolveTargetTable(
    ctx: SchemaRuleContext
  ): Promise<Result<TableIdentifier | undefined, DomainError>> {
    if (!this.targetTableMetaId) {
      return ok(this.targetTable);
    }

    const tableMetaExists = await ctx.introspector.tableExists('public', 'table_meta');
    if (tableMetaExists.isErr()) {
      return err(tableMetaExists.error);
    }
    if (!tableMetaExists.value) {
      return ok(undefined);
    }

    try {
      const result = await sql<{ db_table_name: string | null }>`
        SELECT db_table_name
        FROM table_meta
        WHERE id = ${this.targetTableMetaId}
          AND deleted_time IS NULL
        LIMIT 1
      `.execute(ctx.db);

      const dbTableName = result.rows[0]?.db_table_name;
      if (!dbTableName) {
        return ok(undefined);
      }

      const [schema, ...rest] = dbTableName.split('.');
      if (rest.length === 0) {
        return ok({
          schema: 'public',
          tableName: schema ?? dbTableName,
        });
      }

      return ok({
        schema: schema ?? 'public',
        tableName: rest.join('.'),
      });
    } catch (error) {
      return err(
        domainError.infrastructure({
          message: `Failed to resolve junction foreign key target table: ${error instanceof Error ? error.message : String(error)}`,
          code: 'schema.introspection_failed',
          details: {
            targetTableMetaId: this.targetTableMetaId,
          },
        })
      );
    }
  }

  async isValid(ctx: SchemaRuleContext): Promise<Result<SchemaRuleValidationResult, DomainError>> {
    const self = this;
    const fieldName = this.field.name().toString();

    return safeTry<SchemaRuleValidationResult, DomainError>(async function* () {
      const fkResult = await ctx.introspector.foreignKeyExists(
        self.junctionTable.schema,
        self.junctionTable.tableName,
        self.constraintName
      );
      const exists = yield* fkResult;

      if (!exists) {
        const resolvedTargetTableResult = await self.resolveTargetTable(ctx);
        const resolvedTargetTable = yield* resolvedTargetTableResult;
        const targetTable = resolvedTargetTable ?? self.targetTable;
        const targetPhysicalTableName = targetTable.tableName;
        const targetExistsResult = await ctx.introspector.tableExists(
          targetTable.schema,
          targetTable.tableName
        );
        const targetExists = yield* targetExistsResult;

        if (!targetExists) {
          return ok({
            valid: false,
            missing: [
              `foreign key "${self.constraintName}" → ${self.targetTable.tableName}.__id on junction table`,
              `target table ${targetPhysicalTableName} does not exist`,
            ],
            missingItems: [
              {
                code: 'junction_foreign_key_missing',
                message: {
                  key: 'table:table.integrity.v2.detail.junctionForeignKeyMissing',
                  values: {
                    fieldName,
                  },
                  fallback: `The junction table for "${fieldName}" is missing one of its foreign keys.`,
                },
                description: {
                  key: 'table:table.integrity.v2.detail.junctionForeignKeyMissingDescription',
                  values: {
                    fieldName,
                    targetTableName: targetPhysicalTableName,
                  },
                  fallback: `Restore the junction foreign key for "${fieldName}" so relation rows stay linked to existing records in ${targetPhysicalTableName}.`,
                },
              },
              {
                code: 'junction_foreign_key_target_table_missing',
                message: {
                  key: 'table:table.integrity.v2.detail.junctionForeignKeyTargetTableMissing',
                  values: {
                    fieldName,
                    targetTableName: targetPhysicalTableName,
                  },
                  fallback: `The linked table for the junction of "${fieldName}" cannot be found.`,
                },
                description: {
                  key: 'table:table.integrity.v2.detail.junctionForeignKeyTargetTableMissingDescription',
                  values: {
                    fieldName,
                    targetPhysicalTableName,
                  },
                  fallback: `Automatic repair cannot restore the junction foreign key for "${fieldName}" because the target table "${targetPhysicalTableName}" does not exist.`,
                },
              },
            ],
          });
        }

        const orphanCountResult = await countOrphanForeignKeyRows(
          ctx.db,
          self.junctionTable,
          self.columnName,
          targetTable,
          '__id'
        );
        const orphanCount = yield* orphanCountResult;

        if (orphanCount > 0) {
          return ok({
            valid: false,
            missing: [
              `foreign key "${self.constraintName}" → ${self.targetTable.tableName}.__id on junction table`,
              `${orphanCount} orphan rows in ${self.junctionTable.tableName}.${self.columnName}`,
            ],
            missingItems: [
              {
                code: 'junction_foreign_key_missing',
                message: {
                  key: 'table:table.integrity.v2.detail.junctionForeignKeyMissing',
                  values: {
                    fieldName,
                  },
                  fallback: `The junction table for "${fieldName}" is missing one of its foreign keys.`,
                },
                description: {
                  key: 'table:table.integrity.v2.detail.junctionForeignKeyMissingDescription',
                  values: {
                    fieldName,
                    targetTableName: targetPhysicalTableName,
                  },
                  fallback: `Restore the junction foreign key for "${fieldName}" so relation rows stay linked to existing records in ${targetPhysicalTableName}.`,
                },
              },
              {
                code: 'junction_foreign_key_orphan_rows',
                message: {
                  key: 'table:table.integrity.v2.detail.junctionForeignKeyOrphanRows',
                  values: {
                    fieldName,
                    count: orphanCount,
                  },
                  fallback: `The junction table for "${fieldName}" has ${orphanCount} rows pointing to missing linked records.`,
                },
                description: {
                  key: 'table:table.integrity.v2.detail.junctionForeignKeyOrphanRowsDescription',
                  values: {
                    fieldName,
                    count: orphanCount,
                    targetTableName: targetPhysicalTableName,
                  },
                  fallback: `Automatic repair cannot restore the junction foreign key for "${fieldName}" until ${orphanCount} invalid relation rows referencing ${targetPhysicalTableName} are cleaned up.`,
                },
              },
            ],
          });
        }

        return ok({
          valid: false,
          missing: [
            `foreign key "${self.constraintName}" → ${self.targetTable.tableName}.__id on junction table`,
          ],
          missingItems: [
            {
              code: 'junction_foreign_key_missing',
              message: {
                key: 'table:table.integrity.v2.detail.junctionForeignKeyMissing',
                values: {
                  fieldName,
                },
                fallback: `The junction table for "${fieldName}" is missing one of its foreign keys.`,
              },
              description: {
                key: 'table:table.integrity.v2.detail.junctionForeignKeyMissingDescription',
                values: {
                  fieldName,
                  targetTableName: targetPhysicalTableName,
                },
                fallback: `Restore the junction foreign key for "${fieldName}" so relation rows stay linked to existing records in ${targetPhysicalTableName}.`,
              },
            },
          ],
        });
      }

      return ok({ valid: true });
    });
  }

  getRepairHint(
    _ctx: SchemaRuleContext,
    validation: SchemaRuleValidationResult
  ): Result<SchemaRuleRepairHint | undefined, DomainError> {
    const targetTableMissing = validation.missingItems?.some(
      (item) => item.code === 'junction_foreign_key_target_table_missing'
    );
    const orphanRowsDetected = validation.missingItems?.some(
      (item) => item.code === 'junction_foreign_key_orphan_rows'
    );

    if (!targetTableMissing && !orphanRowsDetected) {
      return ok(undefined);
    }

    const fieldName = this.field.name().toString();
    const targetPhysicalTableName = this.targetTable.tableName;

    if (targetTableMissing) {
      return ok({
        available: false,
        mode: 'auto',
        reason: {
          key: 'table:table.integrity.v2.repairMeta.reason.junctionForeignKeyTargetTableMissing',
          values: {
            fieldName,
            targetTableName: targetPhysicalTableName,
          },
          fallback: `Automatic repair is unavailable because the junction target table for "${fieldName}" is missing.`,
        },
        description: {
          key: 'table:table.integrity.v2.repairMeta.description.junctionForeignKeyTargetTableMissing',
          values: {
            fieldName,
            targetPhysicalTableName,
          },
          fallback: `Check whether the target table "${targetPhysicalTableName}" was deleted or renamed. Recreate the table, or update/remove the link configuration for "${fieldName}", then run the check again.`,
        },
      });
    }

    const orphanItem = validation.missingItems?.find(
      (item) => item.code === 'junction_foreign_key_orphan_rows'
    );
    const orphanCount =
      typeof orphanItem?.message?.values?.count === 'number'
        ? orphanItem.message.values.count
        : undefined;
    const orphanValues: Readonly<Record<string, SchemaRuleI18nValue>> =
      orphanCount == null
        ? {
            fieldName,
            targetTableName: targetPhysicalTableName,
          }
        : {
            fieldName,
            targetTableName: targetPhysicalTableName,
            count: orphanCount,
          };

    return ok({
      available: false,
      mode: 'auto',
      reason: {
        key: 'table:table.integrity.v2.repairMeta.reason.junctionForeignKeyOrphanRows',
        values: orphanValues,
        fallback: `Automatic repair is unavailable because the junction rows for "${fieldName}" still contain invalid references.`,
      },
      description: {
        key: 'table:table.integrity.v2.repairMeta.description.junctionForeignKeyOrphanRows',
        values: orphanValues,
        fallback: `Clean up the invalid junction rows for "${fieldName}" before adding the foreign key back.`,
      },
    });
  }

  up(_ctx: SchemaRuleContext): Result<ReadonlyArray<TableSchemaStatementBuilder>, DomainError> {
    if (this.targetTableMetaId) {
      return ok([
        createForeignKeyConstraintStatementFromTableMeta(
          this.junctionTable,
          this.constraintName,
          this.columnName,
          this.targetTableMetaId,
          '__id',
          'CASCADE',
          this.targetTable
        ),
      ]);
    }
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
