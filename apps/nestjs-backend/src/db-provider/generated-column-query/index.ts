import { DriverClient } from '@teable/core';
import { match } from 'ts-pattern';
import { GeneratedColumnQuerySupportValidatorPostgres } from './postgres/generated-column-query-support-validator.postgres';

export function createGeneratedColumnQuerySupportValidator(driver: DriverClient) {
  return match(driver)
    .with(DriverClient.Pg, () => new GeneratedColumnQuerySupportValidatorPostgres())
    .exhaustive();
}
