import { domainError, type DomainError, type LinkField } from '@teable/v2-core';
import { sql } from 'kysely';
import { err, ok, safeTry } from 'neverthrow';
import type { Result } from 'neverthrow';
import { z } from 'zod';

import { resolveColumnName } from '../../visitors/PostgresTableSchemaFieldColumn';
import { PostgresSchemaIntrospector } from '../context/PostgresSchemaIntrospector';
import type { SchemaRuleContext } from '../context/SchemaRuleContext';
import type {
  ISchemaRule,
  SchemaRuleI18nValue,
  SchemaRuleManualRepairOptions,
  SchemaRuleManualRepairValues,
  SchemaRuleRepairHint,
  SchemaRuleValidationResult,
  TableSchemaStatementBuilder,
} from '../core/ISchemaRule';
import {
  serializeManualRepairSchema,
  withManualRepairFieldMeta,
  withManualRepairFormMeta,
} from '../core/ManualRepairSchema';
import {
  countOrphanForeignKeyRows,
  foreignKeyExistsForColumnTarget,
} from '../helpers/ForeignKeyDiagnostics';
import {
  backfillJunctionTableFromLinkValueStatement,
  compressSql,
  createForeignKeyConstraintStatement,
  createIndexStatement,
  dataStatement,
  dropConstraintStatement,
  dropIndexStatement,
  dropTableStatement,
  quoteIdentifier,
  quoteTableIdentifier,
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

  private readonly missingHostSchemaManualRepairSchema = withManualRepairFormMeta(
    z.object({
      resolution: withManualRepairFieldMeta(z.enum(['create_missing_host_schema']), {
        widget: 'select',
        title: {
          key: 'table:table.integrity.v2.repairMeta.manual.junctionHostSchema.resolutionLabel',
          fallback: 'Repair strategy',
        },
        description: {
          key: 'table:table.integrity.v2.repairMeta.manual.junctionHostSchema.resolutionDescription',
          fallback:
            'The configured schema for the junction table is missing. Confirm creating it before rebuilding the junction table from the current link values.',
        },
        options: {
          create_missing_host_schema: {
            value: 'create_missing_host_schema',
            label: {
              key: 'table:table.integrity.v2.repairMeta.manual.junctionHostSchema.option.create',
              fallback: 'Create the missing schema and rebuild the junction table',
            },
          },
        },
      }).default('create_missing_host_schema'),
    }),
    {
      title: {
        key: 'table:table.integrity.v2.repairMeta.manual.junctionHostSchema.title',
        fallback: 'Resolve missing junction table schema',
      },
      description: {
        key: 'table:table.integrity.v2.repairMeta.manual.junctionHostSchema.description',
        fallback:
          'This repair is manual because the link metadata points to a schema that no longer exists. Confirm the schema should be recreated for this link before applying the repair.',
      },
      submitLabel: {
        key: 'table:table.integrity.v2.repairMeta.manual.apply',
        fallback: 'Apply manual repair',
      },
    }
  );

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
    const self = this;
    const config = this.config;
    const junctionTable = config.junctionTable;
    const schemaName = junctionTable.schema ?? 'public';

    return safeTry<SchemaRuleValidationResult, DomainError>(async function* () {
      const missing: string[] = [];

      if (junctionTable.schema) {
        const schemaResult = await sql<{ exists: boolean }>`
          SELECT EXISTS (
            SELECT 1 FROM information_schema.schemata
            WHERE schema_name = ${junctionTable.schema}
          ) as exists
        `.execute(ctx.db);

        if (!schemaResult.rows[0]?.exists) {
          return ok({
            valid: false,
            missing: [`schema "${schemaName}"`],
            missingItems: [
              {
                code: 'junction_table_host_schema_missing',
                message: {
                  fallback:
                    `The schema "${schemaName}" for the junction table of ` +
                    `"${self.field.name().toString()}" does not exist.`,
                },
                description: {
                  fallback:
                    'Automatic repair cannot recreate this junction table because its configured host schema is missing.',
                },
              },
            ],
          });
        }
      }

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
    validation: SchemaRuleValidationResult
  ): Result<SchemaRuleRepairHint | undefined, DomainError> {
    const hostSchemaMissing = validation.missingItems?.some(
      (item) => item.code === 'junction_table_host_schema_missing'
    );

    if (hostSchemaMissing) {
      const manualRepairSchemaResult = serializeManualRepairSchema(
        this.missingHostSchemaManualRepairSchema
      );

      return ok({
        available: true,
        mode: 'manual',
        reason: {
          key: 'table:table.integrity.v2.repairMeta.reason.junctionHostSchemaMissing',
          fallback:
            'The junction table host schema for ' + `"${this.field.name().toString()}" is missing.`,
        },
        description: {
          key: 'table:table.integrity.v2.repairMeta.description.junctionHostSchemaMissing',
          fallback:
            'Confirm creating the missing schema before rebuilding the junction table. The repair can only restore relation rows that are still present in the source link-value column.',
        },
        manualRepairSchema: manualRepairSchemaResult.isOk()
          ? manualRepairSchemaResult.value
          : undefined,
      });
    }

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
      statements.push(dataStatement(createTableBuilder));

      if (!ctx.optimizeForEmptyTables) {
        // Also repair partially-created junction tables by adding any missing columns.
        statements.push(
          dataStatement(
            schemaBuilder
              .alterTable(config.junctionTable.tableName)
              .addColumn('__id', 'serial', (col) => col.ifNotExists())
          )
        );
        statements.push(
          dataStatement(
            schemaBuilder
              .alterTable(config.junctionTable.tableName)
              .addColumn(config.selfKeyName, 'text', (col) => col.ifNotExists())
          )
        );
        statements.push(
          dataStatement(
            schemaBuilder
              .alterTable(config.junctionTable.tableName)
              .addColumn(config.foreignKeyName, 'text', (col) => col.ifNotExists())
          )
        );

        if (config.orderColumnName) {
          statements.push(
            dataStatement(
              schemaBuilder
                .alterTable(config.junctionTable.tableName)
                .addColumn(config.orderColumnName, 'double precision', (col) => col.ifNotExists())
            )
          );
        }
      }

      if (!ctx.optimizeForEmptyTables) {
        const sourceLinkValueColumnName = yield* resolveColumnName(self.field);
        const sameColumnLinkFieldCount =
          ctx.table?.getFields().filter((field) => {
            const dbFieldName = field.dbFieldName().andThen((name) => name.value());
            return dbFieldName.isOk() && dbFieldName.value === sourceLinkValueColumnName;
          }).length ?? 1;
        statements.push(
          backfillJunctionTableFromLinkValueStatement({
            sourceTable: config.sourceTable,
            sourceLinkValueColumnName,
            junctionTable: config.junctionTable,
            selfKeyName: config.selfKeyName,
            foreignKeyName: config.foreignKeyName,
            orderColumnName: config.orderColumnName,
            skipBackfill: sameColumnLinkFieldCount > 1,
          })
        );
      }

      return ok(statements);
    });
  }

  down(_ctx: SchemaRuleContext): Result<ReadonlyArray<TableSchemaStatementBuilder>, DomainError> {
    // DROP TABLE CASCADE will automatically drop FK constraints and indexes
    return ok([dropTableStatement(this.config.junctionTable)]);
  }

  async manualRepair(
    ctx: SchemaRuleContext,
    values: SchemaRuleManualRepairValues | undefined,
    options?: SchemaRuleManualRepairOptions
  ): Promise<Result<void, DomainError>> {
    const resolution =
      typeof values?.resolution === 'string' ? values.resolution : 'create_missing_host_schema';

    if (resolution !== 'create_missing_host_schema') {
      return err(
        domainError.validation({
          message: 'Unsupported manual repair strategy',
          details: { resolution },
        })
      );
    }

    const schemaName = this.config.junctionTable.schema;
    if (!schemaName) {
      return err(
        domainError.validation({
          message: 'Junction table host schema is not configured',
          details: {
            fieldId: this.field.id().toString(),
            junctionTable: this.config.junctionTable,
          },
        })
      );
    }

    if (options?.dryRun) {
      return ok(undefined);
    }

    try {
      await ctx.db.schema.createSchema(schemaName).ifNotExists().execute();

      const statementsResult = this.up(ctx);
      if (statementsResult.isErr()) {
        return err(statementsResult.error);
      }

      for (const statement of statementsResult.value) {
        await ctx.db.executeQuery(statement.compile(ctx.db));
      }

      return ok(undefined);
    } catch (error) {
      return err(
        domainError.infrastructure({
          message: `Failed to restore junction table host schema: ${error instanceof Error ? error.message : String(error)}`,
          code: 'schema.repair_failed',
          details: {
            fieldId: this.field.id().toString(),
            schemaName,
            junctionTable: this.config.junctionTable,
          },
        })
      );
    }
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

    return ok([dataStatement(builder)]);
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

  private readonly orphanRowsManualRepairSchema = withManualRepairFormMeta(
    z.object({
      resolution: withManualRepairFieldMeta(z.enum(['delete_orphan_rows']), {
        widget: 'select',
        title: {
          key: 'table:table.integrity.v2.repairMeta.manual.junctionForeignKeyOrphanRows.resolutionLabel',
          fallback: 'Repair strategy',
        },
        description: {
          key: 'table:table.integrity.v2.repairMeta.manual.junctionForeignKeyOrphanRows.resolutionDescription',
          fallback:
            'Invalid junction rows point to records that no longer exist. Confirm deleting those invalid relation rows before restoring the foreign key.',
        },
        options: {
          delete_orphan_rows: {
            value: 'delete_orphan_rows',
            label: {
              key: 'table:table.integrity.v2.repairMeta.manual.junctionForeignKeyOrphanRows.option.deleteOrphanRows',
              fallback: 'Delete invalid relation rows',
            },
          },
        },
      }).default('delete_orphan_rows'),
    }),
    {
      title: {
        key: 'table:table.integrity.v2.repairMeta.manual.junctionForeignKeyOrphanRows.title',
        fallback: 'Clean invalid junction rows',
      },
      description: {
        key: 'table:table.integrity.v2.repairMeta.manual.junctionForeignKeyOrphanRows.description',
        fallback:
          'This repair deletes junction rows that point to missing records, then restores the foreign key constraint.',
      },
      submitLabel: {
        key: 'table:table.integrity.v2.repairMeta.manual.apply',
        fallback: 'Apply manual repair',
      },
    }
  );

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

    const metaIntrospector = new PostgresSchemaIntrospector(ctx.metaDb);
    const tableMetaExists = await metaIntrospector.tableExists('public', 'table_meta');
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
      `.execute(ctx.metaDb);

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

        const equivalentFkExistsResult = await foreignKeyExistsForColumnTarget(
          ctx.db,
          self.junctionTable,
          self.columnName,
          targetTable,
          '__id'
        );
        const equivalentFkExists = yield* equivalentFkExistsResult;

        if (equivalentFkExists) {
          return ok({ valid: true });
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

    const manualRepairSchemaResult = serializeManualRepairSchema(this.orphanRowsManualRepairSchema);

    return ok({
      available: true,
      mode: 'manual',
      reason: {
        key: 'table:table.integrity.v2.repairMeta.reason.junctionForeignKeyOrphanRows',
        values: orphanValues,
        fallback: `The junction rows for "${fieldName}" contain invalid references and need confirmation before cleanup.`,
      },
      description: {
        key: 'table:table.integrity.v2.repairMeta.description.junctionForeignKeyOrphanRows',
        values: orphanValues,
        fallback: `Confirm deleting the invalid junction rows for "${fieldName}" before adding the foreign key back.`,
      },
      manualRepairSchema: manualRepairSchemaResult.isOk()
        ? manualRepairSchemaResult.value
        : undefined,
    });
  }

  async manualRepair(
    ctx: SchemaRuleContext,
    values: SchemaRuleManualRepairValues | undefined,
    options?: SchemaRuleManualRepairOptions
  ): Promise<Result<void, DomainError>> {
    const resolution =
      typeof values?.resolution === 'string' ? values.resolution : 'delete_orphan_rows';

    if (resolution !== 'delete_orphan_rows') {
      return err(
        domainError.validation({
          message: 'Unsupported manual repair strategy',
          details: { resolution },
        })
      );
    }

    if (options?.dryRun) {
      return ok(undefined);
    }

    const resolvedTargetTableResult = await this.resolveTargetTable(ctx);
    if (resolvedTargetTableResult.isErr()) {
      return err(resolvedTargetTableResult.error);
    }

    const resolvedTargetTable = resolvedTargetTableResult.value ?? this.targetTable;

    const targetExistsResult = await ctx.introspector.tableExists(
      resolvedTargetTable.schema,
      resolvedTargetTable.tableName
    );
    if (targetExistsResult.isErr()) {
      return err(targetExistsResult.error);
    }

    if (!targetExistsResult.value) {
      return err(
        domainError.validation({
          message: 'Junction foreign key target table does not exist',
          details: {
            fieldId: this.field.id().toString(),
            targetTable: resolvedTargetTable,
          },
        })
      );
    }

    const deleteResult = await this.deleteOrphanRows(ctx, resolvedTargetTable);
    if (deleteResult.isErr()) {
      return err(deleteResult.error);
    }

    try {
      const createConstraintStatement = createForeignKeyConstraintStatement(
        this.junctionTable,
        this.constraintName,
        this.columnName,
        resolvedTargetTable,
        '__id',
        'CASCADE'
      );
      await ctx.db.executeQuery(createConstraintStatement.compile(ctx.db));
      return ok(undefined);
    } catch (error) {
      return err(
        domainError.infrastructure({
          message: `Failed to restore junction foreign key: ${error instanceof Error ? error.message : String(error)}`,
          code: 'schema.repair_failed',
          details: {
            fieldId: this.field.id().toString(),
            constraintName: this.constraintName,
            junctionTable: this.junctionTable,
            targetTable: resolvedTargetTable,
          },
        })
      );
    }
  }

  private async deleteOrphanRows(
    ctx: SchemaRuleContext,
    targetTable: TableIdentifier
  ): Promise<Result<void, DomainError>> {
    const junctionTableRef = quoteTableIdentifier(this.junctionTable);
    const targetTableRef = quoteTableIdentifier(targetTable);
    const junctionColumnRef = quoteIdentifier(this.columnName);
    const targetColumnRef = quoteIdentifier('__id');

    try {
      await sql
        .raw(
          compressSql(`
          DELETE FROM ${junctionTableRef} AS junction_rows
          WHERE junction_rows.${junctionColumnRef} IS NOT NULL
            AND NOT EXISTS (
              SELECT 1
              FROM ${targetTableRef} AS target_rows
              WHERE target_rows.${targetColumnRef} = junction_rows.${junctionColumnRef}
            )
        `)
        )
        .execute(ctx.db);
      return ok(undefined);
    } catch (error) {
      return err(
        domainError.infrastructure({
          message: `Failed to delete orphan junction rows: ${error instanceof Error ? error.message : String(error)}`,
          code: 'schema.repair_failed',
          details: {
            fieldId: this.field.id().toString(),
            junctionTable: this.junctionTable,
            columnName: this.columnName,
            targetTable,
          },
        })
      );
    }
  }

  up(_ctx: SchemaRuleContext): Result<ReadonlyArray<TableSchemaStatementBuilder>, DomainError> {
    return ok([
      createForeignKeyConstraintStatement(
        this.junctionTable,
        this.constraintName,
        this.columnName,
        this.targetTable,
        '__id',
        'CASCADE',
        this.targetTableMetaId
      ),
    ]);
  }

  down(_ctx: SchemaRuleContext): Result<ReadonlyArray<TableSchemaStatementBuilder>, DomainError> {
    return ok([dropConstraintStatement(this.junctionTable, this.constraintName)]);
  }
}
