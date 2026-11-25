import { randomUUID } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import type {
  ICreateOpBuilder,
  IOpBuilder,
  IOpContextBase,
  IOtOperation,
  IRecord,
} from '@teable/core';
import {
  FieldOpBuilder,
  IdPrefix,
  RecordOpBuilder,
  TableOpBuilder,
  ViewOpBuilder,
} from '@teable/core';
import type { RecordInitiator } from '@teable/v2-core';
import { get, isEmpty, omit, set } from 'lodash';
import { ClsService } from 'nestjs-cls';
import type { GroupedObservable, Observable } from 'rxjs';
import { catchError, EMPTY, from, groupBy, map, mergeMap, toArray } from 'rxjs';
import type { CreateOp, DeleteOp, EditOp } from 'sharedb';
import { match, P } from 'ts-pattern';
import type { IRawOpMap } from '../share-db/interface';
import { RawOpType } from '../share-db/interface';
import type { IClsStore } from '../types/cls';
import { Timing } from '../utils/timing';
import type { IChangeRecord, OpEvent, RecordCreateEvent, RecordUpdateEvent } from './events';
import {
  Events,
  FieldEventFactory,
  RecordEventFactory,
  TableEventFactory,
  ViewEventFactory,
} from './events';
import type { IEventContext } from './events/core-event';

export const RECORD_HISTORY_PERSIST = 'record-history.persist-in-transaction';

export interface IRecordHistoryPersistRequest {
  event: RecordUpdateEvent;
  execute: (sql: string) => Promise<unknown>;
}

export const RECORD_OPERATION_AUDIT_PERSIST = 'record-operation-audit.persist-in-transaction';

export interface IRecordOperationAuditDraft {
  readonly eventId: string;
  readonly tableId: string;
  readonly action: 'create' | 'delete';
  readonly executorId: string;
  readonly initiator?: RecordInitiator;
  readonly operationId: string;
  readonly occurredAt: string;
  readonly rootAction?: string;
  readonly recordCount: number;
  readonly recordIds: ReadonlyArray<string>;
}

export interface IRecordOperationAuditPersistRequest {
  draft: IRecordOperationAuditDraft;
  execute: (sql: string) => Promise<unknown>;
}

type FrozenRecordOperationContext = Pick<
  IRecordOperationAuditDraft,
  'executorId' | 'initiator' | 'operationId' | 'occurredAt' | 'rootAction'
>;

interface IRecordOperationAuditGroup {
  tableId: string;
  action: 'create' | 'delete';
  context: FrozenRecordOperationContext;
  recordCount: number;
  recordIds: string[];
  rawOps: object[];
}

// eslint-disable-next-line @typescript-eslint/naming-convention
type DocType = IdPrefix.Table | IdPrefix.Field | IdPrefix.View | IdPrefix.Record;

@Injectable()
export class EventEmitterService {
  private readonly logger = new Logger(EventEmitterService.name);
  // Server-only provenance: never read identity or completion markers from client raw-op metadata.
  private readonly recordEventContexts = new WeakMap<object, IEventContext>();
  private readonly recordEventOldFields = new WeakMap<object, IClsStore['oldField']>();
  private readonly recordOperationContexts = new WeakMap<object, FrozenRecordOperationContext>();
  private readonly recordOperationDrafts = new WeakMap<object, IRecordOperationAuditDraft>();
  private readonly outboxedRecordRawOps = new WeakSet<object>();
  private readonly outboxedRecordEvents = new WeakSet<object>();
  private recordOperationAuditRequired = false;

  freezeRecordEventContext(rawOpMaps: IRawOpMap[]): void {
    const user = this.cls.get('user');
    const initiator = this.cls.get('recordInitiator');
    const operationContext = this.snapshotRecordOperationContext(user, initiator);
    const context: IEventContext = {
      user: user ? { id: user.id, name: user.name, email: user.email } : undefined,
      recordInitiator: initiator ? { ...initiator } : undefined,
      entry: this.cls.get('entry'),
      recordRemovalReason: this.cls.get('recordRemovalReason'),
      occurredAt: operationContext.occurredAt,
    };
    for (const rawOpMap of rawOpMaps) {
      for (const [collection, docs] of Object.entries(rawOpMap)) {
        this.freezeCollectionEvents(collection, docs, context, operationContext);
      }
    }
  }

  async persistRecordHistory(
    rawOpMaps: IRawOpMap[],
    execute: (sql: string) => Promise<unknown>
  ): Promise<void> {
    this.freezeRecordEventContext(rawOpMaps);
    const events = this.collectEventsFromRawOpMap(rawOpMaps);
    const createdRecords = this.collectCreatedRecordKeys(rawOpMaps);
    for (const event of events?.values() ?? []) {
      if (!this.requiresRecordHistory(event, createdRecords)) continue;
      if (this.eventEmitter.listenerCount(RECORD_HISTORY_PERSIST) === 0) {
        throw new Error('Transactional record history listener is unavailable');
      }
      await this.eventEmitter.emitAsync(RECORD_HISTORY_PERSIST, {
        event: event as RecordUpdateEvent,
        execute,
      } satisfies IRecordHistoryPersistRequest);
    }
    this.markRecordHistoryPersisted(rawOpMaps);
  }

  /** The host enables this only when durable audit is installed; CE has no audit consumer. */
  requireRecordOperationAuditPersistence(): void {
    this.recordOperationAuditRequired = true;
  }

  isRecordOperationAuditPersisted(event: object): boolean {
    return this.outboxedRecordEvents.has(event);
  }

  private snapshotRecordOperationContext(
    user: { id: string } | undefined,
    initiator: RecordInitiator | undefined
  ): FrozenRecordOperationContext {
    const audit = this.cls.get('audit');
    return Object.freeze({
      executorId: user?.id ?? 'unknown',
      initiator: initiator ? Object.freeze({ ...initiator }) : undefined,
      operationId: audit?.operationId ?? randomUUID(),
      occurredAt: new Date().toISOString(),
      rootAction: audit?.rootAction,
    });
  }

  private hasRecordOperationAuditPersistence(): boolean {
    const listeners = this.eventEmitter.listenerCount(RECORD_OPERATION_AUDIT_PERSIST);
    if (listeners === 0 && !this.recordOperationAuditRequired) return false;
    if (listeners !== 1)
      throw new Error('Transactional record operation audit listener is unavailable or ambiguous');
    return true;
  }

  async persistRecordOperationAudit(
    rawOpMaps: IRawOpMap[],
    execute: (sql: string) => Promise<unknown>
  ): Promise<void> {
    if (!this.hasRecordOperationAuditPersistence()) return;
    this.freezeRecordEventContext(rawOpMaps);
    const drafts = new Map<string, IRecordOperationAuditDraft>();
    const groups = new Map<string, IRecordOperationAuditGroup>();
    const recordRawOps: object[] = [];
    for (const rawOpMap of rawOpMaps) {
      for (const [collection, docs] of Object.entries(rawOpMap)) {
        this.collectRecordOperationGroup(collection, docs, drafts, groups, recordRawOps);
      }
    }
    for (const group of groups.values()) {
      const draft: IRecordOperationAuditDraft = Object.freeze({
        ...group.context,
        eventId: randomUUID(),
        tableId: group.tableId,
        action: group.action,
        recordCount: group.recordCount,
        recordIds: Object.freeze(group.recordIds),
      });
      drafts.set(draft.eventId, draft);
      for (const rawOp of group.rawOps) this.recordOperationDrafts.set(rawOp, draft);
    }
    // Re-execute cached drafts too: the previous transaction may have rolled back. The
    // source journal insert is idempotent by eventId, not an in-memory success flag.
    for (const draft of drafts.values()) {
      await this.eventEmitter.emitAsync(RECORD_OPERATION_AUDIT_PERSIST, {
        draft,
        execute,
      } satisfies IRecordOperationAuditPersistRequest);
    }
    for (const rawOp of recordRawOps) this.outboxedRecordRawOps.add(rawOp);
  }

  private freezeCollectionEvents(
    collection: string,
    docs: IRawOpMap[string],
    context: IEventContext,
    operationContext: FrozenRecordOperationContext
  ): void {
    for (const rawOp of Object.values(docs)) {
      if (this.recordEventContexts.has(rawOp)) continue;
      this.recordEventContexts.set(
        rawOp,
        collection.startsWith(`${IdPrefix.Record}_`) && 'create' in rawOp
          ? { ...context, recordHistoryPersisted: true }
          : context
      );
      this.recordEventOldFields.set(rawOp, this.cls.get('oldField'));
      this.recordOperationContexts.set(rawOp, operationContext);
    }
  }

  private collectCreatedRecordKeys(rawOpMaps: IRawOpMap[]): Set<string> {
    const createdRecords = new Set<string>();
    for (const rawOpMap of [...(this.cls.get('tx.rawOpMaps') ?? []), ...rawOpMaps]) {
      for (const [collection, docs] of Object.entries(rawOpMap)) {
        for (const [id, rawOp] of Object.entries(docs)) {
          if ('create' in rawOp) createdRecords.add(`${collection}:${id}`);
        }
      }
    }
    return createdRecords;
  }

  private requiresRecordHistory(event: OpEvent, createdRecords: Set<string>): boolean {
    if (event.name !== Events.TABLE_RECORD_UPDATE || event.context.recordHistoryPersisted)
      return false;
    const update = event as RecordUpdateEvent;
    const records = Array.isArray(update.payload.record)
      ? update.payload.record
      : [update.payload.record];
    return !records.every((record) =>
      createdRecords.has(`${IdPrefix.Record}_${update.payload.tableId}:${record.id}`)
    );
  }

  private markRecordHistoryPersisted(rawOpMaps: IRawOpMap[]): void {
    for (const rawOpMap of rawOpMaps) {
      for (const docs of Object.values(rawOpMap)) {
        for (const rawOp of Object.values(docs)) {
          const context = this.recordEventContexts.get(rawOp);
          if (context)
            this.recordEventContexts.set(rawOp, { ...context, recordHistoryPersisted: true });
        }
      }
    }
  }

  private collectRecordOperationGroup(
    collection: string,
    docs: IRawOpMap[string],
    drafts: Map<string, IRecordOperationAuditDraft>,
    groups: Map<string, IRecordOperationAuditGroup>,
    recordRawOps: object[]
  ): void {
    const [prefix, tableId] = collection.split('_');
    if (prefix !== IdPrefix.Record || !tableId) return;
    for (const [recordId, rawOp] of Object.entries(docs)) {
      this.collectRecordOperationGroupEntry(tableId, recordId, rawOp, drafts, groups, recordRawOps);
    }
  }

  private collectRecordOperationGroupEntry(
    tableId: string,
    recordId: string,
    rawOp: IRawOpMap[string][string],
    drafts: Map<string, IRecordOperationAuditDraft>,
    groups: Map<string, IRecordOperationAuditGroup>,
    recordRawOps: object[]
  ): void {
    const action = 'create' in rawOp ? 'create' : 'del' in rawOp ? 'delete' : undefined;
    if (!action) return;
    recordRawOps.push(rawOp);
    const existing = this.recordOperationDrafts.get(rawOp);
    if (existing) {
      drafts.set(existing.eventId, existing);
      return;
    }
    const context = this.recordOperationContexts.get(rawOp);
    if (!context) throw new Error('Trusted record operation context is unavailable');
    const key = JSON.stringify([tableId, action, context]);
    let group = groups.get(key);
    if (!group) {
      group = { tableId, action, context, recordCount: 0, recordIds: [], rawOps: [] };
      groups.set(key, group);
    }
    group.recordCount += 1;
    if (group.recordIds.length < 200) group.recordIds.push(recordId);
    group.rawOps.push(rawOp);
  }

  /** Raw INSERT SELECT / archive imports have counts but need not hydrate every row ID. */
  async persistRecordCreateOperationAudit(
    tableId: string,
    recordCount: number,
    recordIds: ReadonlyArray<string>,
    execute: (sql: string) => Promise<unknown>
  ): Promise<void> {
    if (!Number.isSafeInteger(recordCount) || recordCount < 0)
      throw new Error('Invalid inserted record count');
    if (recordCount === 0 || !this.hasRecordOperationAuditPersistence()) return;
    const context = this.snapshotRecordOperationContext(
      this.cls.get('user'),
      this.cls.get('recordInitiator')
    );
    const draft: IRecordOperationAuditDraft = Object.freeze({
      ...context,
      eventId: randomUUID(),
      tableId,
      action: 'create',
      recordCount,
      recordIds: Object.freeze(recordIds.slice(0, 200)),
    });
    await this.eventEmitter.emitAsync(RECORD_OPERATION_AUDIT_PERSIST, {
      draft,
      execute,
    } satisfies IRecordOperationAuditPersistRequest);
  }

  private readonly eventNameMapping = {
    [RawOpType.Create]: {
      [IdPrefix.Table]: Events.TABLE_CREATE,
      [IdPrefix.Field]: Events.TABLE_FIELD_CREATE,
      [IdPrefix.View]: Events.TABLE_VIEW_CREATE,
      [IdPrefix.Record]: Events.TABLE_RECORD_CREATE,
    },
    [RawOpType.Del]: {
      [IdPrefix.Table]: Events.TABLE_DELETE,
      [IdPrefix.Field]: Events.TABLE_FIELD_DELETE,
      [IdPrefix.View]: Events.TABLE_VIEW_DELETE,
      [IdPrefix.Record]: Events.TABLE_RECORD_DELETE,
    },
    [RawOpType.Edit]: {
      [IdPrefix.Table]: Events.TABLE_UPDATE,
      [IdPrefix.Field]: Events.TABLE_FIELD_UPDATE,
      [IdPrefix.View]: Events.TABLE_VIEW_UPDATE,
      [IdPrefix.Record]: Events.TABLE_RECORD_UPDATE,
    },
  };

  private readonly getPropertyCategoryForType = {
    [IdPrefix.Table]: 'table',
    [IdPrefix.View]: 'view',
    [IdPrefix.Field]: 'field',
    [IdPrefix.Record]: 'record',
  };

  constructor(
    public readonly eventEmitter: EventEmitter2,
    private readonly cls: ClsService<IClsStore>
  ) {}

  emit<T>(event: string, data: T): boolean {
    return this.eventEmitter.emit(event, data);
  }

  emitAsync<T>(event: string, data: T): Promise<boolean[]> {
    return this.eventEmitter.emitAsync(event, data);
  }

  @Timing()
  async ops2Event(rawOpMaps?: IRawOpMap[]): Promise<void> {
    const generatedEvents = this.collectEventsFromRawOpMap(rawOpMaps);
    if (!generatedEvents) {
      return;
    }
    const observable = from(Array.from(generatedEvents.values()));

    observable
      .pipe(
        groupBy((event) => {
          const tableId = get(event, 'payload.tableId');
          return JSON.stringify([
            tableId,
            event.name,
            event.context.user?.id,
            event.context.recordInitiator?.type,
            event.context.recordInitiator?.id,
            event.context.recordHistoryPersisted ?? false,
            this.outboxedRecordEvents.has(event),
          ]);
        }),
        mergeMap((project) => this.aggregateEventsByGroup(project))
      )
      .subscribe((next) => this.handleEventResult(next));
  }

  private aggregateEventsByGroup(project: GroupedObservable<string, OpEvent>): Observable<OpEvent> {
    return project.pipe(
      toArray(),
      map((groupedEvents) => this.combineEvents(groupedEvents)),
      catchError((error) => {
        this.logger.error(`push event stream error: ${error.message}`, error?.stack);
        return EMPTY;
      })
    );
  }

  private combineEvents(groupedEvents: OpEvent[]): OpEvent {
    if (groupedEvents.length <= 1) return groupedEvents[0];
    return groupedEvents.reduce((combinedEvent, event, index) => {
      const mergePropertyName = this.getMergePropertyName(event);

      if (index === 0) {
        combinedEvent = this.initAcc(event, mergePropertyName);
      }

      const changes = this.aggregateEventChanges(combinedEvent, mergePropertyName, event);
      set(combinedEvent, `payload.${mergePropertyName}`, changes);
      return combinedEvent;
    }, {} as OpEvent);
  }

  private getMergePropertyName(event: OpEvent): string {
    return match(event)
      .with(
        P.union({ name: Events.TABLE_VIEW_CREATE }, { name: Events.TABLE_VIEW_UPDATE }),
        () => 'view'
      )
      .with({ name: Events.TABLE_VIEW_DELETE }, () => 'viewId')
      .with(
        P.union({ name: Events.TABLE_FIELD_CREATE }, { name: Events.TABLE_FIELD_UPDATE }),
        () => 'field'
      )
      .with({ name: Events.TABLE_FIELD_DELETE }, () => 'fieldId')
      .with(
        P.union({ name: Events.TABLE_RECORD_CREATE }, { name: Events.TABLE_RECORD_UPDATE }),
        () => 'record'
      )
      .with({ name: Events.TABLE_RECORD_DELETE }, () => 'recordId')
      .otherwise(() => '');
  }

  private initAcc(event: OpEvent, mergePropertyName: string): OpEvent {
    const combined = { ...(omit(event, `payload.${mergePropertyName}`) as OpEvent), isBulk: true };
    if (this.outboxedRecordEvents.has(event)) this.outboxedRecordEvents.add(combined);
    return combined;
  }

  private aggregateEventChanges(combinedEvent: OpEvent, mergePropertyName: string, event: OpEvent) {
    const changes = get(combinedEvent, ['payload', mergePropertyName]) || [];
    changes.push(get(event, ['payload', mergePropertyName]));
    return changes;
  }

  private handleEventResult(result: OpEvent): void {
    // this.logger.debug({ eventName: result.name, eventList: result });
    this.emitAsync(result.name, result);
  }

  private collectEventsFromRawOpMap(rawOpMaps?: IRawOpMap[]) {
    if (!rawOpMaps?.length) {
      return;
    }

    return rawOpMaps.reduce((pre, cur) => {
      this.generateEventsFromRawOps(cur, pre);
      return pre;
    }, new Map<string, OpEvent>());
  }

  private generateEventsFromRawOps(rawOpMap: IRawOpMap, eventManager: Map<string, OpEvent>) {
    for (const collection in rawOpMap) {
      const [docType, docId] = collection.split('_') as [DocType, string];
      const data = rawOpMap[collection];

      for (const id in data) {
        const rawOp = data[id] as CreateOp | DeleteOp | EditOp;
        const extendPlainContext = this.createExtendPlainContext(docId, id, rawOp);

        const opType = this.getOpType(rawOp);
        if (opType === null) continue;

        const plainContext = this.convertOpsToClassPlain(docType, opType, {
          nodeId: id,
          opCreateData: rawOp.create?.data,
          ops: rawOp?.op,
        }) as OpEvent;
        const event = this.createEvent(docType, opType, {
          ...extendPlainContext,
          ...plainContext,
          context: {
            ...extendPlainContext.context,
            ...plainContext?.context,
          },
        });

        if (event) {
          if (this.outboxedRecordRawOps.has(rawOp)) this.outboxedRecordEvents.add(event);
          const key = JSON.stringify([
            docId,
            id,
            event.context.user?.id,
            event.context.recordInitiator?.type,
            event.context.recordInitiator?.id,
            event.context.recordHistoryPersisted ?? false,
            this.outboxedRecordEvents.has(event),
          ]);
          this.mergeEventsForUpdate(eventManager, key, event);
        }
      }
    }
  }

  private createExtendPlainContext(docId: string, id: string, rawOp: object) {
    const frozen = this.recordEventContexts.get(rawOp);
    const isRecord = id.startsWith(IdPrefix.Record);
    const user = frozen?.user ?? (isRecord ? undefined : this.cls.get('user'));
    const entry = frozen?.entry ?? (isRecord ? undefined : this.cls.get('entry'));
    const recordRemovalReason = frozen?.recordRemovalReason;
    return {
      baseId: docId,
      tableId: id.startsWith(IdPrefix.Table) ? id : docId,
      viewId: id,
      fieldId: id,
      recordId: id,
      oldField: this.recordEventOldFields.get(rawOp),
      context: {
        ...frozen,
        user,
        entry,
        recordRemovalReason,
      },
    };
  }

  private getOpType(rawOp: CreateOp | DeleteOp | EditOp): RawOpType | null {
    if ('create' in rawOp) return RawOpType.Create;
    if ('op' in rawOp) return RawOpType.Edit;
    if ('del' in rawOp) return RawOpType.Del;
    return null;
  }

  private mergeEventsForUpdate(
    eventManager: Map<string, OpEvent>,
    id: string,
    event: OpEvent
  ): void {
    const existingEvent = eventManager.get(id);

    if (!existingEvent) {
      eventManager.set(id, event);
      return;
    }

    const { rawOpType } = existingEvent;

    if (
      [RawOpType.Create, RawOpType.Edit].includes(rawOpType) &&
      event.name === Events.TABLE_RECORD_UPDATE
    ) {
      const fields = this.getUpdateFieldsFromEvent(event as RecordUpdateEvent, rawOpType);
      event = this.combineUpdateEvents(existingEvent as RecordCreateEvent, fields);
    }
    if (this.outboxedRecordEvents.has(existingEvent)) this.outboxedRecordEvents.add(event);

    eventManager.set(id, event);
  }

  private getUpdateFieldsFromEvent(
    event: RecordUpdateEvent,
    existedRawOpType: RawOpType
  ): { [key: string]: unknown } {
    const { payload } = event;
    const fields = (payload.record as IChangeRecord).fields;

    if (existedRawOpType === RawOpType.Edit) {
      return fields;
    }

    return Object.entries(fields).reduce(
      (acc, [key, value]) => {
        acc[key] = value.newValue;
        return acc;
      },
      {} as { [key: string]: unknown }
    );
  }

  private combineUpdateEvents(
    existingEvent: RecordCreateEvent,
    fields: { [key: string]: unknown }
  ): OpEvent {
    return {
      ...existingEvent,
      payload: {
        ...existingEvent.payload,
        record: {
          ...existingEvent.payload.record,
          fields: {
            ...(existingEvent.payload.record as IRecord).fields,
            ...fields,
          },
        },
      },
    };
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private createEvent(docType: DocType, action: RawOpType, plain: any) {
    const { context, ...payload } = plain;
    const eventName = this.eventNameMapping[action]?.[docType];
    if (!eventName) return undefined;

    const oldField = payload.oldField;

    if (eventName === Events.TABLE_RECORD_UPDATE) {
      payload.oldField = oldField;
    }

    return match(docType)
      .with(IdPrefix.Table, () => TableEventFactory.create(eventName, payload, context))
      .with(IdPrefix.Field, () => FieldEventFactory.create(eventName, payload, context))
      .with(IdPrefix.View, () => ViewEventFactory.create(eventName, payload, context))
      .with(IdPrefix.Record, () => RecordEventFactory.create(eventName, payload, context))
      .exhaustive();
  }

  private getOpBuilder(docType: DocType) {
    return match(docType)
      .with(IdPrefix.Table, () => TableOpBuilder)
      .with(IdPrefix.Field, () => FieldOpBuilder)
      .with(IdPrefix.View, () => ViewOpBuilder)
      .with(IdPrefix.Record, () => RecordOpBuilder)
      .exhaustive();
  }

  private convertOpsToClassPlain(
    docType: DocType,
    rawOpType: RawOpType,
    params: {
      nodeId: string;
      opCreateData?: unknown;
      ops?: IOtOperation[];
    }
  ) {
    const { nodeId, opCreateData, ops = [] } = params;
    const opBuilder = this.getOpBuilder(docType);
    const initData = this.initData(docType, nodeId, opBuilder?.creator, opCreateData);

    const ops2Contexts = opBuilder?.ops2Contexts(ops) || [];
    const correctedData = ops2Contexts.reduce((acc, cur) => {
      this.applyOperation(docType, rawOpType, acc, cur, nodeId, opBuilder?.editor);

      set(acc, ['context', 'opMeta', 'name'], cur.name);
      set(acc, ['context', 'opMeta', 'propertyKey'], get(cur, 'key'));
      return acc;
    }, {});

    return isEmpty(correctedData) ? initData : correctedData;
  }

  private initData(
    docType: DocType,
    nodeId: string,
    createBuilder?: ICreateOpBuilder,
    opCreateData?: unknown
  ) {
    if (createBuilder?.name === 'addRecord' && !opCreateData) {
      opCreateData = { id: nodeId };
    }

    if (opCreateData && createBuilder) {
      const buildData = createBuilder.build(opCreateData);
      const propertyCategory = this.getPropertyCategoryForType[docType];

      const pre = { [propertyCategory]: buildData };
      set(pre, ['context', 'opMeta', 'name'], createBuilder.name);
      return pre;
    }
  }

  private applyOperation(
    docType: DocType,
    rawOpType: RawOpType,
    acc: object,
    cur: IOpContextBase,
    nodeId: string,
    editorBuilders?: { [key: string]: IOpBuilder }
  ) {
    if (!editorBuilders) return;

    const opBuilder = editorBuilders[cur.name as keyof typeof editorBuilders];
    if (!opBuilder) return;

    const propertyCategory = this.getPropertyCategoryForType[docType];
    const otOperation = opBuilder.build(cur);
    if (!otOperation) return;

    this.buildAndApplyOp(otOperation, acc, propertyCategory, nodeId, rawOpType);
  }

  private buildAndApplyOp(
    otOperation: IOtOperation,
    acc: object,
    propertyCategory: string,
    nodeId: string,
    rawOpType: RawOpType
  ) {
    const { p, oi: newValue, od: oldValue } = otOperation;
    set(acc, [propertyCategory, 'id'], nodeId);

    const [propertyName, changeNodeId] = p;
    const updateProperty = (key: string | number | null, value: unknown) => {
      const propertyPath = [propertyCategory, propertyName, key].filter(Boolean) as (
        | string
        | number
      )[];
      set(acc, propertyPath, value);
    };

    if (p.length === 1) {
      const value = rawOpType === RawOpType.Edit ? { oldValue, newValue } : newValue;
      updateProperty(null, value);
    } else if (p.length === 2) {
      const changeProperty = get(acc, [propertyCategory, propertyName], {});
      changeProperty[changeNodeId] =
        rawOpType === RawOpType.Edit ? { oldValue, newValue } : newValue;
      updateProperty(changeNodeId, changeProperty[changeNodeId]);
    }
  }
}
