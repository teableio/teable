/* eslint-disable @typescript-eslint/naming-convention */
import { Injectable, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import type { IOtOperation, ISetRecordOpContext } from '@teable-group/core';
import {
  FieldOpBuilder,
  IdPrefix,
  OpName,
  RecordOpBuilder,
  TableOpBuilder,
  ViewOpBuilder,
} from '@teable-group/core';
import { plainToInstance } from 'class-transformer';
import { get, isEmpty, merge, set } from 'lodash';
import { filter, from, groupBy, mergeMap, tap, toArray } from 'rxjs';
import type { CreateOp, DeleteOp, EditOp } from 'sharedb';
import type { IRawOpMap } from '../share-db/interface';
import { RawOpType } from '../share-db/interface';
import type { IBaseEvent } from './interfaces/base-event.interface';
import {
  Events,
  FieldCreateEvent,
  FieldDeleteEvent,
  FieldUpdateEvent,
  RecordCreateBulkEvent,
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

  constructor(private readonly eventEmitter: EventEmitter2) {}

  emit(event: string, data: unknown | unknown[]): boolean {
    return this.eventEmitter.emit(event, data);
  }

  emitAsync(event: string, data: unknown | unknown[]): Promise<boolean[]> {
    return this.eventEmitter.emitAsync(event, data);
  }

  /**
   * 这里只处理一些可能需要衍生的操作
   * @param stashOpMap
   * @param publishOpMap
   */
  async ops2Event(stashOpMap?: IRawOpMap, publishOpMap?: IRawOpMap): Promise<void> {
    const events = this.parseOpMap(stashOpMap, publishOpMap);
    if (!events) {
      return;
    }

    console.log('events', events);

    // events?.forEach((value, _key) => {
    //   this.emit(value.name, value);
    // });

    from(Array.from(events.values()))
      .pipe(
        // 根据 type 对事件进行分组
        groupBy((event) => event.name),
        // 处理每个分组
        mergeMap((group) =>
          group.pipe(
            // 对每个单独的事件进行处理
            // tap((event) => this.emitAsync(event.name, event)),
            // 累积每个分组的事件
            toArray(),
            // 过滤掉长度小于 1 的数组
            filter((groupedEvents) => groupedEvents.length > 0),
            // 在每个分组的所有单独事件发送完毕后，发送该分组的块状事件
            tap((groupedEvents) => {
              console.log(`发送块状事件 (${group.key}):`, groupedEvents);
              if (group.key === Events.TABLE_RECORD_CREATE) {
                this.emit(Events.TABLE_RECORD_CREATE, groupedEvents);
              }
            })
          )
        )
      )
      .subscribe();
  }

  private parseOpMap(stashOpMap?: IRawOpMap, publishOpMap?: IRawOpMap) {
    if (!stashOpMap && !publishOpMap) {
      return;
    }

    const eventManager: Map<string, IBaseEvent> = new Map();

    if (stashOpMap) {
      this.buildEvents(false, stashOpMap, eventManager);
    }

    if (publishOpMap) {
      this.buildEvents(!isEmpty(stashOpMap), publishOpMap, eventManager);
    }
    return eventManager;
  }

  private buildEvents(
    isStash: boolean,
    rawOpMap: IRawOpMap,
    eventManager: Map<string, IBaseEvent>
  ) {
    for (const collection in rawOpMap) {
      const [docType, docId] = collection.split('_') as [IdPrefix, string];
      const data = rawOpMap[collection];

      for (const id in data) {
        const rawOp = data[id] as CreateOp | DeleteOp | EditOp;

        const extendPlainContext = {
          baseId: docId,
          tableId: docId,
          viewId: id,
          fieldId: id,
          recordId: id,
        };

        if ('create' in rawOp) {
          const plainContext = this.ops2ClassPlain(docType, RawOpType.Create, {
            resourceId: docId,
            nodeId: id,
            opCreateData: rawOp.create?.data,
            ops: rawOp.op,
          });

          const eventInstance = this.plainToEventInstance(docType, RawOpType.Create, {
            ...extendPlainContext,
            ...plainContext,
          });
          eventInstance && eventManager.set(id, eventInstance);
        } else if ('op' in rawOp) {
          const plainContext = this.ops2ClassPlain(docType, RawOpType.Edit, {
            resourceId: docId,
            nodeId: id,
            ops: (rawOp as EditOp).op,
          });

          const eventInstance = this.plainToEventInstance(docType, RawOpType.Edit, {
            ...extendPlainContext,
            ...plainContext,
          });
          if (!eventInstance) continue;

          if (isStash) {
            const stashEvent = eventManager.get(id);
            stashEvent && eventManager.set(id, merge({}, stashEvent, eventInstance));
          } else {
            eventManager.set(id, eventInstance);
          }
        } else {
          const plainContext = this.ops2ClassPlain(docType, RawOpType.Del, {
            resourceId: docId,
            nodeId: id,
          });

          const eventInstance = this.plainToEventInstance(docType, RawOpType.Del, {
            ...extendPlainContext,
            ...plainContext,
          });
          eventInstance && eventManager.set(id, eventInstance);
        }
      }
    }
  }

  private plainToEventInstance(docType: IdPrefix, action: RawOpType, plain: unknown) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const eventClass: any =
      this.eventClassMap[action]?.[
        docType as IdPrefix.Table | IdPrefix.View | IdPrefix.Field | IdPrefix.Record
      ];
    return eventClass && plainToInstance(eventClass, plain, { excludeExtraneousValues: true });
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

  private ops2ClassPlain(
    docType: IdPrefix,
    rawOpType: RawOpType,
    params: {
      resourceId: string;
      nodeId: string;
      opCreateData?: unknown;
      ops?: IOtOperation[];
    }
  ) {
    const { resourceId, nodeId, opCreateData, ops = [] } = params;
    const opBuilder = this.getOpBuilder(docType);

    if (opCreateData && opBuilder) {
      const buildData = opBuilder?.creator?.build(opCreateData as never);

      return {
        ...(docType === IdPrefix.Table ? { table: buildData } : {}),
        ...(docType === IdPrefix.View ? { view: buildData } : {}),
        ...(docType === IdPrefix.Field ? { field: buildData } : {}),
        ...(docType === IdPrefix.Record ? { record: buildData } : {}),
      };
    }

    const ops2Contexts = opBuilder?.ops2Contexts(ops) || [];
    return ops2Contexts?.reduce((pre, cur) => {
      if (rawOpType === RawOpType.Create && cur.name === OpName.SetRecord) {
        const { fieldId, newValue } = cur as ISetRecordOpContext;

        const value = get(pre, ['record', 'fields']) || {};
        value[fieldId] = newValue;

        set(pre, ['record', 'id'], nodeId);
        set(pre, ['record', 'fields'], value);
      }

      if (rawOpType === RawOpType.Edit && cur.name === OpName.SetRecord) {
        const { fieldId, newValue, oldValue } = cur as ISetRecordOpContext;

        const oldFields = get(pre, ['oldFields']) || {};
        oldFields[fieldId] = oldValue;

        const newFields = get(pre, ['newFields']) || {};
        newFields[fieldId] = newValue;

        set(pre, ['oldFields'], oldFields);
        set(pre, ['newFields'], newFields);
      }

      return pre;
    }, {});
  }
}
