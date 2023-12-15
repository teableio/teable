import type { IFieldPropertyKey, IFieldVo } from '@teable-group/core';
import { Expose } from 'class-transformer';
import { RawOpType } from '../../../share-db/interface';
import type { IEventContext } from '../../interfaces/base-event.interface';
import { Events } from '../event.enum';
import type { IChangeValue } from './base-op-event';
import { BaseOpEvent } from './base-op-event';

type IEventName = Extract<
  Events,
  Events.TABLE_FIELD_CREATE | Events.TABLE_FIELD_DELETE | Events.TABLE_FIELD_UPDATE
>;

export type IChangeField = Record<IFieldPropertyKey, IChangeValue> & { id: string };

export class FieldCreateEvent extends BaseOpEvent {
  name: IEventName = Events.TABLE_FIELD_CREATE;
  @Expose() tableId: string;
  @Expose() field: IFieldVo | IFieldVo[];

  constructor(tableId: string, field: IFieldVo | IFieldVo[], context: IEventContext) {
    super(RawOpType.Create, Array.isArray(field), context);

    this.tableId = tableId;
    this.field = field;
  }
}

export class FieldDeleteEvent extends BaseOpEvent {
  name: IEventName = Events.TABLE_FIELD_DELETE;
  @Expose() tableId: string;
  @Expose() fieldId: string | string[] | undefined;

  constructor(tableId: string, fieldId: string | string[] | undefined, context: IEventContext) {
    super(RawOpType.Del, Array.isArray(fieldId), context);

    this.tableId = tableId;
    this.fieldId = fieldId;
  }
}

export class FieldUpdateEvent extends BaseOpEvent {
  name: IEventName = Events.TABLE_FIELD_UPDATE;
  @Expose() tableId: string;
  @Expose() field: IChangeField | IChangeField[] | undefined;

  constructor(
    tableId: string,
    field: IChangeField | IChangeField[] | undefined,
    context: IEventContext
  ) {
    super(RawOpType.Edit, Array.isArray(field), context);

    this.tableId = tableId;
    this.field = field;
  }
}
