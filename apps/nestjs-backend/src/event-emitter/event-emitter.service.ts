import { Injectable, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import type {
  ICreateOpBuilder,
  IOpBuilder,
  IOpContextBase,
  IOtOperation,
} from '@teable-group/core';
import {
  FieldOpBuilder,
  IdPrefix,
  RecordOpBuilder,
  TableOpBuilder,
  ViewOpBuilder,
} from '@teable-group/core';
import { plainToInstance } from 'class-transformer';
import { get, isEmpty, merge, omit, set } from 'lodash';
import { ClsService } from 'nestjs-cls';
import type { GroupedObservable, Observable } from 'rxjs';
import { catchError, EMPTY, from, groupBy, map, mergeMap, toArray } from 'rxjs';
import type { CreateOp, DeleteOp, EditOp } from 'sharedb';
import type { IRawOpMap } from '../share-db/interface';
import { RawOpType } from '../share-db/interface';
import type { IClsStore } from '../types/cls';
import type { Events } from './model';
import {
  FieldCreateEvent,
  FieldDeleteEvent,
  FieldUpdateEvent,
  RecordCreateEvent,
  RecordDeleteEvent,
  RecordUpdateEvent,
  TableCreateEvent,
  TableDeleteEvent,
  TableUpdateEvent,
  ViewCreateEvent,
  ViewDeleteEvent,
  ViewUpdateEvent,
} from './model';
import type { BaseOpEvent } from './model/table/base-op-event';

@Injectable()
export class EventEmitterService {
  private readonly logger = new Logger(EventEmitterService.name);

  private eventClassMap = {
    [RawOpType.Create]: {
      [IdPrefix.Table]: TableCreateEvent,
      [IdPrefix.View]: ViewCreateEvent,
      [IdPrefix.Field]: FieldCreateEvent,
      [IdPrefix.Record]: RecordCreateEvent,
    },
    [RawOpType.Del]: {
      [IdPrefix.Table]: TableDeleteEvent,
      [IdPrefix.View]: ViewDeleteEvent,
      [IdPrefix.Field]: FieldDeleteEvent,
      [IdPrefix.Record]: RecordDeleteEvent,
    },
    [RawOpType.Edit]: {
      [IdPrefix.Table]: TableUpdateEvent,
      [IdPrefix.View]: ViewUpdateEvent,
      [IdPrefix.Field]: FieldUpdateEvent,
      [IdPrefix.Record]: RecordUpdateEvent,
    },
  };

  private getPropertyCategoryForType = {
    [IdPrefix.Table]: 'table',
    [IdPrefix.View]: 'view',
    [IdPrefix.Field]: 'field',
    [IdPrefix.Record]: 'record',
  };

  constructor(
    private readonly eventEmitter: EventEmitter2,
    private readonly cls: ClsService<IClsStore>
  ) {}

  emit(event: string, data: unknown | unknown[]): boolean {
    return this.eventEmitter.emit(event, data);
  }

  emitAsync(event: string, data: unknown | unknown[]): Promise<boolean[]> {
    return this.eventEmitter.emitAsync(event, data);
  }

  async ops2Event(stashOpMap?: IRawOpMap, publishOpMap?: IRawOpMap): Promise<void> {
    const generatedEvents = this.collectEventsFromRawOpMap(stashOpMap, publishOpMap);
    if (!generatedEvents) {
      return;
    }

    const observable = from(Array.from(generatedEvents.values()));

    observable
      .pipe(
        groupBy((event) => event.name),
        mergeMap((project) => this.aggregateEventsByGroup(project))
      )
      .subscribe((next) => this.handleEventResult(next));
  }

  private aggregateEventsByGroup(
    project: GroupedObservable<Events, BaseOpEvent>
  ): Observable<BaseOpEvent> {
    return project.pipe(
      toArray(),
      map((groupedEvents) => this.combineEvents(groupedEvents)),
      catchError((error) => {
        this.logger.error(`1push event stream error: ${error.message}`, error?.stack);
        return EMPTY;
      })
    );
  }

  private combineEvents(groupedEvents: BaseOpEvent[]): BaseOpEvent {
    if (groupedEvents.length <= 1) return groupedEvents[0];

    return groupedEvents.reduce((combinedEvent, event, index) => {
      const mergePropertyName = this.getMergePropertyName(event);

      if (index === 0) {
        combinedEvent = this.initAcc(event, mergePropertyName);
      }

      const changes = this.aggregateEventChanges(combinedEvent, mergePropertyName, event);
      set(combinedEvent, [mergePropertyName], changes);
      return combinedEvent;
    }, {} as BaseOpEvent);
  }

  private getMergePropertyName(event: BaseOpEvent): string {
    if (event instanceof ViewCreateEvent) return 'view';
    if (event instanceof FieldCreateEvent) return 'field';
    if (event instanceof FieldDeleteEvent) return 'fieldId';
    if (event instanceof FieldUpdateEvent) return 'field';
    if (event instanceof RecordCreateEvent) return 'record';
    if (event instanceof RecordDeleteEvent) return 'recordId';
    if (event instanceof RecordUpdateEvent) return 'record';
    return '';
  }

  private initAcc(event: BaseOpEvent, mergePropertyName: string): BaseOpEvent {
    return {
      ...(omit(event, mergePropertyName) as BaseOpEvent),
      isBatch: true,
    };
  }

  private aggregateEventChanges(
    combinedEvent: BaseOpEvent,
    mergePropertyName: string,
    event: BaseOpEvent
  ) {
    const changes = get(combinedEvent, [mergePropertyName]) || [];
    changes.push(get(event, [mergePropertyName]));
    return changes;
  }

  private handleEventResult(result: BaseOpEvent): void {
    this.logger.log({ eventName: result.name, eventList: result });
    this.emitAsync(result.name, result);
  }

  private collectEventsFromRawOpMap(stashOpMap?: IRawOpMap, publishOpMap?: IRawOpMap) {
    if (!stashOpMap && !publishOpMap) {
      return;
    }

    const eventManager: Map<string, BaseOpEvent> = new Map();

    if (stashOpMap) {
      this.generateEventsFromRawOps(false, stashOpMap, eventManager);
    }

    if (publishOpMap) {
      this.generateEventsFromRawOps(!isEmpty(stashOpMap), publishOpMap, eventManager);
    }
    return eventManager;
  }

  private generateEventsFromRawOps(
    isStash: boolean,
    rawOpMap: IRawOpMap,
    eventManager: Map<string, BaseOpEvent>
  ) {
    for (const collection in rawOpMap) {
      const [docType, docId] = collection.split('_') as [IdPrefix, string];
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
        }) as BaseOpEvent;

        const eventInstance = this.plainToEventInstance(docType, opType, {
          ...extendPlainContext,
          ...plainContext,
          context: {
            ...extendPlainContext.context,
            ...plainContext?.context,
          },
        });

        eventInstance && this.updateEventManager(eventManager, id, eventInstance, isStash);
      }
    }
  }

  private createExtendPlainContext(docId: string, id: string) {
    const user = this.cls.get('user');
    return {
      baseId: docId,
      tableId: docId,
      viewId: id,
      fieldId: id,
      recordId: id,
      context: {
        user: user,
      },
    };
  }

  private getOpType(rawOp: CreateOp | DeleteOp | EditOp): RawOpType | null {
    if ('create' in rawOp) return RawOpType.Create;
    if ('op' in rawOp) return RawOpType.Edit;
    if ('del' in rawOp) return RawOpType.Del;
    return null;
  }

  private updateEventManager(
    eventManager: Map<string, BaseOpEvent>,
    id: string,
    eventInstance: BaseOpEvent,
    isStash: boolean
  ): void {
    if (isStash) {
      const stashEvent = eventManager.get(id);
      stashEvent && eventManager.set(id, merge({}, stashEvent, eventInstance));
    } else {
      eventManager.set(id, eventInstance);
    }
  }

  private plainToEventInstance(docType: IdPrefix, action: RawOpType, plain: unknown) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const eventClass: any =
      this.eventClassMap[action]?.[
        docType as IdPrefix.Table | IdPrefix.View | IdPrefix.Field | IdPrefix.Record
      ];
    return (
      eventClass &&
      plainToInstance(eventClass, plain, {
        exposeDefaultValues: true,
        excludeExtraneousValues: true,
      })
    );
  }

  private getOpBuilder(docType: IdPrefix) {
    switch (docType) {
      case IdPrefix.Table:
        return TableOpBuilder;
      case IdPrefix.View:
        return ViewOpBuilder;
      case IdPrefix.Field:
        return FieldOpBuilder;
      case IdPrefix.Record:
        return RecordOpBuilder;
    }
  }

  private convertOpsToClassPlain(
    docType: IdPrefix,
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
      return acc;
    }, {});

    return isEmpty(correctedData) ? initData : correctedData;
  }

  private initData(
    docType: IdPrefix,
    nodeId: string,
    createBuilder?: ICreateOpBuilder,
    opCreateData?: unknown
  ) {
    if (createBuilder?.name === 'addRecord' && !opCreateData) {
      opCreateData = { id: nodeId };
    }

    if (opCreateData && createBuilder) {
      const buildData = createBuilder.build(opCreateData);
      const propertyCategory = this.getPropertyCategoryForType[docType as never];

      const pre = { [propertyCategory]: buildData };
      set(pre, ['context', 'opMeta', 'name'], createBuilder.name);
      return pre;
    }
  }

  private applyOperation(
    docType: IdPrefix,
    rawOpType: RawOpType,
    acc: object,
    cur: IOpContextBase,
    nodeId: string,
    editorBuilders?: { [key: string]: IOpBuilder }
  ) {
    if (!editorBuilders) return;

    const opBuilder = editorBuilders[cur.name as keyof typeof editorBuilders];
    if (!opBuilder) return;

    const propertyCategory = this.getPropertyCategoryForType[docType as never];
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
