import { inject, injectable } from '@teable/v2-di';
import { ok, safeTry } from 'neverthrow';
import type { Result } from 'neverthrow';

import type { DomainError } from '../../domain/shared/DomainError';
import { RecordCreated } from '../../domain/table/events/RecordCreated';
import { NoopAttachmentUrlSignerService } from '../../ports/defaults/NoopAttachmentUrlSignerService';
import type { IEventHandler } from '../../ports/EventHandler';
import type * as ExecutionContextPort from '../../ports/ExecutionContext';
import { RealtimeDocId } from '../../ports/RealtimeDocId';
import * as RealtimeEnginePort from '../../ports/RealtimeEngine';
import * as RecordQueryRepositoryPort from '../../ports/TableRecordQueryRepository';
import * as TableRepositoryPort from '../../ports/TableRepository';
import { v2CoreTokens } from '../../ports/tokens';
import { AttachmentValueDecoratorService } from '../services/AttachmentValueDecoratorService';
import { decorateRealtimeAttachmentValue } from './decorateRealtimeAttachmentValue';
import { ProjectionHandler } from './Projection';
import { readRealtimeRecordActors } from './readRealtimeRecordActors';
import {
  buildRecordCollection,
  unknownRecordRealtimeActors,
  type ITableRecordRealtimeDTO,
} from './TableRecordRealtimeDTO';

@ProjectionHandler(RecordCreated)
@injectable()
export class RecordCreatedRealtimeProjection implements IEventHandler<RecordCreated> {
  constructor(
    @inject(v2CoreTokens.realtimeEngine)
    private readonly realtimeEngine: RealtimeEnginePort.IRealtimeEngine,
    @inject(v2CoreTokens.tableRepository)
    private readonly tables: TableRepositoryPort.ITableRepository,
    @inject(v2CoreTokens.tableRecordQueryRepository)
    private readonly records: RecordQueryRepositoryPort.ITableRecordQueryRepository,
    @inject(v2CoreTokens.attachmentValueDecoratorService)
    private readonly attachmentValueDecoratorService: AttachmentValueDecoratorService = new AttachmentValueDecoratorService(
      new NoopAttachmentUrlSignerService()
    )
  ) {}

  async handle(
    context: ExecutionContextPort.IExecutionContext,
    event: RecordCreated
  ): Promise<Result<void, DomainError>> {
    const { realtimeEngine, attachmentValueDecoratorService, tables, records } = this;

    return safeTry(async function* () {
      const actors = yield* await readRealtimeRecordActors(
        context,
        event.baseId,
        event.tableId,
        [event.recordId.toString()],
        tables,
        records
      );
      const collection = buildRecordCollection(event.tableId.toString());
      const docId = yield* RealtimeDocId.fromParts(
        collection,
        event.recordId.toString()
      ).safeUnwrap();

      // Convert fieldValues array to flat map
      const fields: Record<string, unknown> = {};
      for (const fieldValue of event.fieldValues) {
        fields[fieldValue.fieldId] = yield* (
          await decorateRealtimeAttachmentValue(attachmentValueDecoratorService, fieldValue.value)
        ).safeUnwrap();
      }

      const snapshot: ITableRecordRealtimeDTO = {
        id: event.recordId.toString(),
        fields,
        ...(actors.get(event.recordId.toString())!.version === 1
          ? actors.get(event.recordId.toString())!.actors
          : unknownRecordRealtimeActors),
      };

      yield* (await realtimeEngine.ensure(context, docId, snapshot)).safeUnwrap();

      return ok(undefined);
    });
  }
}
