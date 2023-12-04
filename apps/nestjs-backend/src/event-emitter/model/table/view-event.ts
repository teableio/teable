import { IViewVo } from '@teable-group/core';
import { Exclude, Expose } from 'class-transformer';
import { AbstractEvent } from '../../abstract/event.abstract';
import { IEventContext } from '../../interfaces/base-event.interface';
import { Events } from '../event.enum';

type IEventName = Extract<
  Events,
  Events.TABLE_VIEW_CREATE | Events.TABLE_VIEW_DELETE | Events.TABLE_VIEW_UPDATE
>;

@Expose()
export class ViewCreateEvent extends AbstractEvent {
  name: IEventName = Events.TABLE_VIEW_CREATE;
  @Expose() context: IEventContext;
  @Expose() tableId: string;
  @Expose() view: IViewVo;

  constructor(tableId: string, view: IViewVo, context: IEventContext) {
    super();
    this.tableId = tableId;
    this.view = view;
    this.context = context;
  }
}

@Expose()
export class ViewDeleteEvent extends AbstractEvent {
  name: IEventName = Events.TABLE_VIEW_DELETE;
  context: IEventContext;
  tableId: string;
  viewId: string;

  constructor(tableId: string, viewId: string, context: IEventContext) {
    super();
    this.tableId = tableId;
    this.viewId = viewId;
    this.context = context;
  }
}
@Expose()
export class ViewUpdateEvent extends AbstractEvent {
  name: IEventName = Events.TABLE_VIEW_UPDATE;
  context: IEventContext;
  tableId: string;
  viewId: string;
  view: Pick<IViewVo, 'sort'>;

  constructor(
    tableId: string,
    viewId: string,
    view: Pick<IViewVo, 'sort'>,
    context: IEventContext
  ) {
    super();
    this.tableId = tableId;
    this.viewId = viewId;
    this.view = view;
    this.context = context;
  }
}
