import { domainError, type DomainError, type LinkField } from '@teable/v2-core';
import type { V1TeableDatabase } from '@teable/v2-postgres-schema';
import type { CompiledQuery, Kysely } from 'kysely';
import { sql } from 'kysely';
import { err, ok, safeTry } from 'neverthrow';
import type { Result } from 'neverthrow';

type LinkFieldValueDuplicateVisitorContext = {
  sourceField: LinkField;
  newField: LinkField;
  schema: string | null;
  tableName: string;
};

/**
 * Generates SQL statements for duplicating link field values.
 *
 * SQL strategies by relationship type:
 * - ManyMany: INSERT INTO new_junction SELECT FROM old_junction
 * - OneMany (one-way): INSERT INTO new_junction SELECT FROM old_junction
 * - ManyOne/OneOne: UPDATE table SET __fk_new = __fk_old
 *
 * Core principle: Push duplication to SQL layer rather than JS-layer query-then-update.
 */
export class LinkFieldValueDuplicateVisitor {
  private constructor(
    private readonly db: Kysely<V1TeableDatabase>,
    private readonly ctx: LinkFieldValueDuplicateVisitorContext
  ) {}

  static create(
    db: Kysely<V1TeableDatabase>,
    ctx: LinkFieldValueDuplicateVisitorContext
  ): LinkFieldValueDuplicateVisitor {
    return new LinkFieldValueDuplicateVisitor(db, ctx);
  }

  private get fullTableName(): string {
    return this.ctx.schema
      ? `"${this.ctx.schema}"."${this.ctx.tableName}"`
      : `"${this.ctx.tableName}"`;
  }

  generateStatements(): Result<ReadonlyArray<CompiledQuery>, DomainError> {
    const { sourceField, newField } = this.ctx;
    const relationship = sourceField.relationship().toString();

    // Determine if this is a junction table or FK column scenario
    const usesJunctionTable =
      relationship === 'manyMany' || (relationship === 'oneMany' && sourceField.isOneWay());

    if (usesJunctionTable) {
      return this.generateJunctionTableCopy();
    }

    // For ManyOne, OneOne, and two-way OneMany, FK is stored in the main table
    return this.generateFkColumnCopy();
  }

  /**
   * Generates INSERT INTO new_junction SELECT FROM old_junction.
   * Used for ManyMany and one-way OneMany relationships.
   */
  private generateJunctionTableCopy(): Result<ReadonlyArray<CompiledQuery>, DomainError> {
    const visitor = this;
    return safeTry<ReadonlyArray<CompiledQuery>, DomainError>(function* () {
      const sourceJunctionTable = yield* visitor.getJunctionTableName(visitor.ctx.sourceField);
      const newJunctionTable = yield* visitor.getJunctionTableName(visitor.ctx.newField);

      const sourceSelfKeyName = yield* visitor.ctx.sourceField.selfKeyNameString();
      const sourceForeignKeyName = yield* visitor.ctx.sourceField.foreignKeyNameString();
      const newSelfKeyName = yield* visitor.ctx.newField.selfKeyNameString();
      const newForeignKeyName = yield* visitor.ctx.newField.foreignKeyNameString();

      // Build column list - include order column if present
      const sourceColumns = [`"${sourceSelfKeyName}"`, `"${sourceForeignKeyName}"`];
      const targetColumns = [`"${newSelfKeyName}"`, `"${newForeignKeyName}"`];

      if (visitor.ctx.sourceField.hasOrderColumn() && visitor.ctx.newField.hasOrderColumn()) {
        const sourceOrderCol = yield* visitor.ctx.sourceField.orderColumnName();
        const newOrderCol = yield* visitor.ctx.newField.orderColumnName();
        sourceColumns.push(`"${sourceOrderCol}"`);
        targetColumns.push(`"${newOrderCol}"`);
      }

      const query = sql`
        INSERT INTO ${sql.raw(newJunctionTable)} (${sql.raw(targetColumns.join(', '))})
        SELECT ${sql.raw(sourceColumns.join(', '))}
        FROM ${sql.raw(sourceJunctionTable)}
      `.compile(visitor.db);

      return ok([query]);
    });
  }

  /**
   * Generates UPDATE table SET __fk_new = __fk_old.
   * Used for ManyOne, OneOne, and two-way OneMany relationships where FK is in main table.
   */
  private generateFkColumnCopy(): Result<ReadonlyArray<CompiledQuery>, DomainError> {
    const visitor = this;
    return safeTry<ReadonlyArray<CompiledQuery>, DomainError>(function* () {
      const sourceFkName = yield* visitor.ctx.sourceField.selfKeyNameString();
      const newFkName = yield* visitor.ctx.newField.selfKeyNameString();

      const query = sql`
        UPDATE ${sql.raw(visitor.fullTableName)}
        SET "${sql.raw(newFkName)}" = "${sql.raw(sourceFkName)}"
      `.compile(visitor.db);

      return ok([query]);
    });
  }

  private getJunctionTableName(field: LinkField): Result<string, DomainError> {
    return field.fkHostTableNameString().andThen((tableName) => {
      if (!tableName.includes('.')) {
        return ok(`"${tableName}"`);
      }
      const [schema, table] = tableName.split('.');
      if (!schema || !table) {
        return err(domainError.unexpected({ message: 'Invalid junction table name' }));
      }
      return ok(`"${schema}"."${table}"`);
    });
  }
}
