import type { OnModuleInit } from '@nestjs/common';
import { Injectable, Logger } from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';
import { nanoid } from 'nanoid';
import type { ClsService } from 'nestjs-cls';
import { getDataDatabaseUrl, isSharedMetaDataDatabase } from './database-url';
import { TimeoutHttpException } from './utils';

interface IDataTxStore {
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
export class DataPrismaService
  extends PrismaClient<Prisma.PrismaClientOptions, 'query'>
  implements OnModuleInit
{
  private readonly logger = new Logger(DataPrismaService.name);
  private readonly sharedMetaDataDatabase = isSharedMetaDataDatabase();

  private afterTxCb?: () => void;

  private readonly defaultTxTimeout = Number(process.env.PRISMA_TRANSACTION_TIMEOUT ?? 5000);
  private readonly defaultTxMaxWait = Number(process.env.PRISMA_TRANSACTION_MAX_WAIT ?? 2000);

  constructor(private readonly cls: ClsService<Record<'dataTx', IDataTxStore>>) {
    const logConfig = {
      log: [
        {
          level: 'error',
          emit: 'stdout',
        },
      ],
    };
    const initialConfig = process.env.NODE_ENV === 'production' ? {} : { ...logConfig };

    super({
      ...initialConfig,
      datasources: {
        db: {
          url: getDataDatabaseUrl(),
        },
      },
    });

    console.log(
      `[data PrismaService] Transaction defaults: timeout=${this.defaultTxTimeout}ms, maxWait=${this.defaultTxMaxWait}ms (from env: PRISMA_TRANSACTION_TIMEOUT=${process.env.PRISMA_TRANSACTION_TIMEOUT}, PRISMA_TRANSACTION_MAX_WAIT=${process.env.PRISMA_TRANSACTION_MAX_WAIT})`
    );
  }

  bindAfterTransaction(fn: () => void) {
    this.afterTxCb = fn;
  }

  private getMetaTxClient(): Prisma.TransactionClient | undefined {
    if (!this.sharedMetaDataDatabase) {
      return;
    }

    return this.cls.get('tx.client' as never) as Prisma.TransactionClient | undefined;
  }

  async $tx<R = unknown>(
    fn: (prisma: Prisma.TransactionClient) => Promise<R>,
    options?: {
      maxWait?: number;
      timeout?: number;
      isolationLevel?: Prisma.TransactionIsolationLevel;
    }
  ): Promise<R> {
    let result: R = undefined as R;
    const txClient = this.cls.get('dataTx.client');
    if (txClient) {
      return await fn(txClient);
    }

    const metaTxClient = this.getMetaTxClient();
    if (metaTxClient) {
      return await fn(metaTxClient);
    }

    const txOptions = {
      timeout: options?.timeout ?? this.defaultTxTimeout,
      maxWait: options?.maxWait ?? this.defaultTxMaxWait,
      ...(options?.isolationLevel && { isolationLevel: options.isolationLevel }),
    };

    await this.cls.runWith(this.cls.get(), async () => {
      result = await super.$transaction<R>(async (prisma) => {
        prisma = proxyClient(prisma);
        this.cls.set('dataTx.client', prisma);
        this.cls.set('dataTx.id', nanoid());
        this.cls.set('dataTx.timeStr', new Date().toISOString());
        try {
          return await fn(prisma);
        } finally {
          this.cls.set('dataTx.client', undefined);
          this.cls.set('dataTx.id', undefined);
          this.cls.set('dataTx.timeStr', undefined);
        }
      }, txOptions);
      this.afterTxCb?.();
    });

    return result;
  }

  txClient(): Prisma.TransactionClient {
    const txClient = this.cls.get('dataTx.client');
    if (txClient) {
      return txClient;
    }

    const metaTxClient = this.getMetaTxClient();
    if (metaTxClient) {
      return metaTxClient;
    }

    return this;
  }

  async onModuleInit() {
    await this.$connect();

    if (process.env.NODE_ENV === 'production') return;

    this.$on('query', async (e) => {
      this.logger.debug({
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
