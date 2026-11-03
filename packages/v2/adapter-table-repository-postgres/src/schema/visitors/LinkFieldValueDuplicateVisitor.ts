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
 * - OneMany (two-way): INSERT INTO new_junction SELECT FROM foreign FK host
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
    const { sourceField } = this.ctx;
    const relationship = sourceField.relationship().toString();

    // Determine if this is a junction table or FK column scenario
    const usesJunctionTable =
      relationship === 'manyMany' || (relationship === 'oneMany' && sourceField.isOneWay());

    if (usesJunctionTable) {
      return this.generateJunctionTableCopy();
    }

    if (relationship === 'oneMany') {
      return this.generateReverseOneManyCopy();
    }

    // ManyOne and OneOne retain FK-column storage.
    return this.generateFkColumnCopy();
  }

  /**
   * Generates INSERT INTO new_junction SELECT FROM old_junction.
   * Used for ManyMany and one-way OneMany relationships.
   */
  private generateJunctionTableCopy(): Result<ReadonlyArray<CompiledQuery>, DomainError> {
    const visitor = this; // NOSONAR typescript:S7740 -- generator functions cannot be arrow functions, so `this` must be captured
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

  private generateReverseOneManyCopy(): Result<ReadonlyArray<CompiledQuery>, DomainError> {
    const visitor = this; // NOSONAR typescript:S7740 -- generator functions cannot be arrow functions, so `this` must be captured
    return safeTry<ReadonlyArray<CompiledQuery>, DomainError>(function* () {
      const sourceTable = yield* visitor.getJunctionTableName(visitor.ctx.sourceField);
      const targetTable = yield* visitor.getJunctionTableName(visitor.ctx.newField);
      const sourceSelfKey = yield* visitor.ctx.sourceField.selfKeyNameString();
      const sourceForeignKey = yield* visitor.ctx.sourceField.foreignKeyNameString();
      const targetSelfKey = yield* visitor.ctx.newField.selfKeyNameString();
      const targetForeignKey = yield* visitor.ctx.newField.foreignKeyNameString();
      const sourceColumns = [sql.ref(sourceSelfKey), sql.ref(sourceForeignKey)];
      const targetColumns = [sql.ref(targetSelfKey), sql.ref(targetForeignKey)];

      if (visitor.ctx.sourceField.hasOrderColumn() && visitor.ctx.newField.hasOrderColumn()) {
        const sourceOrderColumn = yield* visitor.ctx.sourceField.orderColumnName();
        const targetOrderColumn = yield* visitor.ctx.newField.orderColumnName();
        sourceColumns.push(sql.ref(sourceOrderColumn));
        targetColumns.push(sql.ref(targetOrderColumn));
      }

      const query = sql`
        INSERT INTO ${sql.raw(targetTable)} (${sql.join(targetColumns)})
        SELECT ${sql.join(sourceColumns)}
        FROM ${sql.raw(sourceTable)}
        WHERE ${sql.ref(sourceSelfKey)} IS NOT NULL
      `.compile(visitor.db);

      return ok([query]);
    });
  }

  /**
   * Generates UPDATE table SET __fk_new = __fk_old.
   * Used for ManyOne and OneOne relationships.
   */
  private generateFkColumnCopy(): Result<ReadonlyArray<CompiledQuery>, DomainError> {
    const visitor = this; // NOSONAR typescript:S7740 -- generator functions cannot be arrow functions, so `this` must be captured
    return safeTry<ReadonlyArray<CompiledQuery>, DomainError>(function* () {
      const sourceFkName = yield* visitor.ctx.sourceField.foreignKeyNameString();
      const newFkName = yield* visitor.ctx.newField.foreignKeyNameString();
      const isReverse = sourceFkName === '__id';
      const assignments = [
        sql`${sql.ref(newFkName)} = ${sql.ref(isReverse ? `source.${sourceFkName}` : sourceFkName)}`,
      ];

      if (visitor.ctx.sourceField.hasOrderColumn() && visitor.ctx.newField.hasOrderColumn()) {
        const sourceOrderColumn = yield* visitor.ctx.sourceField.orderColumnName();
        const targetOrderColumn = yield* visitor.ctx.newField.orderColumnName();
        assignments.push(
          sql`${sql.ref(targetOrderColumn)} = ${sql.ref(isReverse ? `source.${sourceOrderColumn}` : sourceOrderColumn)}`
        );
      }

      if (isReverse) {
        const sourceTable = yield* visitor.getJunctionTableName(visitor.ctx.sourceField);
        const sourceSelfKey = yield* visitor.ctx.sourceField.selfKeyNameString();
        const query = sql`
          UPDATE ${sql.raw(visitor.fullTableName)} AS target
          SET ${sql.join(assignments)}
          FROM ${sql.raw(sourceTable)} AS source
          WHERE ${sql.ref('target.__id')} = ${sql.ref(`source.${sourceSelfKey}`)}
        `.compile(visitor.db);
        return ok([query]);
      }

      const query = sql`
        UPDATE ${sql.raw(visitor.fullTableName)}
        SET ${sql.join(assignments)}
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
