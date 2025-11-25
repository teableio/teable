import type { ICreateDashboardVo } from '@teable/openapi';
import { match } from 'ts-pattern';
import type { IEventContext } from '../core-event';
import { CoreEvent } from '../core-event';
import { Events } from '../event.enum';

type IDashboardCreatePayload = { baseId: string; dashboard: ICreateDashboardVo };
type IDashboardUpdatePayload = { baseId: string; dashboard: ICreateDashboardVo };
type IDashboardDeletePayload = { baseId: string; dashboardId: string };

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
        const { baseId, dashboard } = payload as IDashboardCreatePayload;
        return new DashboardCreateEvent({ baseId, dashboard }, context);
      })
      .with(Events.DASHBOARD_DELETE, () => {
        const { baseId, dashboardId } = payload as IDashboardDeletePayload;
        return new DashboardDeleteEvent({ baseId, dashboardId }, context);
      })
      .with(Events.DASHBOARD_UPDATE, () => {
        const { baseId, dashboard } = payload as IDashboardUpdatePayload;
        return new DashboardUpdateEvent({ baseId, dashboard }, context);
      })
      .otherwise(() => null);
  }
}
