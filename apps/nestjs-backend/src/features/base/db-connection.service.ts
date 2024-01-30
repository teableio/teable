import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { IDsn } from '@teable/core';
import { DriverClient, parseDsn } from '@teable/core';
import { PrismaService } from '@teable/db-main-prisma';
import { nanoid } from 'nanoid';
import { ClsService } from 'nestjs-cls';
import type { IBaseConfig } from '../../configs/base.config';
import { InjectDbProvider } from '../../db-provider/db.provider';
import { IDbProvider } from '../../db-provider/db.provider.interface';
import type { IClsStore } from '../../types/cls';

@Injectable()
export class DbConnectionService {
  private readonly baseConfig: IBaseConfig;

  constructor(
    private readonly prismaService: PrismaService,
    private readonly cls: ClsService<IClsStore>,
    private readonly configService: ConfigService,
    @InjectDbProvider() private readonly dbProvider: IDbProvider
  ) {
    this.baseConfig = this.configService.get<IBaseConfig>('base')!;
  }

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
    const userId = this.cls.get('user.id'); // Assuming you have some user context
    if (this.dbProvider.driver !== DriverClient.Pg) {
      throw new BadRequestException(`Unsupported database driver: ${this.dbProvider.driver}`);
    }

    const readOnlyRole = `read_only_role_${baseId}`;
    const schemaName = baseId;
    return this.prismaService.$tx(async (prisma) => {
      // Verify if the base exists and if the user is the owner
      await prisma.base
        .findFirstOrThrow({
          where: { id: baseId, createdBy: userId, deletedTime: null }, // TODO: change it to owner check
        })
        .catch(() => {
          throw new BadRequestException('Only the base owner can remove a db connection');
        });

      // Revoke permissions from the role for the schema
      await prisma.$executeRawUnsafe(
        `REVOKE USAGE ON SCHEMA "${schemaName}" FROM "${readOnlyRole}"`
      );

      await prisma.$executeRawUnsafe(
        `ALTER DEFAULT PRIVILEGES FOR ROLE teable IN SCHEMA "${schemaName}" REVOKE ALL ON TABLES FROM "${readOnlyRole}"`
      );

      // Revoke permissions from the role for the tables in schema
      await prisma.$executeRawUnsafe(
        `REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA "${schemaName}" FROM "${readOnlyRole}"`
      );
      // Optionally, drop the role
      await prisma.$executeRawUnsafe(`DROP ROLE IF EXISTS "${readOnlyRole}"`);

      await prisma.base.update({
        where: { id: baseId },
        data: { schemaPass: null },
      });
    });
  }

  async retrieve(baseId: string): Promise<{ dsn: IDsn; url: string } | null> {
    const userId = this.cls.get('user.id'); // Assuming this.cls is a context object that has user info
    if (this.dbProvider.driver !== DriverClient.Pg) {
      throw new BadRequestException(`Unsupported database driver: ${this.dbProvider.driver}`);
    }

    const readOnlyRole = `read_only_role_${baseId}`;
    if (!this.baseConfig.publicDatabaseAddress) {
      throw new NotFoundException('PUBLIC_DATABASE_ADDRESS is not found in env');
    }

    const originDsn = parseDsn(this.baseConfig.publicDatabaseAddress); // Assuming parseDsn is already defined to parse the DSN

    // Check if the base exists and the user is the owner
    const base = await this.prismaService.base
      .findFirstOrThrow({
        where: { id: baseId, createdBy: userId, deletedTime: null },
        select: { id: true, schemaPass: true },
      })
      .catch(() => {
        throw new BadRequestException('base not found, you should be base owner');
      });

    if (!base.schemaPass) {
      return null;
    }

    // Check if the read-only role already exists
    const roleExists = await this.prismaService
      .$executeRaw`SELECT EXISTS (SELECT FROM pg_roles WHERE rolname=${readOnlyRole})`;

    if (!roleExists) {
      throw new InternalServerErrorException(`Role does not exist: ${readOnlyRole}`);
    }

    // Construct the DSN for the read-only role
    const dsn: IDsn = {
      driver: DriverClient.Pg,
      host: originDsn.host,
      port: originDsn.port,
      db: originDsn.db,
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
    const userId = this.cls.get('user.id');
    if (this.dbProvider.driver === DriverClient.Pg) {
      const readOnlyRole = `read_only_role_${baseId}`;
      const schemaName = baseId;
      const password = nanoid();
      const databaseUrl = this.baseConfig.publicDatabaseAddress;
      if (!databaseUrl) {
        throw new NotFoundException('PUBLIC_DATABASE_ADDRESS is not found in env');
      }

      const originDsn = parseDsn(databaseUrl);

      return this.prismaService.$tx(async (prisma) => {
        await prisma.base
          .findFirstOrThrow({
            where: { id: baseId, createdBy: userId, deletedTime: null }, // TODO: change it to owner check
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
          `CREATE ROLE "${readOnlyRole}" WITH LOGIN PASSWORD '${password}' NOSUPERUSER NOINHERIT NOCREATEDB NOCREATEROLE NOREPLICATION`
        );

        await prisma.$executeRawUnsafe(
          `GRANT USAGE ON SCHEMA "${schemaName}" TO "${readOnlyRole}"`
        );

        await prisma.$executeRawUnsafe(
          `GRANT SELECT ON ALL TABLES IN SCHEMA "${schemaName}" TO "${readOnlyRole}"`
        );

        await prisma.$executeRawUnsafe(
          `ALTER DEFAULT PRIVILEGES IN SCHEMA "${schemaName}" GRANT SELECT ON TABLES TO "${readOnlyRole}"`
        );

        const dsn = {
          driver: DriverClient.Pg,
          host: originDsn.host,
          port: originDsn.port,
          db: originDsn.db,
          user: readOnlyRole,
          pass: password,
          params: {
            schema: baseId,
          },
        };

        return {
          dsn,
          url: this.getUrlFromDsn(dsn),
        };
      });
    }

    throw new BadRequestException(`Unsupported database driver: ${this.dbProvider.driver}`);
  }
}
