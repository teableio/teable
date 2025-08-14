import type { IUpdateUserLastVisitRo } from '@teable/openapi';
import { Events } from '../event.enum';

export class LastVisitUpdateEvent {
  public readonly name = Events.LAST_VISIT_UPDATE;

  constructor(public readonly payload: IUpdateUserLastVisitRo) {}
}
