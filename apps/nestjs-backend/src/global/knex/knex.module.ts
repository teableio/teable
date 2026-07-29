import type { DynamicModule } from '@nestjs/common';
import { Module } from '@nestjs/common';
import {
  getDatabaseUrl,
  type IPgPoolLease,
  PgPoolRegistry,
  PrismaModule,
} from '@teable/db-main-prisma';
import createKnex from 'knex';
import type { Knex } from 'knex';
import type { PoolClient } from 'pg';
export const META_KNEX = 'META_KNEX';
export const DATA_KNEX = 'DATA_KNEX';
export const CUSTOM_KNEX = 'CUSTOM_KNEX';

export const createRegistryBackedKnex = (poolLease: IPgPoolLease): Knex => {
  const knex = createKnex({ client: 'postgresql', useNullAsDefault: true });
  knex.client.acquireConnection = () => poolLease.pool.connect();
  knex.client.releaseConnection = async (connection: PoolClient) => connection.release();
  return knex;
};

@Module({})
export class KnexModule {
  static register(): DynamicModule {
    return {
      module: KnexModule,
      imports: [PrismaModule],
      providers: [
        {
          provide: META_KNEX,
          useFactory: (poolRegistry: PgPoolRegistry) =>
            createRegistryBackedKnex(poolRegistry.acquire(getDatabaseUrl('meta'))),
          inject: [PgPoolRegistry],
        },
        {
          provide: DATA_KNEX,
          useExisting: META_KNEX,
        },
        {
          provide: CUSTOM_KNEX,
          useExisting: META_KNEX,
        },
      ],
      exports: [META_KNEX, DATA_KNEX, CUSTOM_KNEX],
    };
  }
}
