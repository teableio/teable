import { match } from 'ts-pattern';
import { CoreEvent, type IEventContext } from '../core-event';
import { Events } from '../event.enum';

type IButtonClickPayload = {
  viewId?: string;
  tableId: string;
  recordId: string;
  fieldId: string;
};

export class ButtonClickEvent extends CoreEvent<IButtonClickPayload> {
  public readonly name = Events.TABLE_BUTTON_CLICK;

  constructor(payload: IButtonClickPayload, context: IEventContext) {
    super(payload, context);
  }
}

export class ButtonEventFactory {
  static create(name: string, payload: IButtonClickPayload, context: IEventContext) {
    return match(name)
      .with(Events.TABLE_BUTTON_CLICK, () => {
        return new ButtonClickEvent(payload, context);
      })
      .otherwise(() => null);
  }
}
