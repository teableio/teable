import { IFieldVo } from '@teable-group/core';
import { Expose } from 'class-transformer';
import { AbstractEvent } from '../../abstract/event.abstract';
import { IEventContext } from '../../interfaces/base-event.interface';
import { Events } from '../event.enum';

type IEventName = Extract<
  Events,
  Events.TABLE_FIELD_CREATE | Events.TABLE_FIELD_DELETE | Events.TABLE_FIELD_UPDATE
>;

@Expose()
export class FieldCreateEvent extends AbstractEvent {
  name: IEventName = Events.TABLE_FIELD_CREATE;
  @Expose() context: IEventContext;
  @Expose() tableId: string;
  @Expose() field: IFieldVo;

  constructor(tableId: string, field: IFieldVo, context: IEventContext) {
    super();
    this.tableId = tableId;
    this.field = field;
    this.context = context;
  }
}

@Expose()
export class FieldDeleteEvent extends AbstractEvent {
  name: IEventName = Events.TABLE_FIELD_DELETE;
  context: IEventContext;
  tableId: string;
  fieldId: string;

  constructor(tableId: string, fieldId: string, context: IEventContext) {
    super();
    this.tableId = tableId;
    this.fieldId = fieldId;
    this.context = context;
  }
}

@Expose()
export class FieldUpdateEvent extends AbstractEvent {
  name: IEventName = Events.TABLE_FIELD_UPDATE;
  context: IEventContext;
  tableId: string;
  fieldId: string;
  field: IFieldVo;

  constructor(tableId: string, fieldId: string, field: IFieldVo, context: IEventContext) {
    super();
    this.tableId = tableId;
    this.fieldId = fieldId;
    this.field = field;
    this.context = context;
  }
}
