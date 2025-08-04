import { DriverClient } from '@teable/core';
import { match } from 'ts-pattern';
import { GeneratedColumnQuerySupportValidatorPostgres } from './postgres/generated-column-query-support-validator.postgres';
import { GeneratedColumnQuerySupportValidatorSqlite } from './sqlite/generated-column-query-support-validator.sqlite';

export function createGeneratedColumnQuerySupportValidator(driver: DriverClient) {
  return match(driver)
    .with(DriverClient.Pg, () => new GeneratedColumnQuerySupportValidatorPostgres())
    .with(DriverClient.Sqlite, () => new GeneratedColumnQuerySupportValidatorSqlite())
    .exhaustive();
}
