/* eslint-disable @typescript-eslint/no-non-null-assertion */
/* eslint-disable sonarjs/no-duplicate-string */
import { Injectable, Logger } from '@nestjs/common';
import { generateTransactionKey } from '@teable-group/core';
import type { Prisma } from '@teable-group/db-main-prisma';
import { noop } from 'lodash';
import { PrismaService } from '../../src/prisma.service';
import type { ShareDbService } from './share-db.service';

export interface ITransactionMeta {
  transactionKey: string;
  opCount: number;
  skipCalculate?: boolean;
}

@Injectable()
export class TransactionService {
  private logger = new Logger(TransactionService.name);
  private cache: Map<
    string,
    {
      isBackend?: boolean;
      currentCount?: number;
      opCount?: number;
      client?: Prisma.TransactionClient;
      transactionPromise?: Promise<void>;
      tasksPromiseCb?: { resolve: (value: unknown) => void; reject: (reason?: unknown) => void };
    }
  > = new Map();

  constructor(private readonly prismaService: PrismaService) {}

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

  async $transaction<R>(
    shareDbService: ShareDbService,
    fn: (prisma: Prisma.TransactionClient, transactionKey: string) => Promise<R>,
    options?: {
      maxWait?: number;
      timeout?: number;
      isolationLevel?: Prisma.TransactionIsolationLevel;
    }
  ): Promise<R> {
    const transactionKey = generateTransactionKey();
    this.logger.log('startBackendTransaction:' + transactionKey);
    const result = await this.prismaService.$transaction(async (prisma) => {
      this.cache.set(transactionKey, {
        isBackend: true,
        client: prisma,
      });
      try {
        return await fn(prisma, transactionKey);
      } catch (e) {
        // if transaction has been rollback, cancel publish
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        delete (shareDbService as any).pendingPublish[transactionKey];
        throw e;
      } finally {
        this.completeBackendTransaction(transactionKey);
      }
    }, options);
    this.publishPendingOp(shareDbService, transactionKey);
    return result;
  }

  private completeBackendTransaction(transactionKey: string) {
    const cache = this.cache.get(transactionKey);
    if (!cache || !cache.isBackend) {
      throw new Error('Can not find transaction: ' + transactionKey);
    }
    console.log('completeBackendTransaction', transactionKey);
    this.cache.delete(transactionKey);
  }

  // dispatch op publish event, make sure op is published after transaction is completed
  /* eslint-disable @typescript-eslint/no-explicit-any */
  private publishPendingOp(shareDbService: ShareDbService, transactionKey: string) {
    const pendingPublish = (shareDbService as any).pendingPublish[transactionKey];
    delete (shareDbService as any).pendingPublish[transactionKey];
    if (pendingPublish) {
      pendingPublish.forEach((p: any) => {
        shareDbService.pubsub.publish(p.channels, p.op, noop);
      });
    }
  }
  /* eslint-enable @typescript-eslint/no-explicit-any */

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
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    const cache = this.cache.get(transactionKey);

    return { currentCount: cache?.currentCount, opCount: cache?.opCount };
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
      tasksPromiseCb!.reject(err);
      return false;
    }

    const currentCount = cache.currentCount! + 1;
    if (opCount === currentCount) {
      this.cache.delete(tsMeta.transactionKey);
      tasksPromiseCb!.resolve(undefined);
      await transactionPromise;
      console.log('transaction complete:', tsMeta.transactionKey, tsMeta.opCount);
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

  // for api service use only
  getTransactionSync(transactionKey: string) {
    return this.cache.get(transactionKey)!.client!;
  }

  async getTransaction(
    options:
      | ({ agentCustom?: ITransactionMeta & { isBackend?: boolean } } & ITransactionMeta)
      | undefined
  ): Promise<Prisma.TransactionClient> {
    let tsMeta = undefined;
    if (options?.agentCustom && options.agentCustom.transactionKey) {
      tsMeta = options.agentCustom;
    } else {
      tsMeta = options;
    }

    if (!tsMeta || !tsMeta.transactionKey) {
      return this.prismaService;
    }
    const { transactionKey, opCount } = tsMeta;

    const cache = this.cache.get(transactionKey);
    let prismaClient: Prisma.TransactionClient;
    if (cache) {
      const isBackend = cache?.isBackend;
      if (!opCount && !isBackend) {
        throw new Error("opCount can't be empty");
      }

      if (cache.client) {
        return cache.client;
      } else {
        return await this.waitClient(transactionKey);
      }
    } else {
      if (!opCount) {
        throw new Error("opCount can't be empty");
      }
      prismaClient = await this.newTransaction({ transactionKey, opCount });
    }

    return prismaClient;
  }
}
