import type { Kysely, Transaction, CompiledQuery } from 'kysely';
export {
  getPostgresTransaction,
  resolvePostgresDbOrTx,
} from '@teable/v2-adapter-db-postgres-shared';

export const executeCompiledQueries = async <DB>(
  db: Kysely<DB> | Transaction<DB>,
  compiled: ReadonlyArray<CompiledQuery>
): Promise<void> => {
  for (const statement of compiled) {
    await db.executeQuery(statement);
  }
};
