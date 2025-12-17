import type { DynamicModule } from '@nestjs/common';
import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DriverClient, parseDsn } from '@teable/core';
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

          // Build MySQL connection config from environment variables if provided
          let knexConfig: any = {
            client: driver, // parseDsn already converts mysql to mysql2
            useNullAsDefault: true,
          };

          // For MySQL, support read/write connection configuration
          if (driver === DriverClient.Mysql) {
            const writerSchema = config.get<string>('WRITER_DB_SCHEMA');
            const writerUsername = config.get<string>('WRITER_DB_USERNAME');
            const writerPassword = config.get<string>('WRITER_DB_PASSWORD');
            const writerHostname = config.get<string>('WRITER_DB_HOSTNAME');
            const writerPoolMin = config.get<number>('WRITER_DB_POOL_MIN');
            const writerPoolMax = config.get<number>('WRITER_DB_POOL_MAX');
            const writerPoolAcquire = config.get<number>('WRITER_DB_POOL_ACQUIRE');
            const writerPoolIdle = config.get<number>('WRITER_DB_POOL_IDLE');

            // If MySQL-specific env vars are provided, use them to build connection
            if (writerSchema && writerUsername && writerPassword && writerHostname) {
              const port = config.get<number>('WRITER_DB_PORT') || 3306;
              knexConfig = {
                ...knexConfig,
                connection: {
                  host: writerHostname,
                  port: port,
                  user: writerUsername,
                  password: writerPassword,
                  database: writerSchema,
                },
                pool: {
                  min: writerPoolMin || 1,
                  max: writerPoolMax || 10,
                  acquireTimeoutMillis: writerPoolAcquire || 30000,
                  idleTimeoutMillis: writerPoolIdle || 10000,
                },
              };
            } else {
              // Fallback to PRISMA_DATABASE_URL parsing
              const parsed = parseDsn(databaseUrl);
              knexConfig = {
                ...knexConfig,
                connection: {
                  host: parsed.host,
                  port: parsed.port,
                  user: parsed.user,
                  password: parsed.pass,
                  database: parsed.db,
                },
              };
            }
          }

          return {
            config: knexConfig,
            name: 'CUSTOM_KNEX',
          };
        },
      },
      'CUSTOM_KNEX'
    );
  }
}
