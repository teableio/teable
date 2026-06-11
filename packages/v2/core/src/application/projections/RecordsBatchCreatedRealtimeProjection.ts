import { inject, injectable } from '@teable/v2-di';
import { ok, safeTry } from 'neverthrow';
import type { Result } from 'neverthrow';

import type { DomainError } from '../../domain/shared/DomainError';
import { RecordsBatchCreated } from '../../domain/table/events/RecordsBatchCreated';
import { NoopAttachmentUrlSignerService } from '../../ports/defaults/NoopAttachmentUrlSignerService';
import type { IEventHandler } from '../../ports/EventHandler';
import type * as ExecutionContextPort from '../../ports/ExecutionContext';
import { RealtimeDocId } from '../../ports/RealtimeDocId';
import * as RealtimeEnginePort from '../../ports/RealtimeEngine';
import { v2CoreTokens } from '../../ports/tokens';
import { teableSpanName } from '../../ports/Tracer';
import { AttachmentValueDecoratorService } from '../services/AttachmentValueDecoratorService';
import { shouldSkipRealtimeBatchMutation } from './BatchRecordRefreshPolicy';
import { decorateRealtimeAttachmentValue } from './decorateRealtimeAttachmentValue';
import { ProjectionHandler } from './Projection';
import { runRealtimeTasks } from './runRealtimeTasks';
import { buildRecordCollection, type ITableRecordRealtimeDTO } from './TableRecordRealtimeDTO';
import { buildRealtimeFanoutSpanAttributes, withRealtimeFanoutSpan } from './traceRealtimeFanout';

@ProjectionHandler(RecordsBatchCreated)
@injectable()
export class RecordsBatchCreatedRealtimeProjection implements IEventHandler<RecordsBatchCreated> {
  constructor(
    @inject(v2CoreTokens.realtimeEngine)
    private readonly realtimeEngine: RealtimeEnginePort.IRealtimeEngine,
    @inject(v2CoreTokens.attachmentValueDecoratorService)
    private readonly attachmentValueDecoratorService: AttachmentValueDecoratorService = new AttachmentValueDecoratorService(
      new NoopAttachmentUrlSignerService()
    )
  ) {}

  async handle(
    context: ExecutionContextPort.IExecutionContext,
    event: RecordsBatchCreated
  ): Promise<Result<void, DomainError>> {
    const { realtimeEngine, attachmentValueDecoratorService } = this;
    const orchestration = event.orchestration;
    const totalRecordCount = orchestration?.totalRecordCount ?? event.records.length;
    const fanoutCount = event.records.length;
    const skipRealtime = shouldSkipRealtimeBatchMutation(totalRecordCount, orchestration);
    const fanoutAttributes = buildRealtimeFanoutSpanAttributes({
      totalRecordCount,
      chunkRecordCount: event.records.length,
      fanoutCount,
      skipRealtime,
      orchestration,
    });

    if (skipRealtime) {
      await withRealtimeFanoutSpan(
        context,
        teableSpanName('teable.RecordsBatchCreatedRealtimeProjection.realtimeFanout'),
        fanoutAttributes,
        async () => ok(undefined)
      );
      return ok(undefined);
    }

    return safeTry(async function* () {
      const collection = buildRecordCollection(event.tableId.toString());
      // The Created path wraps safeTry inside `async () => ...`, so the inferred
      // return is Promise<Result<undefined, _>> (the async wraps ResultAsync).
      const tasks: Array<() => Promise<Result<undefined, DomainError>>> = [];

      for (const record of event.records) {
        const docId = yield* RealtimeDocId.fromParts(collection, record.recordId).safeUnwrap();

        tasks.push(async () =>
          safeTry(async function* () {
            // Convert fields array to flat map
            const fields: Record<string, unknown> = {};
            for (const fieldValue of record.fields) {
              fields[fieldValue.fieldId] = yield* (
                await decorateRealtimeAttachmentValue(
                  attachmentValueDecoratorService,
                  fieldValue.value
                )
              ).safeUnwrap();
            }

            const snapshot: ITableRecordRealtimeDTO = {
              id: record.recordId,
              fields,
            };

            yield* (await realtimeEngine.ensure(context, docId, snapshot)).safeUnwrap();
            return ok(undefined);
          })
        );
      }

      yield* (
        await withRealtimeFanoutSpan(
          context,
          teableSpanName('teable.RecordsBatchCreatedRealtimeProjection.realtimeFanout'),
          fanoutAttributes,
          async () => {
            for (const result of await runRealtimeTasks(tasks)) {
              result._unsafeUnwrap();
            }

            return ok(undefined);
          }
        )
      ).safeUnwrap();

      return ok(undefined);
    });
  }
}
