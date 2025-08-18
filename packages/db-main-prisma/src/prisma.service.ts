import type { OnModuleInit } from '@nestjs/common';
import { Injectable, Logger } from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';
import { nanoid } from 'nanoid';
import type { ClsService } from 'nestjs-cls';
import { TimeoutHttpException } from './utils';

interface ITx {
  client?: Prisma.TransactionClient;
  timeStr?: string;
  id?: string;
  rawOpMaps?: unknown;
}

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
export class PrismaService
  extends PrismaClient<Prisma.PrismaClientOptions, 'query'>
  implements OnModuleInit
{
  private readonly logger = new Logger(PrismaService.name);

  private afterTxCb?: () => void;

  // Default transaction options from environment variables
  // Prisma's built-in defaults: timeout=5000ms, maxWait=2000ms
  private readonly defaultTxTimeout = Number(process.env.PRISMA_TRANSACTION_TIMEOUT ?? 5000);
  private readonly defaultTxMaxWait = Number(process.env.PRISMA_TRANSACTION_MAX_WAIT ?? 2000);

  constructor(private readonly cls: ClsService<{ tx: ITx }>) {
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

    super(initialConfig);

    // Log transaction timeout configuration on startup (must be after super())
    console.log(
      `[PrismaService] Transaction defaults: timeout=${this.defaultTxTimeout}ms, maxWait=${this.defaultTxMaxWait}ms (from env: PRISMA_TRANSACTION_TIMEOUT=${process.env.PRISMA_TRANSACTION_TIMEOUT}, PRISMA_TRANSACTION_MAX_WAIT=${process.env.PRISMA_TRANSACTION_MAX_WAIT})`
    );
  }

  bindAfterTransaction(fn: () => void) {
    this.afterTxCb = fn;
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
    const txClient = this.cls.get('tx.client');
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
      result = await super.$transaction<R>(async (prisma) => {
        prisma = proxyClient(prisma);
        this.cls.set('tx.client', prisma);
        this.cls.set('tx.id', nanoid());
        this.cls.set('tx.timeStr', new Date().toISOString());
        try {
          // can not delete await here
          return await fn(prisma);
        } finally {
          this.cls.set('tx.client', undefined);
          this.cls.set('tx.id', undefined);
          this.cls.set('tx.timeStr', undefined);
        }
      }, txOptions);
      this.afterTxCb?.();
    });

    return result;
  }

  txClient(): Prisma.TransactionClient {
    const txClient = this.cls.get('tx.client');
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
    await this.$disconnect();
  }
}
