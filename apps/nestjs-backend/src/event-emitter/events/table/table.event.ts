import type { ITableOp } from '@teable/core';
import { match } from 'ts-pattern';
import { RawOpType } from '../../../share-db/interface';
import type { IEventContext } from '../core-event';
import { Events } from '../event.enum';
import type { IChangeValue } from '../op-event';
import { OpEvent } from '../op-event';

export type IChangeTable = Record<keyof Omit<ITableOp, 'id' | 'lastModifiedTime'>, IChangeValue> & {
  id: string;
};

type ITableCreatePayload = { baseId: string; table: ITableOp };
type ITableDeletePayload = { baseId: string; tableId: string; permanent?: boolean };
type ITableUpdatePayload = {
  baseId: string;
  table: IChangeTable;
};

export class TableCreateEvent extends OpEvent<ITableCreatePayload> {
  public readonly name = Events.TABLE_CREATE;
  public readonly rawOpType = RawOpType.Create;

  constructor(payload: ITableCreatePayload, context: IEventContext) {
    super(payload, context);
  }
}

export class TableDeleteEvent extends OpEvent<ITableDeletePayload> {
  public readonly name = Events.TABLE_DELETE;
  public readonly rawOpType = RawOpType.Del;

  constructor(payload: ITableDeletePayload, context: IEventContext) {
    super(payload, context);
  }
}

export class TableUpdateEvent extends OpEvent<ITableUpdatePayload> {
  public readonly name = Events.TABLE_UPDATE;
  public readonly rawOpType = RawOpType.Edit;

  constructor(payload: ITableUpdatePayload, context: IEventContext) {
    super(payload, context);
  }
}

export class TableEventFactory {
  static create(
    name: string,
    payload: ITableCreatePayload | ITableDeletePayload | ITableUpdatePayload,
    context: IEventContext
  ) {
    return match(name)
      .with(Events.TABLE_CREATE, () => {
        return new TableCreateEvent(payload as ITableCreatePayload, context);
      })
      .with(Events.TABLE_DELETE, () => {
        return new TableDeleteEvent(payload as ITableDeletePayload, context);
      })
      .with(Events.TABLE_UPDATE, () => {
        return new TableUpdateEvent(payload as ITableUpdatePayload, context);
      })
      .otherwise(() => null);
  }
}
