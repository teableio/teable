import {
  createTeableSpanAttributes,
  domainError,
  generateUuid,
  TeableSpanAttributes,
  v2CoreTokens,
  type DomainError,
  type ILogger,
  type ITracer,
  type SpanAttributes,
} from '@teable/v2-core';
import { inject, injectable } from '@teable/v2-di';
import type { V1TeableDatabase } from '@teable/v2-postgres-schema';
import type { Kysely, Transaction } from 'kysely';
import { err, ok } from 'neverthrow';
import type { Result } from 'neverthrow';

import { describeError } from '../../shared/errors';
import { toQualifiedIdentifierLiteral } from '../../shared/sqlIdentifiers';
import {
  clearUndoCaptureBatchId,
  ensureUndoCaptureInfrastructure,
  getUndoCaptureBatchId,
  loadAndClearUndoLogRows,
  restoreUndoCaptureBatchId,
  setUndoCaptureBatchId,
  type UndoCaptureInfrastructureStatus,
  type UndoLogRow,
} from '../../shared/undoCapture';
import { v2RecordRepositoryPostgresTokens } from '../di/tokens';
import type { DynamicDB } from '../query-builder';

type DbOrTx = Kysely<DynamicDB> | Transaction<DynamicDB>;

export interface RecordMutationSnapshotTraceContext {
  readonly tracer?: ITracer;
}

const TRACE_HANDLER = 'PostgresRecordMutationSnapshotCaptureService';

const buildUndoCaptureInfrastructureError = (message: string): DomainError =>
  domainError.infrastructure({ message });

const buildEnsureTableError = (
  tableName: string,
  status: Exclude<UndoCaptureInfrastructureStatus, 'ready'>
): DomainError =>
  status === 'missing_globals'
    ? buildUndoCaptureInfrastructureError(
        `Undo capture globals are missing for "${tableName}". Apply migration 20260406000000_add_v2_undo_capture_infra before running record mutations.`
      )
    : buildUndoCaptureInfrastructureError(
        `Failed to install the "__teable_undo_capture" trigger for "${tableName}".`
      );

const buildTraceAttributes = (
  phase: 'ensureTable' | 'begin' | 'finish' | 'abort',
  extra?: SpanAttributes
): SpanAttributes =>
  createTeableSpanAttributes('repository', `${TRACE_HANDLER}.${phase}`, {
    [TeableSpanAttributes.HANDLER]: TRACE_HANDLER,
    'teable.undo_capture.phase': phase,
    ...extra,
  });

const runWithTraceSpan = async <T>(
  traceContext: RecordMutationSnapshotTraceContext | undefined,
  phase: 'ensureTable' | 'begin' | 'finish' | 'abort',
  attributes: SpanAttributes,
  work: () => Promise<T>
): Promise<T> => {
  const tracer = traceContext?.tracer;
  if (!tracer) {
    return work();
  }

  let span;
  try {
    span = tracer.startSpan(`teable.${TRACE_HANDLER}.${phase}`, attributes);
  } catch {
    return work();
  }

  try {
    return await tracer.withSpan(span, work);
  } catch (error) {
    span.recordError(describeError(error));
    throw error;
  } finally {
    span.end();
  }
};

export interface IPostgresRecordMutationSnapshotCaptureSession {
  finish(): Promise<Result<ReadonlyArray<UndoLogRow>, DomainError>>;
  abort(): Promise<void>;
}

export interface IPostgresRecordMutationSnapshotCaptureService {
  ensureTable(
    traceContext: RecordMutationSnapshotTraceContext | undefined,
    db: DbOrTx,
    tableName: string
  ): Promise<Result<void, DomainError>>;
  begin(
    traceContext: RecordMutationSnapshotTraceContext | undefined,
    db: DbOrTx,
    tableName: string
  ): Promise<Result<IPostgresRecordMutationSnapshotCaptureSession, DomainError>>;
}

class PostgresRecordMutationSnapshotCaptureSession
  implements IPostgresRecordMutationSnapshotCaptureSession
{
  private closed = false;

  constructor(
    private readonly db: DbOrTx,
    private readonly batchId: string,
    private readonly previousBatchId: string | undefined,
    private readonly batchIdLocal: boolean,
    private readonly tableName: string,
    private readonly logger: ILogger,
    private readonly traceContext?: RecordMutationSnapshotTraceContext
  ) {}

  async finish(): Promise<Result<ReadonlyArray<UndoLogRow>, DomainError>> {
    return runWithTraceSpan(
      this.traceContext,
      'finish',
      buildTraceAttributes('finish', {
        'teable.table_name': this.tableName,
        'teable.undo_capture.batch_id': this.batchId,
      }),
      async () => {
        if (this.closed) {
          return ok([]);
        }

        try {
          const rows = await loadAndClearUndoLogRows(this.db, this.batchId);
          return ok(rows.filter((row) => !row.table_name || row.table_name === this.tableName));
        } catch (error) {
          this.logger.warn('undo:capture:read_failed', {
            batchId: this.batchId,
            error: describeError(error),
          });
          return err(
            buildUndoCaptureInfrastructureError(
              `Failed to read undo capture rows for "${this.tableName}": ${describeError(error)}`
            )
          );
        } finally {
          await this.clearBatchId();
          this.closed = true;
        }
      }
    );
  }

  async abort(): Promise<void> {
    await runWithTraceSpan(
      this.traceContext,
      'abort',
      buildTraceAttributes('abort', {
        'teable.table_name': this.tableName,
        'teable.undo_capture.batch_id': this.batchId,
      }),
      async () => {
        if (this.closed) {
          return;
        }
        try {
          await loadAndClearUndoLogRows(this.db, this.batchId);
        } catch (error) {
          this.logger.warn('undo:capture:abort_cleanup_failed', {
            batchId: this.batchId,
            error: describeError(error),
          });
        }
        await this.clearBatchId();
        this.closed = true;
      }
    );
  }

  private async clearBatchId(): Promise<void> {
    try {
      if (this.previousBatchId !== undefined) {
        await restoreUndoCaptureBatchId(this.db, this.previousBatchId, {
          local: this.batchIdLocal,
        });
        return;
      }
      await clearUndoCaptureBatchId(this.db, { local: this.batchIdLocal });
    } catch (error) {
      this.logger.warn('undo:capture:reset_failed', {
        batchId: this.batchId,
        error: describeError(error),
      });
    }
  }
}

@injectable()
export class PostgresRecordMutationSnapshotCaptureService
  implements IPostgresRecordMutationSnapshotCaptureService
{
  constructor(
    @inject(v2RecordRepositoryPostgresTokens.db)
    private readonly rootDb: Kysely<V1TeableDatabase>,
    @inject(v2CoreTokens.logger)
    private readonly logger: ILogger
  ) {}

  async ensureTable(
    traceContext: RecordMutationSnapshotTraceContext | undefined,
    db: DbOrTx,
    tableName: string
  ): Promise<Result<void, DomainError>> {
    return runWithTraceSpan(
      traceContext,
      'ensureTable',
      buildTraceAttributes('ensureTable', {
        'teable.table_name': tableName,
      }),
      async () => {
        const ensured = await ensureUndoCaptureInfrastructure(
          this.rootDb,
          db,
          toQualifiedIdentifierLiteral(tableName),
          tableName
        );

        if (ensured !== 'ready') {
          this.logger.warn('undo:capture:ensure_failed', {
            tableName,
            status: ensured,
          });
          return err(buildEnsureTableError(tableName, ensured));
        }

        return ok(undefined);
      }
    );
  }

  async begin(
    traceContext: RecordMutationSnapshotTraceContext | undefined,
    db: DbOrTx,
    tableName: string
  ): Promise<Result<IPostgresRecordMutationSnapshotCaptureSession, DomainError>> {
    return runWithTraceSpan(
      traceContext,
      'begin',
      buildTraceAttributes('begin', {
        'teable.table_name': tableName,
      }),
      async () => {
        const ensureResult = await this.ensureTable(traceContext, db, tableName);
        if (ensureResult.isErr()) {
          return err(ensureResult.error);
        }

        const batchId = generateUuid();
        const previousBatchId = await getUndoCaptureBatchId(db);
        let batchIdLocal = true;
        let setResult = await setUndoCaptureBatchId(db, batchId, { local: true });
        const verifiedBatchId = await getUndoCaptureBatchId(db);
        if (setResult && verifiedBatchId !== batchId) {
          batchIdLocal = false;
          setResult = await setUndoCaptureBatchId(db, batchId, { local: false });
        }
        const finalVerifiedBatchId =
          verifiedBatchId === batchId ? verifiedBatchId : await getUndoCaptureBatchId(db);
        if (!setResult) {
          this.logger.warn('undo:capture:begin_failed', {
            tableName,
            batchId,
          });
          return err(
            buildUndoCaptureInfrastructureError(
              `Failed to activate undo capture for "${tableName}" with batch "${batchId}".`
            )
          );
        }
        if (finalVerifiedBatchId !== batchId) {
          this.logger.warn('undo:capture:begin_verify_failed', {
            tableName,
            batchId,
            verifiedBatchId: finalVerifiedBatchId ?? null,
          });
          return err(
            buildUndoCaptureInfrastructureError(
              `Failed to verify undo capture batch "${batchId}" for "${tableName}".`
            )
          );
        }

        return ok(
          new PostgresRecordMutationSnapshotCaptureSession(
            db,
            batchId,
            previousBatchId,
            batchIdLocal,
            tableName,
            this.logger,
            traceContext
          )
        );
      }
    );
  }
}
