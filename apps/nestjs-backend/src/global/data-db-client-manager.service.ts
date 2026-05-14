import type { OnModuleDestroy } from '@nestjs/common';
import { Injectable } from '@nestjs/common';
import {
  DataPrismaService,
  PrismaClient as DataPrismaClient,
  getDataDatabaseUrl,
} from '@teable/db-data-prisma';
import { PrismaService } from '@teable/db-main-prisma';
import createKnex, { Knex } from 'knex';
import { InjectModel } from 'nest-knexjs';
import { decryptDataDbUrl } from '../features/space/data-db-url-secret';
import { DATA_KNEX } from './knex';

@Injectable()
export class DataDbClientManager implements OnModuleDestroy {
  private readonly knexClients = new Map<string, Knex>();
  private readonly prismaClients = new Map<string, DataPrismaClient>();

  constructor(
    private readonly prismaService: PrismaService,
    private readonly defaultDataPrismaService: DataPrismaService,
    @InjectModel(DATA_KNEX) private readonly defaultDataKnex: Knex
  ) {}

  async getDataDatabaseUrlForSpace(spaceId: string) {
    const binding = await this.prismaService.spaceDataDbBinding.findUnique({
      where: { spaceId },
      include: { dataDbConnection: true },
    });

    if (!binding || binding.mode === 'default') {
      return getDataDatabaseUrl();
    }

    if (binding.state !== 'ready' || binding.dataDbConnection?.status !== 'ready') {
      throw new Error(`Data database binding for space ${spaceId} is not ready`);
    }

    if (!binding.dataDbConnection.encryptedUrl) {
      throw new Error(`Data database connection for space ${spaceId} has no encrypted URL`);
    }

    return decryptDataDbUrl(binding.dataDbConnection.encryptedUrl);
  }

  async dataKnexForSpace(spaceId: string) {
    const binding = await this.prismaService.spaceDataDbBinding.findUnique({
      where: { spaceId },
      include: { dataDbConnection: true },
    });

    if (!binding || binding.mode === 'default') {
      return this.defaultDataKnex;
    }

    if (binding.state !== 'ready' || binding.dataDbConnection?.status !== 'ready') {
      throw new Error(`Data database binding for space ${spaceId} is not ready`);
    }

    const connectionId = binding.dataDbConnection.id;
    const existing = this.knexClients.get(connectionId);
    if (existing) {
      return existing;
    }

    const client = createKnex({
      client: 'pg',
      connection: decryptDataDbUrl(binding.dataDbConnection.encryptedUrl),
      pool: {
        min: 0,
        max: Number(process.env.BYODB_DATA_DB_POOL_MAX ?? 5),
      },
    });
    this.knexClients.set(connectionId, client);
    return client;
  }

  async dataPrismaForSpace(spaceId: string) {
    const binding = await this.prismaService.spaceDataDbBinding.findUnique({
      where: { spaceId },
      include: { dataDbConnection: true },
    });

    if (!binding || binding.mode === 'default') {
      return this.defaultDataPrismaService;
    }

    if (binding.state !== 'ready' || binding.dataDbConnection?.status !== 'ready') {
      throw new Error(`Data database binding for space ${spaceId} is not ready`);
    }

    const connectionId = binding.dataDbConnection.id;
    const existing = this.prismaClients.get(connectionId);
    if (existing) {
      return existing;
    }

    const client = new DataPrismaClient({
      datasources: {
        db: {
          url: decryptDataDbUrl(binding.dataDbConnection.encryptedUrl),
        },
      },
    });
    this.prismaClients.set(connectionId, client);
    return client;
  }

  async dataKnexForBase(baseId: string) {
    const base = await this.prismaService.base.findUnique({
      where: { id: baseId },
      select: { spaceId: true },
    });
    if (!base) {
      throw new Error(`Base ${baseId} not found`);
    }
    return await this.dataKnexForSpace(base.spaceId);
  }

  async dataPrismaForBase(baseId: string) {
    const base = await this.prismaService.base.findUnique({
      where: { id: baseId },
      select: { spaceId: true },
    });
    if (!base) {
      throw new Error(`Base ${baseId} not found`);
    }
    return await this.dataPrismaForSpace(base.spaceId);
  }

  invalidateConnection(connectionId: string) {
    const knex = this.knexClients.get(connectionId);
    if (knex) {
      void knex.destroy();
      this.knexClients.delete(connectionId);
    }

    const prisma = this.prismaClients.get(connectionId);
    if (prisma) {
      void prisma.$disconnect();
      this.prismaClients.delete(connectionId);
    }
  }

  async onModuleDestroy() {
    await Promise.all([
      ...Array.from(this.knexClients.values()).map((client) => client.destroy()),
      ...Array.from(this.prismaClients.values()).map((client) => client.$disconnect()),
    ]);
    this.knexClients.clear();
    this.prismaClients.clear();
  }
}
