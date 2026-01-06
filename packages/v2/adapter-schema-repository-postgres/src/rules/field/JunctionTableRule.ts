import type { DomainError } from '@teable/v2-core';
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
  orderColumnName: string;
  /** The current (source) table identifier */
  sourceTable: TableIdentifier;
  /** The foreign (target) table identifier */
  foreignTable: TableIdentifier;
  /** Whether to add indexes (default: true for ManyMany, false for OneWay) */
  withIndexes?: boolean;
}

/**
 * Schema rule for creating/dropping a junction table for ManyMany or OneWay relationships.
 * Junction tables are standalone tables that link two main tables.
 */
export class JunctionTableRule implements ISchemaRule {
  readonly id: string;
  readonly description: string;
  readonly dependencies: ReadonlyArray<string> = [];
  readonly required = true;

  constructor(
    private readonly fieldId: string,
    private readonly config: JunctionTableConfig,
    private readonly options: {
      fieldName?: string;
      relationshipType?: 'manyMany' | 'oneWay' | 'oneOne';
      sourceTableName?: string;
      foreignTableName?: string;
    } = {}
  ) {
    this.id = `junction_table:${fieldId}`;
    this.description = this.buildDescription();
  }

  private buildDescription(): string {
    const name = this.options.fieldName ?? this.fieldId;
    const relationship = this.options.relationshipType ?? 'manyMany';
    const source = this.options.sourceTableName ?? this.config.sourceTable.tableName;
    const foreign = this.options.foreignTableName ?? this.config.foreignTable.tableName;

    const relationshipDesc =
      relationship === 'manyMany'
        ? 'many-to-many'
        : relationship === 'oneWay'
          ? 'one-way'
          : 'one-to-one';

    return `Junction table "${this.config.junctionTable.tableName}" for ${relationshipDesc} link "${name}" (${source} ↔ ${foreign})`;
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
        // If table doesn't exist, no need to check columns/constraints
        return ok({ valid: false, missing });
      }

      // 2. Check required columns exist
      const requiredColumns = [
        '__id',
        config.selfKeyName,
        config.foreignKeyName,
        config.orderColumnName,
      ];

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

      // 3. Check unique constraint exists
      const uniqueConstraintName = `uniq_${config.selfKeyName}_${config.foreignKeyName}`;
      const uniqueConstraintResult = await ctx.introspector.constraintExists(
        junctionTable.schema,
        junctionTable.tableName,
        uniqueConstraintName
      );
      const uniqueConstraintExists = yield* uniqueConstraintResult;
      if (!uniqueConstraintExists) {
        missing.push(`unique constraint "${uniqueConstraintName}" on junction table`);
      }

      // 4. Check indexes if configured
      if (config.withIndexes !== false) {
        const selfKeyIndexName = `index_${config.selfKeyName}`;
        const foreignKeyIndexName = `index_${config.foreignKeyName}`;

        const selfIndexResult = await ctx.introspector.indexExists(
          junctionTable.schema,
          selfKeyIndexName
        );
        const selfIndexExists = yield* selfIndexResult;
        if (!selfIndexExists) {
          missing.push(`index "${selfKeyIndexName}" on junction table`);
        }

        const foreignIndexResult = await ctx.introspector.indexExists(
          junctionTable.schema,
          foreignKeyIndexName
        );
        const foreignIndexExists = yield* foreignIndexResult;
        if (!foreignIndexExists) {
          missing.push(`index "${foreignKeyIndexName}" on junction table`);
        }
      }

      // 5. Check foreign key constraints
      const selfFkConstraintName = `fk_${config.selfKeyName}`;
      const foreignFkConstraintName = `fk_${config.foreignKeyName}`;

      const selfFkResult = await ctx.introspector.foreignKeyExists(
        junctionTable.schema,
        junctionTable.tableName,
        selfFkConstraintName
      );
      const selfFkExists = yield* selfFkResult;
      if (!selfFkExists) {
        missing.push(
          `foreign key "${selfFkConstraintName}" → ${config.sourceTable.tableName}.__id`
        );
      }

      const foreignFkResult = await ctx.introspector.foreignKeyExists(
        junctionTable.schema,
        junctionTable.tableName,
        foreignFkConstraintName
      );
      const foreignFkExists = yield* foreignFkResult;
      if (!foreignFkExists) {
        missing.push(
          `foreign key "${foreignFkConstraintName}" → ${config.foreignTable.tableName}.__id`
        );
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

    const uniqueConstraintName = `uniq_${config.selfKeyName}_${config.foreignKeyName}`;
    const builder = schemaBuilder
      .createTable(config.junctionTable.tableName)
      .ifNotExists()
      .addColumn('__id', 'serial', (col) => col.primaryKey())
      .addColumn(config.selfKeyName, 'text')
      .addColumn(config.foreignKeyName, 'text')
      .addColumn(config.orderColumnName, 'double precision')
      .addUniqueConstraint(uniqueConstraintName, [config.selfKeyName, config.foreignKeyName]);

    const statements: TableSchemaStatementBuilder[] = [builder];

    // Add indexes if configured
    if (config.withIndexes !== false) {
      const selfKeyIndexName = `index_${config.selfKeyName}`;
      const foreignKeyIndexName = `index_${config.foreignKeyName}`;
      statements.push(
        createIndexStatement(config.junctionTable, selfKeyIndexName, config.selfKeyName),
        createIndexStatement(config.junctionTable, foreignKeyIndexName, config.foreignKeyName)
      );
    }

    // Add FK constraints
    const selfFkConstraintName = `fk_${config.selfKeyName}`;
    const foreignFkConstraintName = `fk_${config.foreignKeyName}`;

    statements.push(
      createForeignKeyConstraintStatement(
        config.junctionTable,
        selfFkConstraintName,
        config.selfKeyName,
        config.sourceTable,
        '__id',
        'CASCADE'
      ),
      createForeignKeyConstraintStatement(
        config.junctionTable,
        foreignFkConstraintName,
        config.foreignKeyName,
        config.foreignTable,
        '__id',
        'CASCADE'
      )
    );

    return ok(statements);
  }

  down(_ctx: SchemaRuleContext): Result<ReadonlyArray<TableSchemaStatementBuilder>, DomainError> {
    // DROP TABLE CASCADE will automatically drop FK constraints and indexes
    return ok([dropTableStatement(this.config.junctionTable)]);
  }
}
