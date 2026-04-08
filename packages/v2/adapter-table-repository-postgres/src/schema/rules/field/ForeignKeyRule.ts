import { domainError, type DomainError, type Field } from '@teable/v2-core';
import { err, ok, safeTry } from 'neverthrow';
import type { Result } from 'neverthrow';
import { sql } from 'kysely';

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
  createForeignKeyConstraintStatement,
  createForeignKeyConstraintStatementFromTableMeta,
  dropConstraintStatement,
  type TableIdentifier,
} from '../helpers/StatementBuilders';

/**
 * Schema rule for creating/dropping a foreign key constraint.
 * Depends on both the local column and the target table existing.
 */
export class ForeignKeyRule implements ISchemaRule {
  readonly id: string;
  readonly description: string;
  readonly dependencies: ReadonlyArray<string>;
  readonly required = false;

  /**
   * @param field - The field this FK is for
   * @param columnName - The local column name that holds the FK
   * @param targetTable - The target table identifier
   * @param parent - The parent rule (typically FkColumnRule) this depends on
   * @param targetTableName - Display name of the target table (for description)
   * @param onDelete - ON DELETE action (default: CASCADE)
   */
  constructor(
    private readonly field: Field,
    private readonly columnName: string,
    private readonly targetTable: TableIdentifier,
    parent: ISchemaRule,
    private readonly targetTableName: string,
    private readonly onDelete: 'CASCADE' | 'SET NULL' | 'RESTRICT' = 'CASCADE',
    private readonly localTable?: TableIdentifier,
    private readonly targetTableMetaId?: string
  ) {
    this.id = `fk:${field.id().toString()}:${columnName}`;
    this.dependencies = [parent.id];
    this.description = this.buildDescription();
  }

  private buildDescription(): string {
    const name = this.field.name().toString();
    return `Foreign key constraint on "${name}" (${this.columnName}) → ${this.targetTableName}.__id (ON DELETE ${this.onDelete})`;
  }

  /**
   * Creates a ForeignKeyRule for a link field.
   */
  static forField(
    field: Field,
    columnName: string,
    targetTable: TableIdentifier,
    parent: ISchemaRule,
    targetTableName: string,
    onDelete: 'CASCADE' | 'SET NULL' | 'RESTRICT' = 'CASCADE',
    localTable?: TableIdentifier,
    targetTableMetaId?: string
  ): ForeignKeyRule {
    return new ForeignKeyRule(
      field,
      columnName,
      targetTable,
      parent,
      targetTableName,
      onDelete,
      localTable,
      targetTableMetaId
    );
  }

  private get constraintName(): string {
    return `fk_${this.columnName}`;
  }

  private getLocalTable(ctx: SchemaRuleContext): TableIdentifier {
    return this.localTable ?? { schema: ctx.schema, tableName: ctx.tableName };
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
          message: `Failed to resolve foreign key target table: ${error instanceof Error ? error.message : String(error)}`,
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
    const constraintName = this.constraintName;
    const localTable = this.getLocalTable(ctx);
    const fieldName = this.field.name().toString();
    const targetTableName = this.targetTableName;
    return safeTry<SchemaRuleValidationResult, DomainError>(async function* () {
      const existsResult = await ctx.introspector.foreignKeyExists(
        localTable.schema,
        localTable.tableName,
        constraintName
      );
      const exists = yield* existsResult;

      if (!exists) {
        const resolvedTargetTableResult = await self.resolveTargetTable(ctx);
        const resolvedTargetTable = yield* resolvedTargetTableResult;
        const targetTable = resolvedTargetTable ?? self.targetTable;
        const targetPhysicalTableName = targetTable.tableName;
        const targetTableSchema = targetTable.schema;
        const targetExistsResult = await ctx.introspector.tableExists(
          targetTableSchema,
          targetPhysicalTableName
        );
        const targetExists = yield* targetExistsResult;

        if (!targetExists) {
          return ok({
            valid: false,
            missing: [
              `foreign key constraint ${constraintName}`,
              `target table ${targetPhysicalTableName} does not exist`,
            ],
            missingItems: [
              {
                code: 'foreign_key_missing',
                message: {
                  key: 'table:table.integrity.v2.detail.foreignKeyMissing',
                  values: {
                    fieldName,
                  },
                  fallback: `Field "${fieldName}" is missing its foreign key constraint.`,
                },
                description: {
                  key: 'table:table.integrity.v2.detail.foreignKeyMissingDescription',
                  values: {
                    fieldName,
                    targetTableName,
                  },
                  fallback: `Without the foreign key constraint, "${fieldName}" can reference rows that no longer exist in ${targetTableName}.`,
                },
              },
              {
                code: 'foreign_key_target_table_missing',
                message: {
                  key: 'table:table.integrity.v2.detail.foreignKeyTargetTableMissing',
                  values: {
                    fieldName,
                    targetTableName,
                  },
                  fallback: `The linked table for "${fieldName}" no longer exists.`,
                },
                description: {
                  key: 'table:table.integrity.v2.detail.foreignKeyTargetTableMissingDescription',
                  values: {
                    fieldName,
                    targetTableName,
                    targetPhysicalTableName,
                  },
                  fallback: `Automatic repair cannot recreate the foreign key because the target table "${targetPhysicalTableName}" is missing.`,
                },
              },
            ],
          });
        }

        const orphanCountResult = await countOrphanForeignKeyRows(
          ctx.db,
          localTable,
          self.columnName,
          targetTable,
          '__id'
        );
        const orphanCount = yield* orphanCountResult;

        if (orphanCount > 0) {
          return ok({
            valid: false,
            missing: [
              `foreign key constraint ${constraintName}`,
              `${orphanCount} orphan rows in ${localTable.tableName}.${self.columnName}`,
            ],
            missingItems: [
              {
                code: 'foreign_key_missing',
                message: {
                  key: 'table:table.integrity.v2.detail.foreignKeyMissing',
                  values: {
                    fieldName,
                  },
                  fallback: `Field "${fieldName}" is missing its foreign key constraint.`,
                },
                description: {
                  key: 'table:table.integrity.v2.detail.foreignKeyMissingDescription',
                  values: {
                    fieldName,
                    targetTableName,
                  },
                  fallback: `Without the foreign key constraint, "${fieldName}" can reference rows that no longer exist in ${targetTableName}.`,
                },
              },
              {
                code: 'foreign_key_orphan_rows',
                message: {
                  key: 'table:table.integrity.v2.detail.foreignKeyOrphanRows',
                  values: {
                    fieldName,
                    count: orphanCount,
                  },
                  fallback: `Field "${fieldName}" has ${orphanCount} rows pointing to missing linked records.`,
                },
                description: {
                  key: 'table:table.integrity.v2.detail.foreignKeyOrphanRowsDescription',
                  values: {
                    fieldName,
                    count: orphanCount,
                    targetTableName,
                  },
                  fallback: `Automatic repair cannot restore the foreign key for "${fieldName}" until ${orphanCount} invalid references to ${targetTableName} are cleaned up.`,
                },
              },
            ],
          });
        }
      }

      return ok({
        valid: exists,
        missing: exists ? [] : [`foreign key constraint ${constraintName}`],
        missingItems: exists
          ? []
          : [
              {
                code: 'foreign_key_missing',
                message: {
                  key: 'table:table.integrity.v2.detail.foreignKeyMissing',
                  values: {
                    fieldName,
                  },
                  fallback: `Field "${fieldName}" is missing its foreign key constraint.`,
                },
                description: {
                  key: 'table:table.integrity.v2.detail.foreignKeyMissingDescription',
                  values: {
                    fieldName,
                    targetTableName,
                  },
                  fallback: `Without the foreign key constraint, "${fieldName}" can reference rows that no longer exist in ${targetTableName}.`,
                },
              },
            ],
      });
    });
  }

  getRepairHint(
    _ctx: SchemaRuleContext,
    validation: SchemaRuleValidationResult
  ): Result<SchemaRuleRepairHint | undefined, DomainError> {
    const targetTableMissing = validation.missingItems?.some(
      (item) => item.code === 'foreign_key_target_table_missing'
    );
    const orphanRowsDetected = validation.missingItems?.some(
      (item) => item.code === 'foreign_key_orphan_rows'
    );

    if (!targetTableMissing && !orphanRowsDetected) {
      return ok(undefined);
    }

    const fieldName = this.field.name().toString();
    const targetTableName = this.targetTableName;
    const targetPhysicalTableName = this.targetTable.tableName;

    if (targetTableMissing) {
      return ok({
        available: false,
        mode: 'auto',
        reason: {
          key: 'table:table.integrity.v2.repairMeta.reason.foreignKeyTargetTableMissing',
          values: {
            fieldName,
            targetTableName,
          },
          fallback: `Automatic repair is unavailable because the linked table for "${fieldName}" is missing.`,
        },
        description: {
          key: 'table:table.integrity.v2.repairMeta.description.foreignKeyTargetTableMissing',
          values: {
            fieldName,
            targetTableName,
            targetPhysicalTableName,
          },
          fallback: `Check whether the linked table "${targetPhysicalTableName}" was deleted or renamed. Recreate the table, or update/remove the link field configuration for "${fieldName}", then run the check again.`,
        },
      });
    }

    const orphanItem = validation.missingItems?.find(
      (item) => item.code === 'foreign_key_orphan_rows'
    );
    const orphanCount =
      typeof orphanItem?.message?.values?.count === 'number'
        ? orphanItem.message.values.count
        : undefined;
    const orphanValues: Readonly<Record<string, SchemaRuleI18nValue>> =
      orphanCount == null
        ? {
            fieldName,
            targetTableName,
          }
        : {
            fieldName,
            targetTableName,
            count: orphanCount,
          };

    return ok({
      available: false,
      mode: 'auto',
      reason: {
        key: 'table:table.integrity.v2.repairMeta.reason.foreignKeyOrphanRows',
        values: orphanValues,
        fallback: `Automatic repair is unavailable because "${fieldName}" still has invalid linked rows.`,
      },
      description: {
        key: 'table:table.integrity.v2.repairMeta.description.foreignKeyOrphanRows',
        values: orphanValues,
        fallback: `Clean up the invalid linked rows for "${fieldName}" before adding the foreign key constraint again.`,
      },
    });
  }

  up(ctx: SchemaRuleContext): Result<ReadonlyArray<TableSchemaStatementBuilder>, DomainError> {
    const sourceTable = this.getLocalTable(ctx);
    return ok([
      this.targetTableMetaId
        ? createForeignKeyConstraintStatementFromTableMeta(
            sourceTable,
            this.constraintName,
            this.columnName,
            this.targetTableMetaId,
            '__id',
            this.onDelete,
            this.targetTable
          )
        : createForeignKeyConstraintStatement(
            sourceTable,
            this.constraintName,
            this.columnName,
            this.targetTable,
            '__id',
            this.onDelete
          ),
    ]);
  }

  down(ctx: SchemaRuleContext): Result<ReadonlyArray<TableSchemaStatementBuilder>, DomainError> {
    const table = this.getLocalTable(ctx);
    return ok([dropConstraintStatement(table, this.constraintName)]);
  }
}
