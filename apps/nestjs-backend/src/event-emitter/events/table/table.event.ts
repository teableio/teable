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
type ITableDeletePayload = { baseId: string; tableId: string };
type ITableUpdatePayload = {
  baseId: string;
  table: IChangeTable;
};

export class TableCreateEvent extends OpEvent<ITableCreatePayload> {
  public readonly name = Events.TABLE_CREATE;
  public readonly rawOpType = RawOpType.Create;

  constructor(baseId: string, table: ITableOp, context: IEventContext) {
    super({ baseId, table }, context);
  }
}

export class TableDeleteEvent extends OpEvent<ITableDeletePayload> {
  public readonly name = Events.TABLE_DELETE;
  public readonly rawOpType = RawOpType.Del;

  constructor(baseId: string, tableId: string, context: IEventContext) {
    super({ baseId, tableId }, context);
  }
}

export class TableUpdateEvent extends OpEvent<ITableUpdatePayload> {
  public readonly name = Events.TABLE_UPDATE;
  public readonly rawOpType = RawOpType.Edit;

  constructor(baseId: string, table: IChangeTable, context: IEventContext) {
    super({ baseId, table }, context);
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
        const { baseId, table } = payload as ITableCreatePayload;
        return new TableCreateEvent(baseId, table, context);
      })
      .with(Events.TABLE_DELETE, () => {
        const { baseId, tableId } = payload as ITableDeletePayload;
        return new TableDeleteEvent(baseId, tableId, context);
      })
      .with(Events.TABLE_UPDATE, () => {
        const { baseId, table } = payload as ITableUpdatePayload;
        return new TableUpdateEvent(baseId, table, context);
      })
      .otherwise(() => null);
  }
}
