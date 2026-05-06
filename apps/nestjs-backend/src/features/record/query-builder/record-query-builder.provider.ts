import type { Provider } from '@nestjs/common';
import { Inject } from '@nestjs/common';
import { DriverClient } from '@teable/core';
import type { Knex } from 'knex';
import { DATA_KNEX } from '../../../global/knex/knex.module';
import { getDriverName } from '../../../utils/db-helpers';
import { PgRecordQueryDialect } from './providers/pg-record-query-dialect';
import { RECORD_QUERY_BUILDER_SYMBOL } from './record-query-builder.symbol';
import {
  RECORD_QUERY_DIALECT_SYMBOL,
  type IRecordQueryDialectProvider,
} from './record-query-dialect.interface';

// eslint-disable-next-line @typescript-eslint/naming-convention
export const InjectRecordQueryBuilder = () => Inject(RECORD_QUERY_BUILDER_SYMBOL);

// eslint-disable-next-line @typescript-eslint/naming-convention
export const InjectRecordQueryDialect = () => Inject(RECORD_QUERY_DIALECT_SYMBOL);

// eslint-disable-next-line @typescript-eslint/naming-convention
export const RecordQueryDialectProvider: Provider = {
  provide: RECORD_QUERY_DIALECT_SYMBOL,
  useFactory: (knex: Knex): IRecordQueryDialectProvider => {
    const driverClient = getDriverName(knex);
    switch (driverClient) {
      case DriverClient.Pg:
        return new PgRecordQueryDialect(knex);
      default:
        throw new Error(`Unsupported database driver: ${driverClient}`);
    }
  },
  inject: [DATA_KNEX],
};
