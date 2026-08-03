import type { DynamicModule } from '@nestjs/common';
import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { parseDsn } from '@teable/core';
import { getDatabaseUrl } from '@teable/db-main-prisma';
import { KnexModule as BaseKnexModule } from 'nest-knexjs';

export const META_KNEX = 'META_KNEX';
export const DATA_KNEX = 'DATA_KNEX';
export const CUSTOM_KNEX = 'CUSTOM_KNEX';

@Module({})
export class KnexModule {
  static register(): DynamicModule {
    const createKnexModule = (name: string, target: 'meta' | 'data') =>
      BaseKnexModule.forRootAsync(
        {
          inject: [ConfigService],
          useFactory: (_config: ConfigService) => {
            const databaseUrl = getDatabaseUrl(target, process.env);
            const { driver } = parseDsn(databaseUrl);
            return {
              config: {
                client: driver,
                useNullAsDefault: true,
                connection: databaseUrl,
              },
              name,
            };
          },
        },
        name
      );

    const metaKnexModule = createKnexModule(META_KNEX, 'meta');
    const dataKnexModule = createKnexModule(DATA_KNEX, 'data');

    return {
      module: KnexModule,
      imports: [metaKnexModule, dataKnexModule],
      providers: [
        {
          provide: CUSTOM_KNEX,
          useExisting: META_KNEX,
        },
      ],
      exports: [metaKnexModule, dataKnexModule, CUSTOM_KNEX],
    };
  }
}
