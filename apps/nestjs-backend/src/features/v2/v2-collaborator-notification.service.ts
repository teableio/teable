import { Injectable, Logger } from '@nestjs/common';
import { FieldType } from '@teable/core';
import { v2DataDbTokens } from '@teable/v2-adapter-db-postgres-pg';
import {
  FieldClipboardValueVisitor,
  ok,
  ListTableRecordsQuery,
  ProjectionHandler,
  RecordCreated,
  RecordsBatchCreated,
  RecordsBatchUpdated,
  RecordUpdated,
  scheduleExecutionContextBackgroundTask,
  TableByIdSpec,
  TableId,
  v2CoreTokens,
  type DomainError,
  type IEventHandler,
  type IExecutionContext,
  type RecordCreateSource,
  type RecordFieldChangeDTO,
  type RecordFieldValueDTO,
  type RecordValuesDTO,
  type Result,
  type ListTableRecordsResult,
  type IQueryBus,
  type ITableRepository,
} from '@teable/v2-core';
import type { DependencyContainer } from '@teable/v2-di';
import type { V1TeableDatabase } from '@teable/v2-postgres-schema';
import type { Kysely } from 'kysely';
import { keyBy } from 'lodash';
import {
  maxCollaboratorNotifyRecordTitles,
  NotificationService,
} from '../notification/notification.service';
import { V2ContainerService } from './v2-container.service';
import { V2ExecutionContextFactory } from './v2-execution-context.factory';
import { V2ProjectionRegistrar, type IV2ProjectionRegistrar } from './v2-projection-registrar';

type IUserField = {
  baseId: string;
  tableName: string;
  fieldId: string;
  fieldName: string;
  fieldOptions: unknown;
};

type IV2ChangedRecord = {
  id: string;
  fields: Record<string, unknown>;
};

type IUserFieldOptions = {
  shouldNotify?: boolean;
};

const collaboratorNotificationLogger = new Logger('V2CollaboratorNotificationProjection');

const scheduleCollaboratorNotificationRun = (
  context: IExecutionContext,
  task: () => Promise<void>,
  eventType: string
): void => {
  scheduleExecutionContextBackgroundTask(context, async () => {
    try {
      await task();
    } catch (error) {
      collaboratorNotificationLogger.error(
        `Error handling ${eventType} collaborator notification projection: ${
          error instanceof Error ? error.message : String(error)
        }`,
        error instanceof Error ? error.stack : undefined
      );
    }
  });
};

const getNotificationDb = async (
  v2ContainerService: V2ContainerService
): Promise<Kysely<V1TeableDatabase>> => {
  const container = await v2ContainerService.getContainer();
  return container.resolve<Kysely<V1TeableDatabase>>(v2DataDbTokens.db);
};

const fieldValuesToObject = (
  fieldValues: ReadonlyArray<RecordFieldValueDTO>
): Record<string, unknown> => {
  const result: Record<string, unknown> = {};
  for (const fieldValue of fieldValues) {
    result[fieldValue.fieldId] = fieldValue.value;
  }
  return result;
};

const changesToNewValues = (
  changes: ReadonlyArray<RecordFieldChangeDTO>
): Record<string, unknown> => {
  const result: Record<string, unknown> = {};
  for (const change of changes) {
    result[change.fieldId] = change.newValue;
  }
  return result;
};

// Only "someone actively assigns you right now" notifies: user actions and form
// submissions. Paths that move existing assignments around (import, table/record
// duplicate, trash restore, undo/redo replay) stay silent (T6662, T6905).
// Whitelist so future source variants default to silent.
const shouldNotifyOnRecordCreate = (source: RecordCreateSource): boolean =>
  source.type === 'user' || source.type === 'form';

// Undo/redo replays re-apply existing assignments through the regular update
// handlers (source stays 'user'), so replay-ness is read off the execution
// context instead of the event.
const isUndoRedoReplay = (context: IExecutionContext): boolean =>
  context.undoRedo?.mode === 'undo' || context.undoRedo?.mode === 'redo';

const parseUserFieldOptions = (rawOptions: unknown): IUserFieldOptions | null => {
  if (!rawOptions) {
    return null;
  }

  if (typeof rawOptions === 'string') {
    try {
      return JSON.parse(rawOptions) as IUserFieldOptions;
    } catch {
      return null;
    }
  }

  if (typeof rawOptions === 'object') {
    return rawOptions as IUserFieldOptions;
  }

  return null;
};

const getUserId = (value: unknown): string | null => {
  if (!value || typeof value !== 'object' || !('id' in value)) {
    return null;
  }

  const userId = (value as { id?: unknown }).id;
  return typeof userId === 'string' && userId ? userId : null;
};

const hasUserCandidate = (value: unknown): boolean => {
  const candidates = Array.isArray(value) ? value : [value];
  return candidates.some((candidate) => getUserId(candidate) !== null);
};

@Injectable()
export class V2CollaboratorNotificationDispatcher {
  private readonly logger = new Logger(V2CollaboratorNotificationDispatcher.name);
  constructor(
    private readonly v2ContainerService: V2ContainerService,
    private readonly notificationService: NotificationService,
    private readonly v2ContextFactory: V2ExecutionContextFactory
  ) {}

  async notifyUserFields(params: {
    actorId: string;
    tableId: string;
    records: ReadonlyArray<IV2ChangedRecord>;
  }): Promise<void> {
    const { actorId, tableId, records } = params;
    if (!actorId || records.length === 0) {
      return;
    }

    const db = await getNotificationDb(this.v2ContainerService);
    const userFields = keyBy(await this.fetchUserFields(db, tableId), 'fieldId');
    const userFieldIds = Object.keys(userFields);
    if (userFieldIds.length === 0 || !this.hasRelevantFields(records, userFieldIds)) {
      return;
    }

    const notificationData = this.extractNotificationData(records, userFieldIds);
    const recordIdsNeedingTitles = [
      ...new Set(
        Object.values(notificationData).flatMap((data) =>
          data.recordIds.slice(0, maxCollaboratorNotifyRecordTitles)
        )
      ),
    ];
    const recordTitles =
      recordIdsNeedingTitles.length > 0
        ? await this.loadRecordTitles(tableId, recordIdsNeedingTitles)
        : [];
    const recordTitlesMap = keyBy(recordTitles, 'id');
    for (const userId of Object.keys(notificationData)) {
      const { fieldId, recordIds } = notificationData[userId]!;
      const field = userFields[fieldId];
      if (!field) {
        continue;
      }

      const recordIdsForTitles = recordIds.slice(0, maxCollaboratorNotifyRecordTitles);
      await this.notificationService.sendCollaboratorNotify({
        fromUserId: actorId,
        toUserId: userId,
        refRecord: {
          baseId: field.baseId,
          tableId,
          tableName: field.tableName,
          fieldName: field.fieldName,
          recordIds,
          recordTitles: recordIdsForTitles.map((id) => recordTitlesMap[id]).filter(Boolean),
        },
      });
    }
  }

  private async loadRecordTitles(
    tableId: string,
    recordIds: ReadonlyArray<string>
  ): Promise<Array<{ id: string; title: string }>> {
    const container = await this.v2ContainerService.getContainerForTable(tableId);
    const context = await this.v2ContextFactory.createContext(container);
    const tableIdResult = TableId.create(tableId);
    if (tableIdResult.isErr()) {
      return [];
    }
    const tableRepository = container.resolve<ITableRepository>(v2CoreTokens.tableRepository);
    const tableResult = await tableRepository.findOne(
      context,
      TableByIdSpec.create(tableIdResult.value)
    );
    if (tableResult.isErr()) {
      return [];
    }
    const primaryFieldId = tableResult.value.primaryFieldId().toString();
    const primaryFieldResult = tableResult.value.getField(
      (field) => field.id().toString() === primaryFieldId
    );
    if (primaryFieldResult.isErr()) {
      return [];
    }
    const queryResult = ListTableRecordsQuery.create({
      tableId,
      selectedRecordIds: [...recordIds],
      projection: [primaryFieldId],
      fieldKeyType: 'id',
      ignoreViewQuery: true,
    });
    if (queryResult.isErr()) {
      return [];
    }
    const queryBus = container.resolve<IQueryBus>(v2CoreTokens.queryBus);
    const recordsResult = await queryBus.execute<ListTableRecordsQuery, ListTableRecordsResult>(
      context,
      queryResult.value
    );
    if (recordsResult.isErr()) {
      return [];
    }
    return recordsResult.value.records.map((record) => {
      const rawValue = record.fields[primaryFieldId];
      const titleResult = primaryFieldResult.value.accept(new FieldClipboardValueVisitor(rawValue));
      return {
        id: record.id,
        title: titleResult.isOk() ? titleResult.value : String(rawValue ?? ''),
      };
    });
  }

  private hasRelevantFields(records: ReadonlyArray<IV2ChangedRecord>, userFieldIds: string[]) {
    return records.some((record) =>
      Object.keys(record.fields).some((fieldId) => userFieldIds.includes(fieldId))
    );
  }

  private extractNotificationData(
    records: ReadonlyArray<IV2ChangedRecord>,
    userFieldIds: string[]
  ): Record<string, { fieldId: string; recordIds: string[] }> {
    return records.reduce<Record<string, { fieldId: string; recordIds: string[] }>>(
      (acc, record) => {
        for (const [fieldId, value] of Object.entries(record.fields)) {
          if (!userFieldIds.includes(fieldId) || !value) {
            continue;
          }

          const collaborators = Array.isArray(value) ? value : [value];
          for (const collaborator of collaborators) {
            const userId = getUserId(collaborator);
            if (!userId) {
              continue;
            }

            // Dedupe per user: the same record must count once even when the
            // user appears in several notifying fields of it (e.g. coalesced
            // edits); attribution keeps the first notifying field.
            const entry = (acc[userId] ??= { fieldId, recordIds: [] });
            if (!entry.recordIds.includes(record.id)) {
              entry.recordIds.push(record.id);
            }
          }
        }

        return acc;
      },
      {}
    );
  }

  private async fetchUserFields(
    db: Kysely<V1TeableDatabase>,
    tableId: string
  ): Promise<IUserField[]> {
    const userFieldRaws = await db
      .selectFrom('field as f')
      .innerJoin('table_meta as tm', 'tm.id', 'f.table_id')
      .select([
        'tm.base_id as baseId',
        'tm.name as tableName',
        'f.id as fieldId',
        'f.name as fieldName',
        'f.options as fieldOptions',
      ])
      .where('f.table_id', '=', tableId)
      .where('f.type', '=', FieldType.User)
      .where('f.deleted_time', 'is', null)
      .where('tm.deleted_time', 'is', null)
      .execute();

    return userFieldRaws.filter(({ fieldOptions }) => {
      const options = parseUserFieldOptions(fieldOptions);
      if (!options) {
        this.logger.warn(`Invalid user field options while notifying collaborators: ${tableId}`);
      }
      return options?.shouldNotify === true;
    });
  }
}

@ProjectionHandler(RecordCreated)
export class V2RecordCreatedCollaboratorNotificationProjection
  implements IEventHandler<RecordCreated>
{
  constructor(private readonly dispatcher: V2CollaboratorNotificationDispatcher) {}

  async handle(
    context: IExecutionContext,
    event: RecordCreated
  ): Promise<Result<void, DomainError>> {
    if (!shouldNotifyOnRecordCreate(event.source)) {
      return ok(undefined);
    }

    scheduleCollaboratorNotificationRun(
      context,
      () =>
        this.dispatcher.notifyUserFields({
          actorId: context.actorId.toString(),
          tableId: event.tableId.toString(),
          records: [
            {
              id: event.recordId.toString(),
              fields: fieldValuesToObject(event.fieldValues),
            },
          ],
        }),
      'record create'
    );
    return ok(undefined);
  }
}

@ProjectionHandler(RecordsBatchCreated)
export class V2RecordsBatchCreatedCollaboratorNotificationProjection
  implements IEventHandler<RecordsBatchCreated>
{
  constructor(private readonly dispatcher: V2CollaboratorNotificationDispatcher) {}

  async handle(
    context: IExecutionContext,
    event: RecordsBatchCreated
  ): Promise<Result<void, DomainError>> {
    if (!shouldNotifyOnRecordCreate(event.source)) {
      return ok(undefined);
    }

    scheduleCollaboratorNotificationRun(
      context,
      () =>
        this.dispatcher.notifyUserFields({
          actorId: context.actorId.toString(),
          tableId: event.tableId.toString(),
          records: event.records.map((record: RecordValuesDTO) => ({
            id: record.recordId,
            fields: fieldValuesToObject(record.fields),
          })),
        }),
      'batch record create'
    );
    return ok(undefined);
  }
}

@ProjectionHandler(RecordUpdated)
export class V2RecordUpdatedCollaboratorNotificationProjection
  implements IEventHandler<RecordUpdated>
{
  constructor(private readonly dispatcher: V2CollaboratorNotificationDispatcher) {}

  async handle(
    context: IExecutionContext,
    event: RecordUpdated
  ): Promise<Result<void, DomainError>> {
    if (event.source !== 'user' || isUndoRedoReplay(context)) {
      return ok(undefined);
    }

    scheduleCollaboratorNotificationRun(
      context,
      () =>
        this.dispatcher.notifyUserFields({
          actorId: context.actorId.toString(),
          tableId: event.tableId.toString(),
          records: [
            {
              id: event.recordId.toString(),
              fields: changesToNewValues(event.changes),
            },
          ],
        }),
      'record update'
    );
    return ok(undefined);
  }
}

@ProjectionHandler(RecordsBatchUpdated)
export class V2RecordsBatchUpdatedCollaboratorNotificationProjection
  implements IEventHandler<RecordsBatchUpdated>
{
  constructor(private readonly dispatcher: V2CollaboratorNotificationDispatcher) {}

  async handle(
    context: IExecutionContext,
    event: RecordsBatchUpdated
  ): Promise<Result<void, DomainError>> {
    if (event.source !== 'user' || isUndoRedoReplay(context)) {
      return ok(undefined);
    }

    const hasCandidate = event.updates.some((update) =>
      update.changes.some((change) => hasUserCandidate(change.newValue))
    );
    if (!hasCandidate) {
      return ok(undefined);
    }

    scheduleCollaboratorNotificationRun(
      context,
      () =>
        this.dispatcher.notifyUserFields({
          actorId: context.actorId.toString(),
          tableId: event.tableId.toString(),
          records: event.updates.map((update) => ({
            id: update.recordId,
            fields: changesToNewValues(update.changes),
          })),
        }),
      'batch record update'
    );
    return ok(undefined);
  }
}

@V2ProjectionRegistrar()
export class V2CollaboratorNotificationService implements IV2ProjectionRegistrar {
  constructor(private readonly dispatcher: V2CollaboratorNotificationDispatcher) {}

  registerProjections(container: DependencyContainer): void {
    container
      .registerInstance(
        V2RecordCreatedCollaboratorNotificationProjection,
        new V2RecordCreatedCollaboratorNotificationProjection(this.dispatcher)
      )
      .registerInstance(
        V2RecordsBatchCreatedCollaboratorNotificationProjection,
        new V2RecordsBatchCreatedCollaboratorNotificationProjection(this.dispatcher)
      )
      .registerInstance(
        V2RecordUpdatedCollaboratorNotificationProjection,
        new V2RecordUpdatedCollaboratorNotificationProjection(this.dispatcher)
      )
      .registerInstance(
        V2RecordsBatchUpdatedCollaboratorNotificationProjection,
        new V2RecordsBatchUpdatedCollaboratorNotificationProjection(this.dispatcher)
      );
  }
}
