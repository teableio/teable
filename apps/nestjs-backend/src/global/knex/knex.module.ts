import type { DynamicModule } from '@nestjs/common';
import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { parseDsn } from '@teable/core';
import { KnexModule as BaseKnexModule } from 'nest-knexjs';

@Module({})
export class KnexModule {
  static register(): DynamicModule {
    return BaseKnexModule.forRootAsync(
      {
        inject: [ConfigService],
        useFactory: (config: ConfigService) => {
          const databaseUrl = config.getOrThrow<string>('PRISMA_DATABASE_URL');
          const { driver } = parseDsn(databaseUrl);
          return {
            config: {
              client: driver,
              useNullAsDefault: true,
            },
            name: 'CUSTOM_KNEX',
          };
        },
      },
      'CUSTOM_KNEX'
    );
  }
}
