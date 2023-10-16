/* eslint-disable @typescript-eslint/naming-convention */
import type { Provider } from '@nestjs/common';
import { DriverClient } from '@teable-group/core';
import type { Knex } from 'knex';
import { PostgresProvider } from './postgres.provider';
import { SqliteProvider } from './sqlite.provider';

export const DbProvider: Provider = {
  provide: 'DbProvider',
  useFactory: async (knex: Knex) => {
    const driverClient = knex.client.config?.client as DriverClient;

    switch (driverClient) {
      case DriverClient.SQLITE:
        return new SqliteProvider(knex);
      case DriverClient.PG:
        return new PostgresProvider(knex);
    }
  },
  inject: ['default'],
};
