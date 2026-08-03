import type { ICreateDashboardVo } from '@teable/openapi';
import { match } from 'ts-pattern';
import type { IEventContext } from '../core-event';
import { CoreEvent } from '../core-event';
import { Events } from '../event.enum';

type IDashboardCreatePayload = { baseId: string; dashboard: ICreateDashboardVo };
type IDashboardUpdatePayload = { baseId: string; dashboard: ICreateDashboardVo };
type IDashboardDeletePayload = { baseId: string; dashboardId: string; permanent?: boolean };

export class DashboardCreateEvent extends CoreEvent<IDashboardCreatePayload> {
  public readonly name = Events.DASHBOARD_CREATE;

  constructor(payload: IDashboardCreatePayload, context: IEventContext) {
    super(payload, context);
  }
}

export class DashboardDeleteEvent extends CoreEvent<IDashboardDeletePayload> {
  public readonly name = Events.DASHBOARD_DELETE;
  constructor(payload: IDashboardDeletePayload, context: IEventContext) {
    super(payload, context);
  }
}

export class DashboardUpdateEvent extends CoreEvent<IDashboardUpdatePayload> {
  public readonly name = Events.DASHBOARD_UPDATE;

  constructor(payload: IDashboardUpdatePayload, context: IEventContext) {
    super(payload, context);
  }
}

export class DashboardEventFactory {
  static create(
    name: string,
    payload: IDashboardCreatePayload | IDashboardDeletePayload | IDashboardUpdatePayload,
    context: IEventContext
  ) {
    return match(name)
      .with(Events.DASHBOARD_CREATE, () => {
        return new DashboardCreateEvent(payload as IDashboardCreatePayload, context);
      })
      .with(Events.DASHBOARD_DELETE, () => {
        return new DashboardDeleteEvent(payload as IDashboardDeletePayload, context);
      })
      .with(Events.DASHBOARD_UPDATE, () => {
        return new DashboardUpdateEvent(payload as IDashboardUpdatePayload, context);
      })
      .otherwise(() => null);
  }
}
