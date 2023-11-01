/* eslint-disable @typescript-eslint/naming-convention */
import type { Provider } from '@nestjs/common';
import { DriverClient } from '@teable-group/core';
import type { Knex } from 'knex';
import { getDriverName } from '../utils/db-helpers';
import { PostgresProvider } from './postgres.provider';
import { SqliteProvider } from './sqlite.provider';

export const DbProvider: Provider = {
  provide: 'DbProvider',
  useFactory: (knex: Knex) => {
    const driverClient = getDriverName(knex);

    switch (driverClient) {
      case DriverClient.Sqlite:
        return new SqliteProvider(knex);
      case DriverClient.Pg:
        return new PostgresProvider(knex);
    }
  },
  inject: ['CUSTOM_KNEX'],
};
