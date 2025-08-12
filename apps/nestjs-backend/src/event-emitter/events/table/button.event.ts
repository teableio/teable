import type { IRecord } from '@teable/core';
import { match } from 'ts-pattern';
import { CoreEvent, type IEventContext } from '../core-event';
import { Events } from '../event.enum';

type IButtonClickEventPayload = {
  tableId: string;
  fieldId: string;
  record: IRecord;
};

export class ButtonClickEvent extends CoreEvent<IButtonClickEventPayload> {
  public readonly name = Events.TABLE_BUTTON_CLICK;

  constructor(payload: IButtonClickEventPayload, context: IEventContext) {
    super(payload, context);
  }
}

export class ButtonEventFactory {
  static create(name: string, payload: IButtonClickEventPayload, context: IEventContext) {
    return match(name)
      .with(Events.TABLE_BUTTON_CLICK, () => {
        return new ButtonClickEvent(payload, context);
      })
      .otherwise(() => null);
  }
}
