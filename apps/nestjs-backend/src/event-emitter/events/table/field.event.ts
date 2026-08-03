import type { IFieldPropertyKey, IFieldVo } from '@teable/core';
import { match } from 'ts-pattern';
import { RawOpType } from '../../../share-db/interface';
import type { IEventContext } from '../core-event';
import { Events } from '../event.enum';
import type { IChangeValue } from '../op-event';
import { OpEvent } from '../op-event';

export type IChangeField = Record<IFieldPropertyKey, IChangeValue> & { id: string };

type IFieldCreatePayload = { tableId: string; field: IFieldVo | IFieldVo[] };
type IFieldDeletePayload = { tableId: string; fieldId: string | string[] };
type IFieldUpdatePayload = {
  tableId: string;
  field: IChangeField | IChangeField[];
};

export class FieldCreateEvent extends OpEvent<IFieldCreatePayload> {
  public readonly name = Events.TABLE_FIELD_CREATE;
  public readonly rawOpType = RawOpType.Create;

  constructor(tableId: string, field: IFieldVo | IFieldVo[], context: IEventContext) {
    super({ tableId, field }, context, Array.isArray(field));
  }
}

export class FieldDeleteEvent extends OpEvent<IFieldDeletePayload> {
  public readonly name = Events.TABLE_FIELD_DELETE;
  public readonly rawOpType = RawOpType.Del;
  public isBulk = false;

  constructor(tableId: string, fieldId: string | string[], context: IEventContext) {
    super({ tableId, fieldId }, context, Array.isArray(fieldId));
  }
}

export class FieldUpdateEvent extends OpEvent<IFieldUpdatePayload> {
  public readonly name = Events.TABLE_FIELD_UPDATE;
  public readonly rawOpType = RawOpType.Edit;
  public isBulk = false;

  constructor(tableId: string, field: IChangeField | IChangeField[], context: IEventContext) {
    super({ tableId, field }, context, Array.isArray(field));
  }
}

export class FieldEventFactory {
  static create(
    name: string,
    payload: IFieldCreatePayload | IFieldDeletePayload | IFieldUpdatePayload,
    context: IEventContext
  ) {
    return match(name)
      .with(Events.TABLE_FIELD_CREATE, () => {
        const { tableId, field } = payload as IFieldCreatePayload;
        return new FieldCreateEvent(tableId, field, context);
      })
      .with(Events.TABLE_FIELD_DELETE, () => {
        const { tableId, fieldId } = payload as IFieldDeletePayload;
        return new FieldDeleteEvent(tableId, fieldId, context);
      })
      .with(Events.TABLE_FIELD_UPDATE, () => {
        const { tableId, field } = payload as IFieldUpdatePayload;
        return new FieldUpdateEvent(tableId, field, context);
      })
      .otherwise(() => null);
  }
}
