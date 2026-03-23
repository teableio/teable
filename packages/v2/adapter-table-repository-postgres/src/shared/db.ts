import type { Kysely, Transaction, CompiledQuery } from 'kysely';

import type { TableSchemaStatementBuilder } from '../schema/rules/core';
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

export const executeTableSchemaStatements = async <DB>(
  db: Kysely<DB> | Transaction<DB>,
  statements: ReadonlyArray<TableSchemaStatementBuilder>
): Promise<void> => {
  await executeCompiledQueries(
    db,
    statements.map((statement) => statement.compile(db))
  );
};
