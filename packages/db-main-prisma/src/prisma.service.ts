import type { OnModuleInit } from '@nestjs/common';
import { Injectable, Logger } from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';
import { nanoid } from 'nanoid';
import type { ClsService } from 'nestjs-cls';
import type { IDatabaseTarget } from './database-url';
import type { IPgPoolLease } from './pg-pool-registry';
import { createPrismaPgAdapter } from './prisma-pg-adapter';
import { TimeoutHttpException } from './utils';

interface ITx {
  client?: Prisma.TransactionClient;
  timeStr?: string;
  id?: string;
  rawOpMaps?: unknown;
  completionCallbacks?: Array<() => Promise<void>>;
  afterCommitCallbacks?: Array<() => Promise<void>>;
  schemaLeaseChecks?: Set<() => Promise<void>>;
}

type ITxStoreKey = 'tx' | 'dataTx';

function proxyClient(tx: Prisma.TransactionClient) {
  return new Proxy(tx, {
    get(target, p) {
      if (p === '$queryRawUnsafe' || p === '$executeRawUnsafe') {
        return async function (query: string, ...args: unknown[]) {
          try {
            return await target[p](query, ...args);
          } catch (e: unknown) {
            if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2028') {
              throw new TimeoutHttpException();
            }
            throw e;
          }
        };
      }
      return target[p as keyof typeof target];
    },
  });
}

@Injectable()
class NamedPrismaService
  extends PrismaClient<Prisma.PrismaClientOptions, 'query'>
  implements OnModuleInit
{
  private readonly logger: Logger;

  private afterTxCb?: () => void;

  // Default transaction options from environment variables
  // Prisma's built-in defaults: timeout=5000ms, maxWait=2000ms
  private readonly defaultTxTimeout = Number(process.env.PRISMA_TRANSACTION_TIMEOUT ?? 5000);
  private readonly defaultTxMaxWait = Number(process.env.PRISMA_TRANSACTION_MAX_WAIT ?? 2000);

  constructor(
    private readonly cls: ClsService<Record<ITxStoreKey, ITx>>,
    target: IDatabaseTarget,
    private readonly txStoreKey: ITxStoreKey,
    private readonly poolLease: IPgPoolLease,
    schema?: string
  ) {
    const logConfig = {
      log: [
        // {
        //   level: 'query',
        //   emit: 'event',
        // },
        {
          level: 'error',
          emit: 'stdout',
        },
        // {
        //   level: 'info',
        //   emit: 'stdout',
        // },
        // {
        //   level: 'warn',
        //   emit: 'stdout',
        // },
      ],
    };
    const initialConfig = process.env.NODE_ENV === 'production' ? {} : { ...logConfig };

    super({
      ...initialConfig,
      adapter: createPrismaPgAdapter(poolLease.pool, schema),
    });

    this.logger = new Logger(target === 'meta' ? MetaPrismaService.name : DataPrismaService.name);

    // Log transaction timeout configuration on startup (must be after super())
    console.log(
      `[${target} PrismaService] Transaction defaults: timeout=${this.defaultTxTimeout}ms, maxWait=${this.defaultTxMaxWait}ms (from env: PRISMA_TRANSACTION_TIMEOUT=${process.env.PRISMA_TRANSACTION_TIMEOUT}, PRISMA_TRANSACTION_MAX_WAIT=${process.env.PRISMA_TRANSACTION_MAX_WAIT})`
    );
  }

  /** Compare the registry-owned pool itself, including its connection role and options. */
  usesPgPool(pool: IPgPoolLease['pool']): boolean {
    return this.poolLease.pool === pool;
  }

  bindAfterTransaction(fn: () => void) {
    this.afterTxCb = fn;
  }

  /** Runs the registered post-commit hook after an externally owned transaction commits. */
  async flushAfterTransaction(): Promise<void> {
    await this.afterTxCb?.();
  }

  /** Registers only while a real transaction is active; never runs after rollback. */
  afterCommit(callback: () => Promise<void>): boolean {
    const callbacks = this.cls.get(`${this.txStoreKey}.afterCommitCallbacks`);
    if (!callbacks || !this.cls.get(`${this.txStoreKey}.client`)) return false;
    callbacks.push(callback);
    return true;
  }

  /** Lazily attaches rollback work to the existing transaction completion queue. */
  afterRollback(callback: () => Promise<void>): boolean {
    const completion = this.cls.get(`${this.txStoreKey}.completionCallbacks`);
    const afterCommit = this.cls.get(`${this.txStoreKey}.afterCommitCallbacks`);
    if (!completion || !afterCommit || !this.cls.get(`${this.txStoreKey}.client`)) return false;
    let committed = false;
    // Mark the acknowledged commit before any fallible user after-commit callback.
    afterCommit.unshift(async () => {
      committed = true;
    });
    completion.push(async () => {
      if (!committed) await callback();
    });
    return true;
  }

  /**
   * Executes a transaction using the provided function and options.
   * If a transaction client is already defined in the current context, the function is executed using it.
   * Otherwise, a new transaction is created and the function is executed using it.
   * @param fn The function to execute within the transaction.
   * @param options The options to use when creating the transaction.
   * @returns The result of the executed function.
   */
  async $tx<R = unknown>(
    fn: (prisma: Prisma.TransactionClient) => Promise<R>,
    options?: {
      maxWait?: number;
      timeout?: number;
      isolationLevel?: Prisma.TransactionIsolationLevel;
    }
  ): Promise<R> {
    let result: R = undefined as R;
    const txClient = this.cls.get(`${this.txStoreKey}.client`);
    if (txClient) {
      return await fn(txClient);
    }

    // Apply default timeout and maxWait from environment if not explicitly provided
    const txOptions = {
      timeout: options?.timeout ?? this.defaultTxTimeout,
      maxWait: options?.maxWait ?? this.defaultTxMaxWait,
      ...(options?.isolationLevel && { isolationLevel: options.isolationLevel }),
    };

    await this.cls.runWith(this.cls.get(), async () => {
      const completionCallbacks: Array<() => Promise<void>> = [];
      const afterCommitCallbacks: Array<() => Promise<void>> = [];
      try {
        result = await super.$transaction<R>(async (prisma) => {
          prisma = proxyClient(prisma);
          this.cls.set(`${this.txStoreKey}.client`, prisma);
          this.cls.set(`${this.txStoreKey}.id`, nanoid());
          this.cls.set(`${this.txStoreKey}.timeStr`, new Date().toISOString());
          this.cls.set(`${this.txStoreKey}.completionCallbacks`, completionCallbacks);
          this.cls.set(`${this.txStoreKey}.afterCommitCallbacks`, afterCommitCallbacks);
          try {
            const value = await fn(prisma);
            for (const check of this.cls.get(`${this.txStoreKey}.schemaLeaseChecks`) ?? []) {
              await check();
            }
            return value;
          } finally {
            this.cls.set(`${this.txStoreKey}.client`, undefined);
            this.cls.set(`${this.txStoreKey}.id`, undefined);
            this.cls.set(`${this.txStoreKey}.timeStr`, undefined);
            this.cls.set(`${this.txStoreKey}.completionCallbacks`, undefined);
            this.cls.set(`${this.txStoreKey}.afterCommitCallbacks`, undefined);
            this.cls.set(`${this.txStoreKey}.schemaLeaseChecks`, undefined);
          }
        }, txOptions);
        for (const callback of afterCommitCallbacks) await callback();
        this.afterTxCb?.();
      } finally {
        // Schema leases protect until PostgreSQL has acknowledged commit or rollback,
        // not merely until the inner mutation callback returned.
        for (const release of completionCallbacks.reverse()) await release();
      }
    });

    return result;
  }

  txClient(): Prisma.TransactionClient {
    const txClient = this.cls.get(`${this.txStoreKey}.client`);
    if (!txClient) {
      // console.log('transactionId', 'none');
      return this;
    }
    // const id = this.cls.get('tx.id');
    // console.log('transactionId', id);
    return txClient;
  }

  async onModuleInit() {
    await this.$connect();

    if (process.env.NODE_ENV === 'production') return;

    this.$on('query', async (e) => {
      this.logger.debug({
        // Query: e.query.trim().replace(/\s+/g, ' ').replace(/\( /g, '(').replace(/ \)/g, ')'),
        Query: e.query,
        Params: e.params,
        Duration: `${e.duration} ms`,
      });
    });
  }

  async onModuleDestroy() {
    try {
      await this.$disconnect();
    } finally {
      await this.poolLease.release();
    }
  }
}

@Injectable()
export class MetaPrismaService extends NamedPrismaService {
  constructor(cls: ClsService<Record<ITxStoreKey, ITx>>, poolLease: IPgPoolLease, schema?: string) {
    super(cls, 'meta', 'tx', poolLease, schema);
  }
}

@Injectable()
export class PrismaService extends MetaPrismaService {}

@Injectable()
export class DataPrismaService extends NamedPrismaService {
  constructor(cls: ClsService<Record<ITxStoreKey, ITx>>, poolLease: IPgPoolLease, schema?: string) {
    super(cls, 'data', 'dataTx', poolLease, schema);
  }
}
