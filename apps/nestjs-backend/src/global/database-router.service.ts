import { Injectable } from '@nestjs/common';
import { DataPrismaService } from '@teable/db-data-prisma';
import { getDatabaseUrl, MetaPrismaService } from '@teable/db-main-prisma';
import { Knex } from 'knex';
import { InjectModel } from 'nest-knexjs';
import { DataDbClientManager } from './data-db-client-manager.service';
import type { IDataDbRoutingOptions } from './data-db-client-manager.service';
import { DATA_KNEX, META_KNEX } from './knex';

export type IDataPrismaQueryExecutor = {
  $queryRawUnsafe<T = unknown>(query: string, ...values: unknown[]): Promise<T>;
  $executeRawUnsafe(query: string, ...values: unknown[]): Promise<number>;
};

type IDataPrismaScopedClient = IDataPrismaQueryExecutor & {
  txClient?: () => IDataPrismaQueryExecutor;
  $tx?: <T>(
    fn: (prisma: IDataPrismaQueryExecutor) => Promise<T>,
    options?: {
      maxWait?: number;
      timeout?: number;
      isolationLevel?: unknown;
    }
  ) => Promise<T>;
  $transaction?: <T>(
    fn: (prisma: IDataPrismaQueryExecutor) => Promise<T>,
    options?: {
      maxWait?: number;
      timeout?: number;
      isolationLevel?: unknown;
    }
  ) => Promise<T>;
};

@Injectable()
export class DatabaseRouter {
  constructor(
    private readonly metaPrismaService: MetaPrismaService,
    private readonly dataPrismaService: DataPrismaService,
    @InjectModel(META_KNEX) private readonly metaKnexClient: Knex,
    @InjectModel(DATA_KNEX) private readonly dataKnexClient: Knex,
    private readonly dataDbClientManager: DataDbClientManager
  ) {}

  metaPrisma() {
    return this.metaPrismaService;
  }

  dataPrisma() {
    return this.dataPrismaService;
  }

  metaKnex() {
    return this.metaKnexClient;
  }

  dataKnex() {
    return this.dataKnexClient;
  }

  getDatabaseUrl(target: 'meta' | 'data') {
    return getDatabaseUrl(target);
  }

  async getDataDatabaseUrlForSpace(spaceId: string, options?: IDataDbRoutingOptions) {
    return await this.dataDbClientManager.getDataDatabaseUrlForSpace(spaceId, options);
  }

  async getDataDatabaseUrlForTable(tableId: string, options?: IDataDbRoutingOptions) {
    return await this.dataDbClientManager.getDataDatabaseUrlForTable(tableId, options);
  }

  async getDataDatabaseUrlForBase(baseId: string, options?: IDataDbRoutingOptions) {
    return await this.dataDbClientManager.getDataDatabaseUrlForBase(baseId, options);
  }

  async dataKnexForSpace(spaceId: string, options?: IDataDbRoutingOptions) {
    return await this.dataDbClientManager.dataKnexForSpace(spaceId, options);
  }

  async dataPrismaForSpace(spaceId: string, options?: IDataDbRoutingOptions) {
    return await this.dataDbClientManager.dataPrismaForSpace(spaceId, options);
  }

  async dataKnexForBase(baseId: string, options?: IDataDbRoutingOptions) {
    return await this.dataDbClientManager.dataKnexForBase(baseId, options);
  }

  async dataPrismaForBase(baseId: string, options?: IDataDbRoutingOptions) {
    return await this.dataDbClientManager.dataPrismaForBase(baseId, options);
  }

  async dataKnexForTable(tableId: string, options?: IDataDbRoutingOptions) {
    return await this.dataDbClientManager.dataKnexForTable(tableId, options);
  }

  async dataPrismaForTable(tableId: string, options?: IDataDbRoutingOptions) {
    return await this.dataDbClientManager.dataPrismaForTable(tableId, options);
  }

  private getDataPrismaExecutor(prisma: IDataPrismaScopedClient): IDataPrismaQueryExecutor {
    return prisma.txClient?.() ?? prisma;
  }

  async dataPrismaExecutorForTable(
    tableId: string,
    options?: IDataDbRoutingOptions
  ): Promise<IDataPrismaQueryExecutor> {
    const prisma = (await this.dataPrismaForTable(tableId, options)) as IDataPrismaScopedClient;
    return this.getDataPrismaExecutor(prisma);
  }

  async dataPrismaExecutorForBase(
    baseId: string,
    options?: IDataDbRoutingOptions
  ): Promise<IDataPrismaQueryExecutor> {
    const prisma = (await this.dataPrismaForBase(baseId, options)) as IDataPrismaScopedClient;
    return this.getDataPrismaExecutor(prisma);
  }

  async queryDataPrismaForTable<T = unknown>(
    tableId: string,
    query: string,
    optionsOrFirstValue?: IDataDbRoutingOptions | unknown,
    ...values: unknown[]
  ): Promise<T> {
    const { options, queryValues } = this.normalizeRoutingOptions(optionsOrFirstValue, values);
    const prisma = await this.dataPrismaExecutorForTable(tableId, options);
    return await prisma.$queryRawUnsafe<T>(query, ...queryValues);
  }

  async executeDataPrismaForTable(
    tableId: string,
    query: string,
    optionsOrFirstValue?: IDataDbRoutingOptions | unknown,
    ...values: unknown[]
  ): Promise<number> {
    const { options, queryValues } = this.normalizeRoutingOptions(optionsOrFirstValue, values);
    const prisma = await this.dataPrismaExecutorForTable(tableId, options);
    return await prisma.$executeRawUnsafe(query, ...queryValues);
  }

  async queryDataPrismaForBase<T = unknown>(
    baseId: string,
    query: string,
    optionsOrFirstValue?: IDataDbRoutingOptions | unknown,
    ...values: unknown[]
  ): Promise<T> {
    const { options, queryValues } = this.normalizeRoutingOptions(optionsOrFirstValue, values);
    const prisma = await this.dataPrismaExecutorForBase(baseId, options);
    return await prisma.$queryRawUnsafe<T>(query, ...queryValues);
  }

  async executeDataPrismaForBase(
    baseId: string,
    query: string,
    optionsOrFirstValue?: IDataDbRoutingOptions | unknown,
    ...values: unknown[]
  ): Promise<number> {
    const { options, queryValues } = this.normalizeRoutingOptions(optionsOrFirstValue, values);
    const prisma = await this.dataPrismaExecutorForBase(baseId, options);
    return await prisma.$executeRawUnsafe(query, ...queryValues);
  }

  async dataPrismaTransactionForTable<T>(
    tableId: string,
    fn: (prisma: IDataPrismaQueryExecutor) => Promise<T>,
    options?: {
      maxWait?: number;
      timeout?: number;
      isolationLevel?: unknown;
    },
    routingOptions?: IDataDbRoutingOptions
  ): Promise<T> {
    const prisma = (await this.dataPrismaForTable(
      tableId,
      routingOptions
    )) as IDataPrismaScopedClient;

    if (prisma.$tx) {
      return await prisma.$tx(fn, options);
    }

    if (prisma.$transaction) {
      return await prisma.$transaction(fn, options);
    }

    return await fn(this.getDataPrismaExecutor(prisma));
  }

  async dataPrismaTransactionForBase<T>(
    baseId: string,
    fn: (prisma: IDataPrismaQueryExecutor) => Promise<T>,
    options?: {
      maxWait?: number;
      timeout?: number;
      isolationLevel?: unknown;
    },
    routingOptions?: IDataDbRoutingOptions
  ): Promise<T> {
    const prisma = (await this.dataPrismaForBase(
      baseId,
      routingOptions
    )) as IDataPrismaScopedClient;

    if (prisma.$tx) {
      return await prisma.$tx(fn, options);
    }

    if (prisma.$transaction) {
      return await prisma.$transaction(fn, options);
    }

    return await fn(this.getDataPrismaExecutor(prisma));
  }

  private isRoutingOptions(value: unknown): value is IDataDbRoutingOptions {
    return (
      Boolean(value) &&
      typeof value === 'object' &&
      Object.keys(value as Record<string, unknown>).length > 0 &&
      Object.keys(value as Record<string, unknown>).every((key) => key === 'useTransaction')
    );
  }

  private normalizeRoutingOptions(
    optionsOrFirstValue: IDataDbRoutingOptions | unknown,
    values: unknown[]
  ): { options?: IDataDbRoutingOptions; queryValues: unknown[] } {
    if (this.isRoutingOptions(optionsOrFirstValue)) {
      return { options: optionsOrFirstValue, queryValues: values };
    }

    return {
      queryValues: optionsOrFirstValue === undefined ? values : [optionsOrFirstValue, ...values],
    };
  }
}
