import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { IDsn } from '@teable/core';
import { DriverClient, HttpErrorCode, parseDsn } from '@teable/core';
import { Prisma, PrismaService, getDatabaseUrl } from '@teable/db-main-prisma';
import { Knex } from 'knex';
import { InjectModel } from 'nest-knexjs';
import { CustomHttpException } from '../../custom.exception';
import { DatabaseRouter } from '../../global/database-router.service';
import { DATA_KNEX } from '../../global/knex';
import { BASE_READ_ONLY_ROLE_PREFIX } from './const';
import { checkTableAccess, validateRoleOperations } from './utils';

@Injectable()
export class BaseSqlExecutorService {
  private readonly dsn: IDsn;
  readonly driver: DriverClient;
  private readonly logger = new Logger(BaseSqlExecutorService.name);

  constructor(
    private readonly prismaService: PrismaService,
    private readonly databaseRouter: DatabaseRouter,
    private readonly configService: ConfigService,
    @InjectModel(DATA_KNEX) private readonly knex: Knex
  ) {
    this.dsn = parseDsn(this.getDatabaseUrl());
    this.driver = this.dsn.driver as DriverClient;
  }

  private getDatabaseUrl() {
    return (
      this.configService.get<string>('PRISMA_DATABASE_URL_FOR_SQL_EXECUTOR') ||
      getDatabaseUrl('meta')
    );
  }

  private getReadOnlyRoleName(baseId: string) {
    return `${BASE_READ_ONLY_ROLE_PREFIX}${baseId}`;
  }

  private async dataPrismaForBase(baseId: string) {
    return await this.databaseRouter.dataPrismaExecutorForBase(baseId);
  }

  async createReadOnlyRole(baseId: string) {
    const roleName = this.getReadOnlyRoleName(baseId);
    const dataPrisma = await this.dataPrismaForBase(baseId);
    await dataPrisma.$executeRawUnsafe(
      this.knex
        .raw(
          `CREATE ROLE ?? WITH NOLOGIN NOSUPERUSER NOINHERIT NOCREATEDB NOCREATEROLE NOREPLICATION`,
          [roleName]
        )
        .toQuery()
    );
    await dataPrisma.$executeRawUnsafe(
      this.knex.raw(`GRANT USAGE ON SCHEMA ?? TO ??`, [baseId, roleName]).toQuery()
    );
    await dataPrisma.$executeRawUnsafe(
      this.knex.raw(`GRANT SELECT ON ALL TABLES IN SCHEMA ?? TO ??`, [baseId, roleName]).toQuery()
    );
    await dataPrisma.$executeRawUnsafe(
      this.knex
        .raw(`ALTER DEFAULT PRIVILEGES IN SCHEMA ?? GRANT SELECT ON TABLES TO ??`, [
          baseId,
          roleName,
        ])
        .toQuery()
    );
  }

  async dropReadOnlyRole(baseId: string) {
    const roleName = this.getReadOnlyRoleName(baseId);
    const dataPrisma = await this.dataPrismaForBase(baseId);
    await dataPrisma.$executeRawUnsafe(
      this.knex.raw(`REVOKE USAGE ON SCHEMA ?? FROM ??`, [baseId, roleName]).toQuery()
    );
    await dataPrisma.$executeRawUnsafe(
      this.knex
        .raw(`REVOKE SELECT ON ALL TABLES IN SCHEMA ?? FROM ??`, [baseId, roleName])
        .toQuery()
    );
    await dataPrisma.$executeRawUnsafe(
      this.knex
        .raw(`ALTER DEFAULT PRIVILEGES IN SCHEMA ?? REVOKE ALL ON TABLES FROM ??`, [
          baseId,
          roleName,
        ])
        .toQuery()
    );
    await dataPrisma.$executeRawUnsafe(
      this.knex.raw(`DROP ROLE IF EXISTS ??`, [roleName]).toQuery()
    );
  }

  async grantReadOnlyRole(baseId: string) {
    const roleName = this.getReadOnlyRoleName(baseId);
    const dataPrisma = await this.dataPrismaForBase(baseId);
    await dataPrisma.$executeRawUnsafe(
      this.knex.raw(`GRANT USAGE ON SCHEMA ?? TO ??`, [baseId, roleName]).toQuery()
    );
    await dataPrisma.$executeRawUnsafe(
      this.knex.raw(`GRANT SELECT ON ALL TABLES IN SCHEMA ?? TO ??`, [baseId, roleName]).toQuery()
    );
    await dataPrisma.$executeRawUnsafe(
      this.knex
        .raw(`ALTER DEFAULT PRIVILEGES IN SCHEMA ?? GRANT SELECT ON TABLES TO ??`, [
          baseId,
          roleName,
        ])
        .toQuery()
    );
  }

  private async roleExits(role: string, baseId?: string): Promise<boolean> {
    const dataPrisma = baseId ? await this.dataPrismaForBase(baseId) : this.prismaService;
    const roleExists = await dataPrisma.$queryRawUnsafe<{ count: bigint }[]>(
      this.knex.raw('SELECT count(*) FROM pg_roles WHERE rolname = ?', [role]).toQuery()
    );
    return Boolean(roleExists[0].count);
  }

  private async roleCheckAndCreate(baseId: string) {
    if (this.driver !== DriverClient.Pg) {
      return;
    }
    const roleName = this.getReadOnlyRoleName(baseId);
    if (!(await this.roleExits(roleName, baseId))) {
      try {
        await this.createReadOnlyRole(baseId);
      } catch (error) {
        // Handle race condition: another concurrent request may have already created the role
        if (
          error instanceof Prisma.PrismaClientKnownRequestError &&
          (error?.meta?.code === '42710' || error?.meta?.code === '23505')
        ) {
          this.logger.warn(
            `read only role ${roleName} already exists (concurrent creation), skipping`
          );
          return;
        }
        throw error;
      }
    }
  }

  private async setRole(
    prisma: { $executeRawUnsafe(query: string): Promise<unknown> },
    baseId: string
  ) {
    const roleName = this.getReadOnlyRoleName(baseId);
    await prisma.$executeRawUnsafe(this.knex.raw(`SET ROLE ??`, [roleName]).toQuery());
  }

  private async resetRole(prisma: { $executeRawUnsafe(query: string): Promise<unknown> }) {
    await prisma.$executeRawUnsafe(this.knex.raw(`RESET ROLE`).toQuery());
  }

  private async readonlyExecuteSql(baseId: string, sql: string) {
    return this.databaseRouter.dataPrismaTransactionForBase(baseId, async (prisma) => {
      await prisma.$executeRawUnsafe('SET TRANSACTION READ ONLY');
      return await prisma.$queryRawUnsafe(sql);
    });
  }

  /**
   * check sql is safe
   * 1. role operations validation
   * 2. parse sql to valid table names
   * 3. read only role check table access
   */
  private async safeCheckSql(
    baseId: string,
    sql: string,
    opts?: { projectionTableDbNames?: string[]; projectionTableIds?: string[] }
  ) {
    const { projectionTableDbNames = [] } = opts ?? {};
    // 1. role operations keywords validation, only pg support
    if (this.driver == DriverClient.Pg) {
      validateRoleOperations(sql);
    }
    let tableNames = projectionTableDbNames;
    if (!projectionTableDbNames.length) {
      const tables = await this.prismaService.tableMeta.findMany({
        where: {
          baseId,
        },
        select: {
          dbTableName: true,
        },
      });
      tableNames = tables.map((table) => table.dbTableName);
    }
    // 2. parse sql to valid table names
    checkTableAccess(sql, {
      tableNames,
      database: this.driver,
    });
    // 3. read only role check table access, only pg and pg version > 14 support
    try {
      await this.readonlyExecuteSql(baseId, sql);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (error: any) {
      throw new CustomHttpException(
        `read only check failed: ${error?.meta?.message || error?.message}`,
        HttpErrorCode.VALIDATION_ERROR,
        {
          localization: {
            i18nKey: 'httpErrors.baseSqlExecutor.readOnlyCheckFailed',
            context: {
              message: error?.meta?.message || error?.message,
            },
          },
        }
      );
    }
  }

  async executeQuerySql<T = unknown>(
    baseId: string,
    sql: string,
    opts?: {
      projectionTableDbNames?: string[];
      projectionTableIds?: string[];
    }
  ) {
    await this.safeCheckSql(baseId, sql, opts);
    await this.roleCheckAndCreate(baseId);
    return this.databaseRouter.dataPrismaTransactionForBase(baseId, async (prisma) => {
      try {
        await this.setRole(prisma, baseId);
        return await prisma.$queryRawUnsafe<T>(sql);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } catch (error: any) {
        throw new CustomHttpException(
          `execute query sql failed: ${error?.meta?.message || error?.message}`,
          HttpErrorCode.VALIDATION_ERROR,
          {
            localization: {
              i18nKey: 'httpErrors.baseSqlExecutor.executeQuerySqlFailed',
              context: {
                message: error?.meta?.message || error?.message,
              },
            },
          }
        );
      } finally {
        await this.resetRole(prisma).catch((error) => {
          console.log('resetRole error', error);
        });
      }
    });
  }
}
