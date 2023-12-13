import type { IViewVo } from '@teable-group/core';
import { Expose } from 'class-transformer';
import { RawOpType } from '../../../share-db/interface';
import type { IBaseEvent } from '../../interfaces/base-event.interface';
import { IEventContext } from '../../interfaces/base-event.interface';
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
    'id' | 'type' | 'createdBy' | 'lastModifiedBy' | 'createdTime' | 'lastModifiedTime'
  >,
  IChangeValue
> & { id: string };

@Expose()
export class ViewCreateEvent extends BaseOpEvent {
  name: IEventName = Events.TABLE_VIEW_CREATE;
  @Expose() tableId: string;
  @Expose() view: IViewVo | IViewVo[];

  constructor(tableId: string, view: IViewVo | IViewVo[], context: IEventContext) {
    super(RawOpType.Create, view && Array.isArray(view), context);

    this.tableId = tableId;
    this.view = view;
  }
}

@Expose()
export class ViewDeleteEvent implements IBaseEvent {
  name: IEventName = Events.TABLE_VIEW_DELETE;
  context: IEventContext;
  tableId: string;
  viewId: string;

  constructor(tableId: string, viewId: string, context: IEventContext) {
    this.tableId = tableId;
    this.viewId = viewId;
    this.context = context;
  }
}

@Expose()
export class ViewUpdateEvent extends BaseOpEvent {
  name: IEventName = Events.TABLE_VIEW_UPDATE;
  @Expose() tableId: string;
  @Expose() view: IChangeView | IChangeView[] | undefined;

  constructor(
    tableId: string,
    view: IChangeView | IChangeView[] | undefined,
    context: IEventContext
  ) {
    super(RawOpType.Edit, view && Array.isArray(view), context);
    this.tableId = tableId;
    this.view = view;
  }
}
