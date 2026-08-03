/* eslint-disable sonarjs/no-duplicate-string */
import { Injectable, Logger, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { IDsn } from '@teable/core';
import { DriverClient, HttpErrorCode, parseDsn } from '@teable/core';
import { PrismaService } from '@teable/db-main-prisma';
import type { IDbConnectionVo } from '@teable/openapi';
import { Knex } from 'knex';
import { nanoid } from 'nanoid';
import { InjectModel } from 'nest-knexjs';
import { BaseConfig, type IBaseConfig } from '../../configs/base.config';
import { CustomHttpException } from '../../custom.exception';
import { InjectDbProvider } from '../../db-provider/db.provider';
import { IDbProvider } from '../../db-provider/db.provider.interface';
import { DatabaseRouter } from '../../global/database-router.service';
import { DATA_KNEX } from '../../global/knex';
import { SpaceDataDbMigrationGuardService } from '../space/space-data-db-migration-guard.service';

const readonlyCapabilityErrorCodes = new Set(['0A000', '42501']);
const readonlyCapabilityErrorMessage =
  /permission denied|insufficient privilege|must be owner|not allowed to create role|cannot create role/i;

type IReadonlyDsnTarget =
  | {
      available: true;
      host: string;
      port: number;
      db: string;
    }
  | { available: false };

@Injectable()
export class DbConnectionService {
  private readonly logger = new Logger(DbConnectionService.name);

  constructor(
    private readonly prismaService: PrismaService,
    private readonly databaseRouter: DatabaseRouter,
    private readonly configService: ConfigService,
    @InjectDbProvider() private readonly dbProvider: IDbProvider,
    @InjectModel(DATA_KNEX) private readonly knex: Knex,
    @BaseConfig() private readonly baseConfig: IBaseConfig,
    @Optional()
    private readonly spaceDataDbMigrationGuard?: SpaceDataDbMigrationGuardService
  ) {}

  private async assertBaseWritable(baseId: string) {
    await this.spaceDataDbMigrationGuard?.assertBaseWritable(baseId);
  }

  private isReadonlyCapabilityError(error: unknown): boolean {
    if (error instanceof CustomHttpException) {
      return false;
    }

    const candidate = error as { code?: unknown; message?: unknown };
    const code = typeof candidate.code === 'string' ? candidate.code : undefined;
    const message = typeof candidate.message === 'string' ? candidate.message : undefined;

    return (
      (code != null && readonlyCapabilityErrorCodes.has(code)) ||
      (message != null && readonlyCapabilityErrorMessage.test(message))
    );
  }

  private throwReadonlyUnavailable(error: unknown, action: 'create' | 'remove'): never {
    if (!this.isReadonlyCapabilityError(error)) {
      throw error;
    }

    throw new CustomHttpException(
      'Readonly database connection is unavailable for this data database',
      HttpErrorCode.DATABASE_CONNECTION_UNAVAILABLE,
      {
        action,
        reason: 'readonly_role_privilege_unavailable',
      }
    );
  }

  private getUrlFromDsn(dsn: IDsn): string {
    const { driver, host, port, db, user, pass, params } = dsn;
    if (driver !== DriverClient.Pg) {
      throw new CustomHttpException('Unsupported database driver', HttpErrorCode.VALIDATION_ERROR, {
        localization: {
          i18nKey: 'httpErrors.dbConnection.unsupportedDriver',
          context: {
            driver,
          },
        },
      });
    }

    const paramString =
      Object.entries(params as Record<string, unknown>)
        .map(([key, value]) => `${key}=${value}`)
        .join('&') || '';

    return `postgresql://${user}:${pass}@${host}:${port}/${db}?${paramString}`;
  }

  private getDefaultReadonlyDsnTarget(db: string): IReadonlyDsnTarget {
    const publicDatabaseProxy = this.baseConfig.publicDatabaseProxy;
    if (!publicDatabaseProxy) {
      this.logger.error('PUBLIC_DATABASE_PROXY is not found in env');
      return { available: false };
    }

    const { hostname, port } = new URL(`https://${publicDatabaseProxy}`);
    return {
      available: true,
      host: hostname,
      port: Number(port),
      db,
    };
  }

  private async getReadonlyDsnTarget(baseId: string): Promise<IReadonlyDsnTarget> {
    const resolvedDataDb = await this.databaseRouter.getDataDatabaseForBase(baseId);
    const { db, host, port } = parseDsn(resolvedDataDb.url);
    const database = db ?? '';

    if (resolvedDataDb.isMetaFallback) {
      return this.getDefaultReadonlyDsnTarget(database);
    }

    return {
      available: true,
      host,
      port: Number(port),
      db: database,
    };
  }

  async remove(baseId: string) {
    if (this.dbProvider.driver !== DriverClient.Pg) {
      throw new CustomHttpException('Unsupported database driver', HttpErrorCode.VALIDATION_ERROR, {
        localization: {
          i18nKey: 'httpErrors.dbConnection.unsupportedDriver',
          context: {
            driver: this.dbProvider.driver,
          },
        },
      });
    }
    await this.assertBaseWritable(baseId);

    const readOnlyRole = `read_only_role_${baseId}`;
    const schemaName = baseId;
    try {
      return await this.prismaService.$tx(async (prisma) => {
        // Verify if the base exists and if the user is the owner
        await prisma.base
          .findFirstOrThrow({
            where: { id: baseId, deletedTime: null },
          })
          .catch(() => {
            throw new CustomHttpException(
              'Only the base owner can remove a db connection',
              HttpErrorCode.RESTRICTED_RESOURCE,
              {
                localization: {
                  i18nKey: 'httpErrors.dbConnection.onlyOwnerCanRemove',
                  context: {
                    baseId,
                  },
                },
              }
            );
          });

        const dataPrisma = await this.databaseRouter.dataPrismaExecutorForBase(baseId, {
          useTransaction: true,
        });

        // Revoke permissions from the role for the schema
        await dataPrisma.$executeRawUnsafe(
          this.knex.raw('REVOKE USAGE ON SCHEMA ?? FROM ??', [schemaName, readOnlyRole]).toQuery()
        );

        await dataPrisma.$executeRawUnsafe(
          this.knex
            .raw(`ALTER DEFAULT PRIVILEGES IN SCHEMA ?? REVOKE ALL ON TABLES FROM ??`, [
              schemaName,
              readOnlyRole,
            ])
            .toQuery()
        );

        // Revoke permissions from the role for the tables in schema
        await dataPrisma.$executeRawUnsafe(
          this.knex
            .raw('REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA ?? FROM ??', [
              schemaName,
              readOnlyRole,
            ])
            .toQuery()
        );

        // drop the role
        await dataPrisma.$executeRawUnsafe(
          this.knex.raw('DROP ROLE IF EXISTS ??', [readOnlyRole]).toQuery()
        );

        await prisma.base.update({
          where: { id: baseId },
          data: { schemaPass: null },
        });
      });
    } catch (error) {
      this.throwReadonlyUnavailable(error, 'remove');
    }
  }

  private async roleExits(baseId: string, role: string): Promise<boolean> {
    const dataPrisma = await this.databaseRouter.dataPrismaForBase(baseId);
    const roleExists = await dataPrisma.$queryRaw<
      { count: bigint }[]
    >`SELECT count(*) FROM pg_roles WHERE rolname=${role}`;
    return Boolean(roleExists[0].count);
  }

  private async getConnectionCount(baseId: string, role: string): Promise<number> {
    const dataPrisma = await this.databaseRouter.dataPrismaForBase(baseId);
    const roleExists = await dataPrisma.$queryRaw<
      { count: bigint }[]
    >`SELECT COUNT(*) FROM pg_stat_activity WHERE usename=${role}`;
    return Number(roleExists[0].count);
  }

  async retrieve(baseId: string): Promise<IDbConnectionVo | null> {
    if (this.dbProvider.driver !== DriverClient.Pg) {
      return null;
    }

    const readOnlyRole = `read_only_role_${baseId}`;

    // Check if the base exists and the user is the owner
    const base = await this.prismaService.base.findFirst({
      where: { id: baseId, deletedTime: null },
      select: { id: true, schemaPass: true },
    });

    if (!base?.schemaPass) {
      return null;
    }

    // Check if the read-only role already exists
    if (!(await this.roleExits(baseId, readOnlyRole))) {
      throw new CustomHttpException('Role does not exist', HttpErrorCode.INTERNAL_SERVER_ERROR, {
        localization: {
          i18nKey: 'httpErrors.dbConnection.roleNotExist',
          context: {
            role: readOnlyRole,
          },
        },
      });
    }

    const currentConnections = await this.getConnectionCount(baseId, readOnlyRole);

    const readonlyTarget = await this.getReadonlyDsnTarget(baseId);
    if (!readonlyTarget.available) {
      return null;
    }

    // Construct the DSN for the read-only role
    const dsn: IDbConnectionVo['dsn'] = {
      driver: DriverClient.Pg,
      host: readonlyTarget.host,
      port: readonlyTarget.port,
      db: readonlyTarget.db,
      user: readOnlyRole,
      pass: base.schemaPass,
      params: {
        schema: baseId,
      },
    };

    // Get the URL from the DSN
    const url = this.getUrlFromDsn(dsn);

    return {
      dsn,
      connection: {
        max: this.baseConfig.defaultMaxBaseDBConnections,
        current: currentConnections,
      },
      url,
    };
  }

  /**
   * public a schema specify and readonly connection
   *
   * check role is empty, if not, throw badRequest
   *
   * create a readonly role
   *
   * limit role to only access the schema
   */
  async create(baseId: string) {
    if (this.dbProvider.driver === DriverClient.Pg) {
      await this.assertBaseWritable(baseId);

      const readOnlyRole = `read_only_role_${baseId}`;
      const schemaName = baseId;
      const password = nanoid();
      const readonlyTarget = await this.getReadonlyDsnTarget(baseId);
      if (!readonlyTarget.available) {
        return null;
      }

      try {
        return await this.prismaService.$tx(async (prisma) => {
          await prisma.base
            .findFirstOrThrow({
              where: { id: baseId, deletedTime: null },
            })
            .catch(() => {
              throw new CustomHttpException(
                'Only base owner can create db connection',
                HttpErrorCode.RESTRICTED_RESOURCE,
                {
                  localization: {
                    i18nKey: 'httpErrors.dbConnection.onlyOwnerCanCreate',
                    context: {
                      baseId,
                    },
                  },
                }
              );
            });

          await prisma.base.update({
            where: { id: baseId },
            data: { schemaPass: password },
          });

          const dataPrisma = await this.databaseRouter.dataPrismaExecutorForBase(baseId, {
            useTransaction: true,
          });

          // Create a read-only role
          await dataPrisma.$executeRawUnsafe(
            this.knex
              .raw(
                `CREATE ROLE ?? WITH LOGIN PASSWORD ? NOSUPERUSER NOINHERIT NOCREATEDB NOCREATEROLE NOREPLICATION CONNECTION LIMIT ?`,
                [readOnlyRole, password, this.baseConfig.defaultMaxBaseDBConnections]
              )
              .toQuery()
          );

          await dataPrisma.$executeRawUnsafe(
            this.knex.raw(`GRANT USAGE ON SCHEMA ?? TO ??`, [schemaName, readOnlyRole]).toQuery()
          );

          await dataPrisma.$executeRawUnsafe(
            this.knex
              .raw(`GRANT SELECT ON ALL TABLES IN SCHEMA ?? TO ??`, [schemaName, readOnlyRole])
              .toQuery()
          );

          await dataPrisma.$executeRawUnsafe(
            this.knex
              .raw(`ALTER DEFAULT PRIVILEGES IN SCHEMA ?? GRANT SELECT ON TABLES TO ??`, [
                schemaName,
                readOnlyRole,
              ])
              .toQuery()
          );

          const dsn: IDbConnectionVo['dsn'] = {
            driver: DriverClient.Pg,
            host: readonlyTarget.host,
            port: readonlyTarget.port,
            db: readonlyTarget.db,
            user: readOnlyRole,
            pass: password,
            params: {
              schema: baseId,
            },
          };

          return {
            dsn,
            connection: {
              max: this.baseConfig.defaultMaxBaseDBConnections,
              current: 0,
            },
            url: this.getUrlFromDsn(dsn),
          };
        });
      } catch (error) {
        this.throwReadonlyUnavailable(error, 'create');
      }
    }

    throw new CustomHttpException('Unsupported database driver', HttpErrorCode.VALIDATION_ERROR, {
      localization: {
        i18nKey: 'httpErrors.dbConnection.unsupportedDriver',
        context: {
          driver: this.dbProvider.driver,
        },
      },
    });
  }
}
