import { domainError, type DomainError, type Table } from '@teable/v2-core';
import { err, ok, type Result } from 'neverthrow';

export const toInfrastructureError = (error: unknown, message: string): DomainError =>
  domainError.infrastructure({
    message,
    details: { error: error instanceof Error ? error.message : String(error) },
  });

export const getTablePhysicalName = (
  table: Table
): Result<{ schema: string; tableName: string }, DomainError> => {
  const dbTableName = table.dbTableName();
  if (dbTableName.isErr()) return err(dbTableName.error);
  const split = dbTableName.value.split({ defaultSchema: table.baseId().toString() });
  if (split.isErr()) return err(split.error);
  if (!split.value.schema) {
    return err(domainError.validation({ message: 'Table physical schema is missing' }));
  }
  return ok({ schema: split.value.schema, tableName: split.value.tableName });
};

export const quoteIdentifier = (value: string): string => `"${value.replace(/"/g, '""')}"`;

export const makePhysicalTableSql = (schema: string, tableName: string): string =>
  `${quoteIdentifier(schema)}.${quoteIdentifier(tableName)}`;
