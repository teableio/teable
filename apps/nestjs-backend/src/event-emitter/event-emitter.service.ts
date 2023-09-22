/* eslint-disable @typescript-eslint/no-explicit-any */
import { Injectable, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { FieldOpBuilder, IdPrefix, RecordOpBuilder, ViewOpBuilder } from '@teable-group/core';
import { plainToInstance } from 'class-transformer';
import { groupBy } from 'lodash';
import type ShareDBClass from 'sharedb';
import type { EventAbstract } from './abstract/event.abstract';
import type { IEventBase } from './interfaces/event-base.interface';
import {
  FieldCreatedEvent,
  FieldUpdatedEvent,
  RecordCreatedEvent,
  RecordUpdatedEvent,
  ViewCreatedEvent,
  ViewUpdatedEvent,
} from './model';

enum IEventType {
  Create = 'create',
  Edit = 'edit',
  Delete = 'delete',
}

@Injectable()
export class EventEmitterService {
  private readonly logger = new Logger(EventEmitterService.name);
  constructor(private readonly eventEmitter: EventEmitter2) {}

  ops2Event(ops: (ShareDBClass.CreateOp | ShareDBClass.DeleteOp | ShareDBClass.EditOp)[]) {
    const events = this.extractionEvent(ops);

    const eventGroupMap = groupBy(events, (value) => {
      return `${value.docType}_${value.eventType}`;
    });

    const getEventClass = (type: string) => {
      switch (type) {
        case `${IdPrefix.Record}_${IEventType.Create}`:
          return RecordCreatedEvent;
        case `${IdPrefix.Record}_${IEventType.Edit}`: {
          return RecordUpdatedEvent;
        }
        case `${IdPrefix.Record}_${IEventType.Delete}`: {
          return undefined;
        }
        case `${IdPrefix.Field}_${IEventType.Create}`:
          return FieldCreatedEvent;
        case `${IdPrefix.Field}_${IEventType.Edit}`: {
          return FieldUpdatedEvent;
        }
        case `${IdPrefix.Field}_${IEventType.Delete}`: {
          return undefined;
        }
        case `${IdPrefix.View}_${IEventType.Create}`:
          return ViewCreatedEvent;
        case `${IdPrefix.View}_${IEventType.Edit}`: {
          return ViewUpdatedEvent;
        }
        case `${IdPrefix.View}_${IEventType.Delete}`: {
          return undefined;
        }
        default:
          break;
      }
    };

    const eventInstances = Object.entries(eventGroupMap).reduce((pre, [type, value]) => {
      const eventClass = getEventClass(type);
      if (eventClass) {
        pre.push(...plainToInstance<EventAbstract, any[]>(eventClass, value));
      }
      return pre;
    }, [] as IEventBase[]);

    eventInstances.forEach((event) => {
      this.eventEmitter.emit(event.eventName, event.toJSON());
    });
  }

  private extractionEvent(
    ops: (ShareDBClass.CreateOp | ShareDBClass.DeleteOp | ShareDBClass.EditOp)[]
  ) {
    const result: any[] = [];
    const tableOpsRaw = groupBy(ops, 'c');

    const getOpBuilder = (docType: IdPrefix) => {
      switch (docType) {
        case IdPrefix.Field:
          return FieldOpBuilder;
        case IdPrefix.View:
          return ViewOpBuilder;
        case IdPrefix.Record:
          return RecordOpBuilder;
      }
    };

    Object.entries(tableOpsRaw).forEach(([id, ops]) => {
      const [docType, tableId] = id.split('_') as [IdPrefix, string];

      let data: any = { docType, tableId };
      const cacheData: Map<
        string,
        {
          recordId: string;
          eventType: IEventType;
        }
      > = new Map();

      ops.forEach((op) => {
        if ('create' in op) {
          const createOp = op as ShareDBClass.CreateOp;

          cacheData.set(createOp.d, { recordId: createOp.d, eventType: IEventType.Create });

          data = { ...data, eventType: IEventType.Create };
        } else if ('op' in op) {
          const editOp = op as ShareDBClass.EditOp;

          const refData = cacheData.get(editOp.d);

          const eventType = refData?.eventType ?? IEventType.Edit;

          const recordId = refData?.recordId ?? editOp.d;

          data = { ...data, recordId, eventType };

          const opBuilder = getOpBuilder(docType);

          if (opBuilder) {
            (data.ops = data.ops ?? []).push(getOpBuilder(docType)?.ops2Contexts(editOp.op));
          }
        } else {
          // ignore
        }
      });

      result.push(data);
    });

    return result;
  }
}
