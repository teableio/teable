import { BadRequestException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { IDsn } from '@teable/core';
import { DriverClient, parseDsn } from '@teable/core';
import type { Prisma } from '@teable/db-main-prisma';
import { PrismaService, PrismaClient } from '@teable/db-main-prisma';
import { Knex } from 'knex';
import { InjectModel } from 'nest-knexjs';
import { BASE_READ_ONLY_ROLE_PREFIX, BASE_SCHEMA_TABLE_READ_ONLY_ROLE_NAME } from './const';
import { checkTableAccess, validateRoleOperations } from './utils';

@Injectable()
export class BaseSqlExecutorService {
  private db?: PrismaClient;
  private readonly dsn: IDsn;
  readonly driver: DriverClient;
  private hasPgReadAllDataRole?: boolean;

  constructor(
    private readonly prismaService: PrismaService,
    private readonly configService: ConfigService,
    @InjectModel('CUSTOM_KNEX') private readonly knex: Knex
  ) {
    this.dsn = parseDsn(this.getDatabaseUrl());
    this.driver = this.dsn.driver as DriverClient;
  }

  private getDatabaseUrl() {
    return (
      this.configService.get<string>('PRISMA_DATABASE_URL_FOR_SQL_EXECUTOR') ||
      this.configService.getOrThrow<string>('PRISMA_DATABASE_URL')
    );
  }

  private getDisablePreSqlExecutorCheck() {
    return this.configService.get<string>('DISABLE_PRE_SQL_EXECUTOR_CHECK') === 'true';
  }

  private async getReadOnlyDatabaseConnectionConfig(): Promise<string | undefined> {
    if (this.driver === DriverClient.Sqlite) {
      return;
    }
    if (!this.hasPgReadAllDataRole) {
      return;
    }
    const isExistReadOnlyRole = await this.roleExits(BASE_SCHEMA_TABLE_READ_ONLY_ROLE_NAME);
    if (!isExistReadOnlyRole) {
      await this.prismaService.$tx(async (prisma) => {
        await prisma.$executeRawUnsafe(
          this.knex
            .raw(
              `CREATE ROLE ?? WITH LOGIN PASSWORD ? NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION`,
              [BASE_SCHEMA_TABLE_READ_ONLY_ROLE_NAME, this.dsn.pass]
            )
            .toQuery()
        );
        await prisma.$executeRawUnsafe(
          this.knex
            .raw(`GRANT pg_read_all_data TO ??`, [BASE_SCHEMA_TABLE_READ_ONLY_ROLE_NAME])
            .toQuery()
        );
      });
    }
    return `postgresql://${BASE_SCHEMA_TABLE_READ_ONLY_ROLE_NAME}:${this.dsn.pass}@${this.dsn.host}:${this.dsn.port}/${this.dsn.db}${
      this.dsn.params
        ? `?${Object.entries(this.dsn.params)
            .map(([key, value]) => `${key}=${value}`)
            .join('&')}`
        : ''
    }`;
  }

  async onModuleInit() {
    if (this.driver !== DriverClient.Pg) {
      return;
    }
    if (this.getDisablePreSqlExecutorCheck()) {
      return;
    }
    // if pg_read_all_data role not exist, no need to create read only role
    this.hasPgReadAllDataRole = await this.roleExits('pg_read_all_data');
    if (!this.hasPgReadAllDataRole) {
      return;
    }
    this.db = await this.createConnection();
  }

  async onModuleDestroy() {
    await this.db?.$disconnect();
  }

  private async createConnection(): Promise<PrismaClient | undefined> {
    if (this.db) {
      return this.db;
    }
    const connectionConfig = await this.getReadOnlyDatabaseConnectionConfig();
    if (!connectionConfig) {
      return;
    }
    const connection = new PrismaClient({
      datasources: {
        db: {
          url: connectionConfig,
        },
      },
    });
    await connection.$connect();

    // validate connection
    try {
      await connection.$queryRawUnsafe('SELECT 1');
      return connection;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (error: any) {
      await connection.$disconnect();
      throw new Error(`database connection failed: ${error.message}`);
    }
  }

  private getReadOnlyRoleName(baseId: string) {
    return `${BASE_READ_ONLY_ROLE_PREFIX}${baseId}`;
  }

  async createReadOnlyRole(baseId: string) {
    const roleName = this.getReadOnlyRoleName(baseId);
    await this.prismaService
      .txClient()
      .$executeRawUnsafe(
        this.knex
          .raw(
            `CREATE ROLE ?? WITH NOLOGIN NOSUPERUSER NOINHERIT NOCREATEDB NOCREATEROLE NOREPLICATION`,
            [roleName]
          )
          .toQuery()
      );
    await this.prismaService
      .txClient()
      .$executeRawUnsafe(
        this.knex.raw(`GRANT USAGE ON SCHEMA ?? TO ??`, [baseId, roleName]).toQuery()
      );
    await this.prismaService
      .txClient()
      .$executeRawUnsafe(
        this.knex.raw(`GRANT SELECT ON ALL TABLES IN SCHEMA ?? TO ??`, [baseId, roleName]).toQuery()
      );
    await this.prismaService
      .txClient()
      .$executeRawUnsafe(
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
    await this.prismaService
      .txClient()
      .$executeRawUnsafe(
        this.knex.raw(`REVOKE USAGE ON SCHEMA ?? FROM ??`, [baseId, roleName]).toQuery()
      );
    await this.prismaService
      .txClient()
      .$executeRawUnsafe(
        this.knex
          .raw(`REVOKE SELECT ON ALL TABLES IN SCHEMA ?? FROM ??`, [baseId, roleName])
          .toQuery()
      );
    await this.prismaService
      .txClient()
      .$executeRawUnsafe(
        this.knex
          .raw(`ALTER DEFAULT PRIVILEGES IN SCHEMA ?? REVOKE ALL ON TABLES FROM ??`, [
            baseId,
            roleName,
          ])
          .toQuery()
      );
    await this.prismaService
      .txClient()
      .$executeRawUnsafe(this.knex.raw(`DROP ROLE IF EXISTS ??`, [roleName]).toQuery());
  }

  async grantReadOnlyRole(baseId: string) {
    const roleName = this.getReadOnlyRoleName(baseId);
    await this.prismaService
      .txClient()
      .$executeRawUnsafe(
        this.knex.raw(`GRANT USAGE ON SCHEMA ?? TO ??`, [baseId, roleName]).toQuery()
      );
    await this.prismaService
      .txClient()
      .$executeRawUnsafe(
        this.knex.raw(`GRANT SELECT ON ALL TABLES IN SCHEMA ?? TO ??`, [baseId, roleName]).toQuery()
      );
    await this.prismaService
      .txClient()
      .$executeRawUnsafe(
        this.knex
          .raw(`ALTER DEFAULT PRIVILEGES IN SCHEMA ?? GRANT SELECT ON TABLES TO ??`, [
            baseId,
            roleName,
          ])
          .toQuery()
      );
  }

  private async roleExits(role: string): Promise<boolean> {
    const roleExists = await this.prismaService.$queryRaw<
      { count: bigint }[]
    >`SELECT count(*) FROM pg_roles WHERE rolname=${role}`;
    return Boolean(roleExists[0].count);
  }

  private async roleCheckAndCreate(baseId: string) {
    if (this.driver !== DriverClient.Pg) {
      return;
    }
    const roleName = this.getReadOnlyRoleName(baseId);
    if (!(await this.roleExits(roleName))) {
      await this.createReadOnlyRole(baseId);
    }
  }

  private async setRole(prisma: Prisma.TransactionClient, baseId: string) {
    const roleName = this.getReadOnlyRoleName(baseId);
    await prisma.$executeRawUnsafe(this.knex.raw(`SET ROLE ??`, [roleName]).toQuery());
  }

  private async resetRole(prisma: Prisma.TransactionClient) {
    await prisma.$executeRawUnsafe(this.knex.raw(`RESET ROLE`).toQuery());
  }

  private async readonlyExecuteSql(sql: string) {
    return this.db?.$queryRawUnsafe(sql);
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
    await this.readonlyExecuteSql(sql);
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
    return this.prismaService.$tx(async (prisma) => {
      try {
        await this.setRole(prisma, baseId);
        return await prisma.$queryRawUnsafe<T>(sql);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } catch (error: any) {
        throw new BadRequestException(error?.meta?.message || error?.message);
      } finally {
        await this.resetRole(prisma).catch((error) => {
          console.log('resetRole error', error);
        });
      }
    });
  }
}
