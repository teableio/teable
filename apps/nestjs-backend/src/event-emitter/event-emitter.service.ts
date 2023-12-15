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
        this.logger.error(`push event stream error: ${error.message}`, error?.stack);
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
    this.logger.log(`emit event: [${result.name}]: %s`, JSON.stringify(result, null, 2));
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

    const createdData = this.applyCreates(docType, opBuilder?.creator, opCreateData);
    if (createdData) {
      return createdData;
    }

    const ops2Contexts = opBuilder?.ops2Contexts(ops) || [];
    return ops2Contexts.reduce((pre, cur) => {
      if (rawOpType === RawOpType.Edit) {
        this.applyEdits(docType, opBuilder?.editor, pre, cur, nodeId);
      }

      set(pre, ['context', 'opName'], cur.name);
      return pre;
    }, {});
  }

  private applyCreates(
    docType: IdPrefix,
    createBuilder?: ICreateOpBuilder,
    opCreateData?: unknown
  ) {
    if (opCreateData && createBuilder) {
      const buildData = createBuilder.build(opCreateData);
      const propertyCategory = this.getPropertyCategoryForType[docType as never];
      return { [propertyCategory]: buildData };
    }
  }

  private applyEdits(
    docType: IdPrefix,
    editBuilders: { [key: string]: IOpBuilder } | undefined,
    pre: object,
    cur: IOpContextBase,
    nodeId: string
  ) {
    if (!editBuilders) {
      return;
    }

    const editBuilder = editBuilders[cur.name as keyof typeof editBuilders];
    const propertyCategory = this.getPropertyCategoryForType[docType as never];
    const otOperation = editBuilder.build(cur);

    otOperation && this.buildAndApply(docType, otOperation, pre, propertyCategory, nodeId);
  }

  private buildAndApply(
    docType: IdPrefix,
    otOperation: IOtOperation,
    pre: object,
    propertyCategory: string,
    nodeId: string
  ) {
    const propertyName = otOperation.p[0];
    const oldValue = otOperation?.od;
    const newValue = otOperation?.oi;

    set(pre, [propertyCategory, 'id'], nodeId);

    if (docType === IdPrefix.Record) {
      const changeProperty = get(pre, [propertyCategory, propertyName]) || {};
      changeProperty[otOperation.p[1]] = { oldValue, newValue };
      set(pre, [propertyCategory, propertyName], changeProperty);
    } else {
      set(pre, [propertyCategory, propertyName], { oldValue, newValue });
    }
  }
}
