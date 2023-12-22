import type { IViewVo } from '@teable-group/core';
import { Expose } from 'class-transformer';
import { RawOpType } from '../../../share-db/interface';
import type { IEventContext } from '../../interfaces/base-event.interface';
import { Events } from '../event.enum';
import type { IChangeValue } from './base-op-event';
import { BaseOpEvent } from './base-op-event';

type IEventName = Extract<
  Events,
  Events.TABLE_VIEW_CREATE | Events.TABLE_VIEW_DELETE | Events.TABLE_VIEW_UPDATE
>;

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

export class ViewCreateEvent extends BaseOpEvent {
  name: IEventName = Events.TABLE_VIEW_CREATE;
  @Expose() tableId: string;
  @Expose() view: IViewVo | IViewVo[];

  constructor(tableId: string, view: IViewVo | IViewVo[], context: IEventContext) {
    super(RawOpType.Create, Array.isArray(view), context);

    this.tableId = tableId;
    this.view = view;
  }
}

export class ViewDeleteEvent extends BaseOpEvent {
  name: IEventName = Events.TABLE_VIEW_DELETE;
  @Expose() tableId: string;
  @Expose() viewId: string;

  constructor(tableId: string, viewId: string, context: IEventContext) {
    super(RawOpType.Del, false, context);

    this.tableId = tableId;
    this.viewId = viewId;
  }
}

export class ViewUpdateEvent extends BaseOpEvent {
  name: IEventName = Events.TABLE_VIEW_UPDATE;
  @Expose() tableId: string;
  @Expose() view: IChangeView;

  constructor(tableId: string, view: IChangeView, context: IEventContext) {
    super(RawOpType.Edit, false, context);

    this.tableId = tableId;
    this.view = view;
  }
}
