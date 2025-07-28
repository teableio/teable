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

// eslint-disable-next-line @typescript-eslint/naming-convention
type DocType = IdPrefix.Table | IdPrefix.Field | IdPrefix.View | IdPrefix.Record;

@Injectable()
export class EventEmitterService {
  private readonly logger = new Logger(EventEmitterService.name);

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

  private getPropertyCategoryForType = {
    [IdPrefix.Table]: 'table',
    [IdPrefix.View]: 'view',
    [IdPrefix.Field]: 'field',
    [IdPrefix.Record]: 'record',
  };

  constructor(
    public readonly eventEmitter: EventEmitter2,
    private readonly cls: ClsService<IClsStore>
  ) {}

  emit(event: string, data: unknown | unknown[]): boolean {
    return this.eventEmitter.emit(event, data);
  }

  emitAsync(event: string, data: unknown | unknown[]): Promise<boolean[]> {
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
          return tableId ? `${tableId}_${event.name}` : event.name;
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
    return {
      ...(omit(event, `payload.${mergePropertyName}`) as OpEvent),
      isBulk: true,
    };
  }

  private aggregateEventChanges(combinedEvent: OpEvent, mergePropertyName: string, event: OpEvent) {
    const changes = get(combinedEvent, ['payload', mergePropertyName]) || [];
    changes.push(get(event, ['payload', mergePropertyName]));
    return changes;
  }

  private handleEventResult(result: OpEvent): void {
    this.logger.debug({ eventName: result.name, eventList: result });
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
        const extendPlainContext = this.createExtendPlainContext(docId, id);

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

        event && this.mergeEventsForUpdate(eventManager, id, event);
      }
    }
  }

  private createExtendPlainContext(docId: string, id: string) {
    const user = this.cls.get('user');
    const entry = this.cls.get('entry');
    return {
      baseId: docId,
      tableId: id.startsWith(IdPrefix.Table) ? id : docId,
      viewId: id,
      fieldId: id,
      recordId: id,
      context: {
        user,
        entry,
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

    const oldField = this.cls.get('oldField');

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
