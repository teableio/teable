import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { IDsn } from '@teable/core';
import { DriverClient, parseDsn } from '@teable/core';
import { PrismaService } from '@teable/db-main-prisma';
import type { IDbConnectionVo } from '@teable/openapi';
import { Knex } from 'knex';
import { nanoid } from 'nanoid';
import { InjectModel } from 'nest-knexjs';
import { BaseConfig, type IBaseConfig } from '../../configs/base.config';
import { InjectDbProvider } from '../../db-provider/db.provider';
import { IDbProvider } from '../../db-provider/db.provider.interface';

@Injectable()
export class DbConnectionService {
  private readonly logger = new Logger(DbConnectionService.name);

  constructor(
    private readonly prismaService: PrismaService,
    private readonly configService: ConfigService,
    @InjectDbProvider() private readonly dbProvider: IDbProvider,
    @InjectModel('CUSTOM_KNEX') private readonly knex: Knex,
    @BaseConfig() private readonly baseConfig: IBaseConfig
  ) {}

  private getUrlFromDsn(dsn: IDsn): string {
    const { driver, host, port, db, user, pass, params } = dsn;
    if (driver !== DriverClient.Pg) {
      throw new Error('Unsupported database driver');
    }

    const paramString =
      Object.entries(params as Record<string, unknown>)
        .map(([key, value]) => `${key}=${value}`)
        .join('&') || '';

    return `postgresql://${user}:${pass}@${host}:${port}/${db}?${paramString}`;
  }

  async remove(baseId: string) {
    if (this.dbProvider.driver !== DriverClient.Pg) {
      throw new BadRequestException(`Unsupported database driver: ${this.dbProvider.driver}`);
    }

    const readOnlyRole = `read_only_role_${baseId}`;
    const schemaName = baseId;
    return this.prismaService.$tx(async (prisma) => {
      // Verify if the base exists and if the user is the owner
      await prisma.base
        .findFirstOrThrow({
          where: { id: baseId, deletedTime: null },
        })
        .catch(() => {
          throw new BadRequestException('Only the base owner can remove a db connection');
        });

      // Revoke permissions from the role for the schema
      await prisma.$executeRawUnsafe(
        this.knex.raw('REVOKE USAGE ON SCHEMA ?? FROM ??', [schemaName, readOnlyRole]).toQuery()
      );

      await prisma.$executeRawUnsafe(
        this.knex
          .raw(`ALTER DEFAULT PRIVILEGES IN SCHEMA ?? REVOKE ALL ON TABLES FROM ??`, [
            schemaName,
            readOnlyRole,
          ])
          .toQuery()
      );

      // Revoke permissions from the role for the tables in schema
      await prisma.$executeRawUnsafe(
        this.knex
          .raw('REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA ?? FROM ??', [
            schemaName,
            readOnlyRole,
          ])
          .toQuery()
      );

      // drop the role
      await prisma.$executeRawUnsafe(
        this.knex.raw('DROP ROLE IF EXISTS ??', [readOnlyRole]).toQuery()
      );

      await prisma.base.update({
        where: { id: baseId },
        data: { schemaPass: null },
      });
    });
  }

  private async roleExits(role: string): Promise<boolean> {
    const roleExists = await this.prismaService.$queryRaw<
      { count: bigint }[]
    >`SELECT count(*) FROM pg_roles WHERE rolname=${role}`;
    return Boolean(roleExists[0].count);
  }

  private async getConnectionCount(role: string): Promise<number> {
    const roleExists = await this.prismaService.$queryRaw<
      { count: bigint }[]
    >`SELECT COUNT(*) FROM pg_stat_activity WHERE usename=${role}`;
    return Number(roleExists[0].count);
  }

  async retrieve(baseId: string): Promise<IDbConnectionVo | null> {
    if (this.dbProvider.driver !== DriverClient.Pg) {
      return null;
    }

    const readOnlyRole = `read_only_role_${baseId}`;
    const publicDatabaseProxy = this.baseConfig.publicDatabaseProxy;
    if (!publicDatabaseProxy) {
      this.logger.error('PUBLIC_DATABASE_PROXY is not found in env');
      return null;
    }

    const { hostname: dbHostProxy, port: dbPortProxy } = new URL(`https://${publicDatabaseProxy}`);

    // Check if the base exists and the user is the owner
    const base = await this.prismaService.base.findFirst({
      where: { id: baseId, deletedTime: null },
      select: { id: true, schemaPass: true },
    });

    if (!base?.schemaPass) {
      return null;
    }

    // Check if the read-only role already exists
    if (!(await this.roleExits(readOnlyRole))) {
      throw new InternalServerErrorException(`Role does not exist: ${readOnlyRole}`);
    }

    const currentConnections = await this.getConnectionCount(readOnlyRole);

    const databaseUrl = this.configService.getOrThrow<string>('PRISMA_DATABASE_URL');
    const { db } = parseDsn(databaseUrl);

    // Construct the DSN for the read-only role
    const dsn: IDbConnectionVo['dsn'] = {
      driver: DriverClient.Pg,
      host: dbHostProxy,
      port: Number(dbPortProxy),
      db: db,
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
      const readOnlyRole = `read_only_role_${baseId}`;
      const schemaName = baseId;
      const password = nanoid();
      const publicDatabaseProxy = this.baseConfig.publicDatabaseProxy;
      if (!publicDatabaseProxy) {
        this.logger.error('PUBLIC_DATABASE_PROXY is not found in env');
        return null;
      }

      const { hostname: dbHostProxy, port: dbPortProxy } = new URL(
        `https://${publicDatabaseProxy}`
      );
      const databaseUrl = this.configService.getOrThrow<string>('PRISMA_DATABASE_URL');
      const { db } = parseDsn(databaseUrl);

      return this.prismaService.$tx(async (prisma) => {
        await prisma.base
          .findFirstOrThrow({
            where: { id: baseId, deletedTime: null },
          })
          .catch(() => {
            throw new BadRequestException('only base owner can public db connection');
          });

        await prisma.base.update({
          where: { id: baseId },
          data: { schemaPass: password },
        });

        // Create a read-only role
        await prisma.$executeRawUnsafe(
          this.knex
            .raw(
              `CREATE ROLE ?? WITH LOGIN PASSWORD ? NOSUPERUSER NOINHERIT NOCREATEDB NOCREATEROLE NOREPLICATION CONNECTION LIMIT ?`,
              [readOnlyRole, password, this.baseConfig.defaultMaxBaseDBConnections]
            )
            .toQuery()
        );

        await prisma.$executeRawUnsafe(
          this.knex.raw(`GRANT USAGE ON SCHEMA ?? TO ??`, [schemaName, readOnlyRole]).toQuery()
        );

        await prisma.$executeRawUnsafe(
          this.knex
            .raw(`GRANT SELECT ON ALL TABLES IN SCHEMA ?? TO ??`, [schemaName, readOnlyRole])
            .toQuery()
        );

        await prisma.$executeRawUnsafe(
          this.knex
            .raw(`ALTER DEFAULT PRIVILEGES IN SCHEMA ?? GRANT SELECT ON TABLES TO ??`, [
              schemaName,
              readOnlyRole,
            ])
            .toQuery()
        );

        const dsn: IDbConnectionVo['dsn'] = {
          driver: DriverClient.Pg,
          host: dbHostProxy,
          port: Number(dbPortProxy),
          db: db,
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
    }

    throw new BadRequestException(`Unsupported database driver: ${this.dbProvider.driver}`);
  }
}
