import { hostname } from 'node:os';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { IPgPoolLease } from '@teable/db-main-prisma';
import { PgPoolRegistry } from '@teable/db-main-prisma';
import { createV2PostgresDb } from '@teable/v2-adapter-db-postgres-pg';
import {
  ensureTableQueryObservationSchema,
  PostgresTableQueryObservationRepository,
  type TableQueryObservationDatabase,
} from '@teable/v2-adapter-table-query-ops-postgres';
import type { DomainError, IExecutionContext } from '@teable/v2-core';
import {
  BufferedTableQueryObservationPublisher,
  type TableQueryObservationPublisher,
  type TableQueryObservationReader,
  type TableQueryObservationSink,
  type TableQueryObservationWindow,
  type TableQuerySearchHeatByTable,
} from '@teable/v2-table-query-ops';
import type { Kysely } from 'kysely';
import { ok, type Result } from 'neverthrow';
import { resolveBoolean, resolvePositiveInteger } from './v2-config-parsers';

export type TableQueryObservationRuntime = {
  readonly db: Kysely<TableQueryObservationDatabase>;
  readonly publisher: TableQueryObservationPublisher;
  readonly repository: PostgresTableQueryObservationRepository;
};

type OwnedTableQueryObservationRuntime = TableQueryObservationRuntime & {
  readonly buffer: BufferedTableQueryObservationPublisher;
  readonly lease: IPgPoolLease;
  readonly pruneTimer: NodeJS.Timeout;
};

@Injectable()
export class TableQueryObservationRuntimeService
  implements TableQueryObservationPublisher, TableQueryObservationReader, TableQueryObservationSink
{
  private readonly logger = new Logger(TableQueryObservationRuntimeService.name);
  private retryAfter = 0;
  private disposed = false;
  private schemaEnsureTimer: NodeJS.Timeout | undefined;
  private runtime: OwnedTableQueryObservationRuntime | undefined;
  private runtimePromise: Promise<OwnedTableQueryObservationRuntime | undefined> | undefined;

  constructor(
    private readonly configService: ConfigService,
    private readonly pgPoolRegistry: PgPoolRegistry
  ) {}

  get(): Promise<TableQueryObservationRuntime | undefined> {
    if (this.disposed || Date.now() < this.retryAfter) return Promise.resolve(undefined);
    if (!this.runtimePromise) {
      const attempt = this.create().catch((error: unknown) => {
        this.logger.error(
          'Table query observations disabled: unexpected runtime initialization failure',
          error instanceof Error ? error.stack : undefined
        );
        return undefined;
      });
      this.runtimePromise = attempt;
      void attempt.then((runtime) => {
        if (runtime) {
          this.runtime = runtime;
        } else if (this.runtimePromise === attempt) {
          this.runtimePromise = undefined;
          this.retryAfter = Date.now() + 5_000;
        }
      });
    }
    return this.runtimePromise;
  }
  publish(context: IExecutionContext, observation: TableQueryObservationWindow): void {
    if (this.runtime) {
      this.runtime.publisher.publish(context, observation);
      return;
    }
    void this.get().then((runtime) => runtime?.publisher.publish(context, observation));
  }

  async record(
    context: IExecutionContext,
    observation: TableQueryObservationWindow
  ): Promise<Result<void, DomainError>> {
    const runtime = await this.get();
    return runtime ? runtime.repository.record(context, observation) : ok(undefined);
  }

  async findRecent(
    context: IExecutionContext,
    input: { readonly since: Date; readonly limit: number; readonly tableId?: string }
  ): Promise<Result<ReadonlyArray<TableQueryObservationWindow>, DomainError>> {
    const runtime = await this.get();
    return runtime ? runtime.repository.findRecent(context, input) : ok([]);
  }

  async findSearchHeatByTable(
    context: IExecutionContext,
    input: {
      readonly since: Date;
      readonly minSlowCount: number;
      readonly limit: number;
      readonly wideSearchFields: number;
    }
  ): Promise<Result<ReadonlyArray<TableQuerySearchHeatByTable>, DomainError>> {
    const runtime = await this.get();
    return runtime ? runtime.repository.findSearchHeatByTable(context, input) : ok([]);
  }

  async dispose(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    clearTimeout(this.schemaEnsureTimer);
    this.schemaEnsureTimer = undefined;
    const runtime = await this.runtimePromise;
    if (!runtime) return;
    this.runtime = undefined;
    clearInterval(runtime.pruneTimer);
    runtime.buffer.stop();
    await Promise.allSettled([runtime.db.destroy(), runtime.lease.release()]);
  }

  private async create(): Promise<OwnedTableQueryObservationRuntime | undefined> {
    const connectionString =
      this.configService.get<string>('PRISMA_META_DATABASE_URL') ??
      this.configService.get<string>('PRISMA_DATABASE_URL') ??
      this.configService.get<string>('DATABASE_URL');
    if (!connectionString) {
      this.logger.warn('Table query observations disabled: missing metadata database URL');
      return undefined;
    }

    const connectionTimeoutMs =
      resolvePositiveInteger(
        this.configService.get('V2_TABLE_QUERY_OPS_POOL_CONNECTION_TIMEOUT_MS')
      ) ?? 5_000;
    let lease: IPgPoolLease | undefined;
    let db: Kysely<TableQueryObservationDatabase> | undefined;
    try {
      lease = this.pgPoolRegistry.acquire(connectionString, {
        applicationName: 'teable-table-query-observation',
        connectionTimeoutMillis: connectionTimeoutMs,
        max: 2,
        poolName: 'table-query-observation',
      });
      db = await createV2PostgresDb<TableQueryObservationDatabase>(
        { pg: { connectionString } },
        { pool: lease.pool }
      );
      if (resolveBoolean(this.configService.get('V2_TABLE_QUERY_OPS_ENSURE_SCHEMA'), true)) {
        this.ensureObservationSchema(db);
      }
      const repository = new PostgresTableQueryObservationRepository(db, {
        lockTimeoutMs:
          resolvePositiveInteger(this.configService.get('V2_TABLE_QUERY_OPS_LOCK_TIMEOUT_MS')) ??
          250,
        statementTimeoutMs:
          resolvePositiveInteger(
            this.configService.get('V2_TABLE_QUERY_OPS_STATEMENT_TIMEOUT_MS')
          ) ?? 500,
      });
      const buffer = new BufferedTableQueryObservationPublisher(repository, {
        writerId: `${hostname()}:${process.pid}`,
        flushIntervalMs:
          resolvePositiveInteger(this.configService.get('V2_TABLE_QUERY_OPS_FLUSH_INTERVAL_MS')) ??
          10_000,
        maxPendingKeys:
          resolvePositiveInteger(this.configService.get('V2_TABLE_QUERY_OPS_MAX_PENDING_KEYS')) ??
          1_000,
        batchSize:
          resolvePositiveInteger(this.configService.get('V2_TABLE_QUERY_OPS_BATCH_SIZE')) ?? 100,
      });
      const retentionMs =
        (resolvePositiveInteger(this.configService.get('V2_TABLE_QUERY_OPS_RETENTION_DAYS')) ??
          45) *
        24 *
        60 *
        60 *
        1_000;
      const pruneTimer = setInterval(
        () => {
          void repository.pruneBefore(new Date(Date.now() - retentionMs)).then((result) => {
            if (result.isErr()) {
              this.logger.warn(`Table query observation pruning failed: ${result.error.message}`);
            }
          });
        },
        24 * 60 * 60 * 1_000
      );
      pruneTimer.unref?.();

      this.logger.log('Table query observations use an isolated max=2 PostgreSQL pool');
      return { db, publisher: buffer, buffer, repository, lease, pruneTimer };
    } catch (error) {
      await Promise.allSettled([
        db?.destroy() ?? Promise.resolve(),
        lease?.release() ?? Promise.resolve(),
      ]);
      this.logger.error(
        'Table query observations disabled: isolated runtime initialization failed',
        error instanceof Error ? error.stack : undefined
      );
      return undefined;
    }
  }
  private ensureObservationSchema(db: Kysely<TableQueryObservationDatabase>): void {
    void ensureTableQueryObservationSchema(db).catch((error: unknown) => {
      if (this.disposed) return;
      this.logger.warn(
        `Table query observation schema ensure failed; retrying in 5 seconds: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
      this.schemaEnsureTimer = setTimeout(() => {
        this.schemaEnsureTimer = undefined;
        this.ensureObservationSchema(db);
      }, 5_000);
      this.schemaEnsureTimer.unref?.();
    });
  }
}
