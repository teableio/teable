import type { IFieldVo, IRecord } from '@teable/core';
import { match } from 'ts-pattern';
import { RawOpType } from '../../../share-db/interface';
import type { IEventContext } from '../core-event';
import { Events } from '../event.enum';
import type { IChangeValue } from '../op-event';
import { OpEvent } from '../op-event';

export type IChangeRecord = Record<keyof Pick<IRecord, 'fields'>, Record<string, IChangeValue>> & {
  id: string;
};

type IRecordCreatePayload = { tableId: string; record: IRecord | IRecord[] };
type IRecordDeletePayload = { tableId: string; recordId: string | string[] };
type IRecordUpdatePayload = {
  tableId: string;
  record: IChangeRecord | IChangeRecord[];
  oldField: IFieldVo | undefined;
};

export class RecordCreateEvent extends OpEvent<IRecordCreatePayload> {
  public readonly name = Events.TABLE_RECORD_CREATE;
  public readonly rawOpType = RawOpType.Create;

  constructor(tableId: string, record: IRecord | IRecord[], context: IEventContext) {
    super({ tableId, record }, context, Array.isArray(record));
  }
}

export class RecordDeleteEvent extends OpEvent<IRecordDeletePayload> {
  public readonly name = Events.TABLE_RECORD_DELETE;
  public readonly rawOpType = RawOpType.Del;

  constructor(tableId: string, recordId: string | string[], context: IEventContext) {
    super({ tableId, recordId }, context, Array.isArray(recordId));
  }
}

export class RecordUpdateEvent extends OpEvent<IRecordUpdatePayload> {
  public readonly name = Events.TABLE_RECORD_UPDATE;
  public readonly rawOpType = RawOpType.Edit;

  constructor(
    tableId: string,
    record: IChangeRecord | IChangeRecord[],
    oldField: IFieldVo | undefined,
    context: IEventContext
  ) {
    super({ tableId, record, oldField }, context, Array.isArray(record));
  }
}

export class RecordEventFactory {
  static create(
    name: string,
    payload: IRecordCreatePayload | IRecordDeletePayload | IRecordUpdatePayload,
    context: IEventContext
  ) {
    return match(name)
      .with(Events.TABLE_RECORD_CREATE, () => {
        const { tableId, record } = payload as IRecordCreatePayload;
        return new RecordCreateEvent(tableId, record, context);
      })
      .with(Events.TABLE_RECORD_DELETE, () => {
        const { tableId, recordId } = payload as IRecordDeletePayload;
        return new RecordDeleteEvent(tableId, recordId, context);
      })
      .with(Events.TABLE_RECORD_UPDATE, () => {
        const { tableId, record, oldField } = payload as IRecordUpdatePayload;
        return new RecordUpdateEvent(tableId, record, oldField, context);
      })
      .otherwise(() => null);
  }
}
