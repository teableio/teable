import type { V1TeableDatabase } from '@teable/v2-postgres-schema';
import { domainError } from '@teable/v2-core';
import type {
  DomainError,
  IExecutionContext,
  IRecordOrderCalculator,
  RecordId,
  Table,
  ViewId,
} from '@teable/v2-core';
import { inject, injectable } from '@teable/v2-di';
import { sql, type Kysely } from 'kysely';
import { err, ok, safeTry } from 'neverthrow';
import type { Result } from 'neverthrow';

import { v2RecordRepositoryPostgresTokens } from '../di/tokens';
import type { DynamicDB } from '../query-builder';
import { resolvePostgresDb } from '../../shared/db';

@injectable()
export class PostgresRecordOrderCalculator implements IRecordOrderCalculator {
  constructor(
    @inject(v2RecordRepositoryPostgresTokens.db)
    private readonly db: Kysely<V1TeableDatabase>
  ) {}

  async calculateOrders(
    context: IExecutionContext,
    table: Table,
    viewId: ViewId,
    anchorId: RecordId,
    position: 'before' | 'after',
    count: number
  ): Promise<Result<ReadonlyArray<number>, DomainError>> {
    if (count <= 0) return ok([]);

    return safeTry<ReadonlyArray<number>, DomainError>(
      async function* (this: PostgresRecordOrderCalculator) {
        const dbTableName = yield* table.dbTableName();
        const tableName = yield* dbTableName.value();
        const dynamicDb = resolvePostgresDb(this.db, context) as unknown as Kysely<DynamicDB>;

        try {
          const viewIdStr = viewId.toString();
          await this.ensureOrderColumnExists(dynamicDb, tableName, viewIdStr);

          const orderColumnName = `__row_${viewIdStr}`;
          const anchorResult = await sql<{ order_val: number }>`
          SELECT ${sql.id(orderColumnName)} as order_val
          FROM ${sql.table(tableName)}
          WHERE __id = ${anchorId.toString()}
        `.execute(dynamicDb);

          if (anchorResult.rows.length === 0) {
            return err(
              domainError.notFound({
                code: 'record.not_found',
                message: `Anchor record not found: ${anchorId.toString()}`,
              })
            );
          }

          const anchorOrder = anchorResult.rows[0]!.order_val;
          let adjacentResult;
          if (position === 'before') {
            adjacentResult = await sql<{ order_val: number }>`
            SELECT ${sql.id(orderColumnName)} as order_val
            FROM ${sql.table(tableName)}
            WHERE ${sql.id(orderColumnName)} < ${anchorOrder}
            ORDER BY ${sql.id(orderColumnName)} DESC
            LIMIT 1
          `.execute(dynamicDb);
          } else {
            adjacentResult = await sql<{ order_val: number }>`
            SELECT ${sql.id(orderColumnName)} as order_val
            FROM ${sql.table(tableName)}
            WHERE ${sql.id(orderColumnName)} > ${anchorOrder}
            ORDER BY ${sql.id(orderColumnName)} ASC
            LIMIT 1
          `.execute(dynamicDb);
          }

          const adjacentOrder =
            adjacentResult.rows.length > 0
              ? adjacentResult.rows[0]!.order_val
              : position === 'before'
                ? anchorOrder - 1
                : anchorOrder + 1;

          const gap = Math.abs((anchorOrder - adjacentOrder) / (count + 1));
          if (gap < Number.EPSILON * 2) {
            await this.shuffleRecords(dynamicDb, tableName, orderColumnName);
            const retry = await this.calculateOrders(
              context,
              table,
              viewId,
              anchorId,
              position,
              count
            );
            if (retry.isErr()) return err(retry.error);
            return ok(retry.value);
          }

          const base = position === 'before' ? adjacentOrder : anchorOrder;
          return ok(Array.from({ length: count }, (_, i) => base + gap * (i + 1)));
        } catch (error) {
          return err(
            domainError.unexpected({
              message: error instanceof Error ? error.message : 'Failed to calculate record order',
              code: 'record_order.calculate_failed',
            })
          );
        }
      }.bind(this)
    );
  }

  private async checkOrderColumnExists(
    db: Kysely<DynamicDB>,
    tableName: string,
    orderColumnName: string
  ): Promise<boolean> {
    const [schemaName, tableNameOnly] = tableName.split('.');
    const result = await sql<{ column_name: string }>`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_schema = ${schemaName}
      AND table_name = ${tableNameOnly}
      AND column_name = ${orderColumnName}
    `.execute(db);

    return result.rows.length > 0;
  }

  private async ensureOrderColumnExists(
    db: Kysely<DynamicDB>,
    tableName: string,
    viewId: string
  ): Promise<void> {
    const orderColumnName = `__row_${viewId}`;
    const exists = await this.checkOrderColumnExists(db, tableName, orderColumnName);

    if (!exists) {
      await sql`
        ALTER TABLE ${sql.table(tableName)}
        ADD COLUMN ${sql.id(orderColumnName)} double precision
      `.execute(db);

      await sql`
        UPDATE ${sql.table(tableName)}
        SET ${sql.id(orderColumnName)} = __auto_number
      `.execute(db);

      const [, tableNameOnly] = tableName.split('.');
      const indexName = `idx_${tableNameOnly}_${orderColumnName}`;
      await sql`
        CREATE INDEX ${sql.id(indexName)}
        ON ${sql.table(tableName)} (${sql.id(orderColumnName)})
      `.execute(db);
    }
  }

  private async shuffleRecords(
    db: Kysely<DynamicDB>,
    tableName: string,
    orderColumnName: string
  ): Promise<void> {
    await sql`
      UPDATE ${sql.table(tableName)}
      SET ${sql.id(orderColumnName)} = temp.new_order
      FROM (
        SELECT __id, ROW_NUMBER() OVER (ORDER BY ${sql.id(orderColumnName)}) AS new_order
        FROM ${sql.table(tableName)}
      ) AS temp
      WHERE ${sql.table(tableName)}.__id = temp.__id
    `.execute(db);
  }
}
