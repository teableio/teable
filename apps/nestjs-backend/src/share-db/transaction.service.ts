/* eslint-disable sonarjs/no-duplicate-string */
import { Injectable } from '@nestjs/common';
import type { Prisma } from '@teable-group/db-main-prisma';
import { PrismaService } from '../../src/prisma.service';

export interface ITransactionMeta {
  transactionKey: string;
  opCount: number;
  skipCalculate?: boolean;
}

@Injectable()
export class TransactionService {
  constructor(private readonly prismaService: PrismaService) {}
  private cache: Map<
    string,
    {
      currentCount: number;
      opCount: number;
      client?: Prisma.TransactionClient;
      transactionPromise: Promise<void>;
      tasksPromiseCb: { resolve: (value: unknown) => void; reject: (reason?: unknown) => void };
    }
  > = new Map();

  private async newTransaction(tsMeta: ITransactionMeta) {
    let tasksPromiseCb:
      | { resolve: (value: unknown) => void; reject: (reason?: unknown) => void }
      | undefined = undefined;

    const tasksPromise = new Promise((resolve, reject) => {
      tasksPromiseCb = { resolve, reject };
    });

    let prismaResolveFn: (value: Prisma.TransactionClient) => void;
    const prismaPromise = new Promise<Prisma.TransactionClient>((resolve) => {
      prismaResolveFn = resolve;
    });

    const transactionPromise = this.prismaService.$transaction(async (prisma) => {
      console.log('transaction start', tsMeta.transactionKey, tsMeta.opCount);
      prismaResolveFn(prisma);
      await tasksPromise;
      console.log('transaction done', tsMeta.transactionKey, tsMeta.opCount);
    });

    const cacheValue = {
      currentCount: 0,
      opCount: tsMeta.opCount,
      transactionPromise,
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      tasksPromiseCb: tasksPromiseCb!,
    };
    this.cache.set(tsMeta.transactionKey, cacheValue);

    const prismaClient = await prismaPromise;

    this.cache.set(tsMeta.transactionKey, { ...cacheValue, client: prismaClient });

    return prismaClient;
  }

  updateTransaction(tsMeta: ITransactionMeta) {
    const cache = this.cache.get(tsMeta.transactionKey);
    if (!cache) {
      throw new Error('Can not find transaction: ' + tsMeta.transactionKey);
    }

    this.cache.set(tsMeta.transactionKey, {
      ...cache,
      ...tsMeta,
    });
  }

  getCache(transactionKey: string) {
    return this.cache.get(transactionKey);
  }

  async taskComplete(err: unknown, tsMeta: ITransactionMeta): Promise<boolean> {
    err && console.error(err);
    // console.log('taskComplete:input', tsMeta);
    const cache = this.cache.get(tsMeta.transactionKey);
    // console.log('taskComplete:cache', {
    //   transactionKey: tsMeta.transactionKey,
    //   opCount: cache?.opCount,
    // });
    if (!cache) {
      throw new Error('Can not find transaction: ' + tsMeta.transactionKey);
    }
    const { opCount, transactionPromise, tasksPromiseCb } = cache;

    if (err) {
      this.cache.delete(tsMeta.transactionKey);
      tasksPromiseCb.reject(err);
      return false;
    }

    const currentCount = cache.currentCount + 1;
    if (opCount === currentCount) {
      this.cache.delete(tsMeta.transactionKey);
      tasksPromiseCb.resolve(undefined);
      await transactionPromise;
      return true;
    }
    this.cache.set(tsMeta.transactionKey, {
      ...cache,
      currentCount,
    });
    return false;
  }

  private wait(ms = 0) {
    return new Promise((resolve) => {
      setTimeout(() => {
        resolve(undefined);
      }, ms);
    });
  }

  private async waitClient(transactionKey: string) {
    let ms = 0;
    // 1250ms total
    while (ms < 50) {
      await this.wait(++ms);
      const cache = this.cache.get(transactionKey);
      if (!cache) {
        throw new Error('Can not find transaction: ' + transactionKey);
      }
      if (cache.client) {
        return cache.client;
      }
    }
    throw new Error('max wait time exceed: ' + transactionKey);
  }

  async getTransaction(tsMeta?: {
    transactionKey?: string;
    opCount?: number;
  }): Promise<Prisma.TransactionClient> {
    if (!tsMeta || !tsMeta.transactionKey) {
      return this.prismaService;
    }
    const { transactionKey, opCount } = tsMeta;
    if (!opCount) {
      throw new Error("opCount can't be empty");
    }

    const cache = this.cache.get(transactionKey);
    let prismaClient: Prisma.TransactionClient;
    if (cache) {
      if (cache.client) {
        return cache.client;
      } else {
        return await this.waitClient(transactionKey);
      }
    } else {
      prismaClient = await this.newTransaction({ transactionKey, opCount });
    }

    return prismaClient;
  }
}
