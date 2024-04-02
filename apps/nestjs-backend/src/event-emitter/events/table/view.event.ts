import type { IViewVo } from '@teable/core';
import { match } from 'ts-pattern';
import { RawOpType } from '../../../share-db/interface';
import type { IEventContext } from '../core-event';
import { Events } from '../event.enum';
import type { IChangeValue } from '../op-event';
import { OpEvent } from '../op-event';

export type IChangeView = Record<
  keyof Omit<
    IViewVo,
    | 'id'
    | 'type'
    | 'columnMeta'
    | 'createdBy'
    | 'lastModifiedBy'
    | 'createdTime'
    | 'lastModifiedTime'
  >,
  IChangeValue
> & {
  columnMeta: Record<string, IChangeValue>;
  id: string;
};

type IViewCreatePayload = { tableId: string; view: IViewVo | IViewVo[] };
type IViewDeletePayload = { tableId: string; viewId: string };
type IViewUpdatePayload = {
  tableId: string;
  view: IChangeView;
};

export class ViewCreateEvent extends OpEvent<IViewCreatePayload> {
  public readonly name = Events.TABLE_VIEW_CREATE;
  public readonly rawOpType = RawOpType.Create;

  constructor(tableId: string, view: IViewVo | IViewVo[], context: IEventContext) {
    super({ tableId, view }, context, Array.isArray(view));
  }
}

export class ViewDeleteEvent extends OpEvent<IViewDeletePayload> {
  public readonly name = Events.TABLE_VIEW_DELETE;
  public readonly rawOpType = RawOpType.Del;

  constructor(tableId: string, viewId: string, context: IEventContext) {
    super({ tableId, viewId }, context);
  }
}

export class ViewUpdateEvent extends OpEvent<IViewUpdatePayload> {
  public readonly name = Events.TABLE_VIEW_UPDATE;
  public readonly rawOpType = RawOpType.Edit;

  constructor(tableId: string, view: IChangeView, context: IEventContext) {
    super({ tableId, view }, context);
  }
}

export class ViewEventFactory {
  static create(
    name: string,
    payload: IViewCreatePayload | IViewDeletePayload | IViewUpdatePayload,
    context: IEventContext
  ) {
    return match(name)
      .with(Events.TABLE_VIEW_CREATE, () => {
        const { tableId, view } = payload as IViewCreatePayload;
        return new ViewCreateEvent(tableId, view, context);
      })
      .with(Events.TABLE_VIEW_DELETE, () => {
        const { tableId, viewId } = payload as IViewDeletePayload;
        return new ViewDeleteEvent(tableId, viewId, context);
      })
      .with(Events.TABLE_VIEW_UPDATE, () => {
        const { tableId, view } = payload as IViewUpdatePayload;
        return new ViewUpdateEvent(tableId, view, context);
      })
      .otherwise(() => null);
  }
}
