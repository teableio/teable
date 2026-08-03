import { match } from 'ts-pattern';
import type { IEventContext } from '../../core-event';
import { CoreEvent } from '../../core-event';
import { Events } from '../../event.enum';

type IBaseFolder = {
  id: string;
  name: string;
};

type IBaseFolderCreatePayload = { baseId: string; folder: IBaseFolder };
type IBaseFolderDeletePayload = { baseId: string; folderId: string };
type IBaseFolderUpdatePayload = IBaseFolderCreatePayload;

export class BaseFolderCreateEvent extends CoreEvent<IBaseFolderCreatePayload> {
  public readonly name = Events.BASE_FOLDER_CREATE;

  constructor(payload: IBaseFolderCreatePayload, context: IEventContext) {
    super(payload, context);
  }
}

export class BaseFolderDeleteEvent extends CoreEvent<IBaseFolderDeletePayload> {
  public readonly name = Events.BASE_FOLDER_DELETE;
  constructor(payload: IBaseFolderDeletePayload, context: IEventContext) {
    super(payload, context);
  }
}

export class BaseFolderUpdateEvent extends CoreEvent<IBaseFolderUpdatePayload> {
  public readonly name = Events.BASE_FOLDER_UPDATE;

  constructor(payload: IBaseFolderUpdatePayload, context: IEventContext) {
    super(payload, context);
  }
}

export class BaseFolderEventFactory {
  static create(
    name: string,
    payload: IBaseFolderCreatePayload | IBaseFolderDeletePayload | IBaseFolderUpdatePayload,
    context: IEventContext
  ) {
    return match(name)
      .with(Events.BASE_FOLDER_CREATE, () => {
        const { baseId, folder } = payload as IBaseFolderCreatePayload;
        return new BaseFolderCreateEvent({ baseId, folder }, context);
      })
      .with(Events.BASE_FOLDER_DELETE, () => {
        const { baseId, folderId } = payload as IBaseFolderDeletePayload;
        return new BaseFolderDeleteEvent({ baseId, folderId }, context);
      })
      .with(Events.BASE_FOLDER_UPDATE, () => {
        const { baseId, folder } = payload as IBaseFolderUpdatePayload;
        return new BaseFolderUpdateEvent({ baseId, folder }, context);
      })
      .otherwise(() => null);
  }
}
