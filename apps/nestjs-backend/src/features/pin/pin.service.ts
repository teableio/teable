/* eslint-disable @typescript-eslint/naming-convention */
import { Injectable } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { HttpErrorCode, type ViewType } from '@teable/core';
import { type Prisma, PrismaService } from '@teable/db-main-prisma';
import type {
  IGetPinListVo,
  IGetPinListRo,
  IPinEntryMapVo,
  AddPinRo,
  DeletePinRo,
  UpdatePinOrderRo,
} from '@teable/openapi';
import { PinType } from '@teable/openapi';
import { Knex } from 'knex';
import { InjectModel } from 'nest-knexjs';
import { ClsService } from 'nestjs-cls';
import { CustomHttpException } from '../../custom.exception';
import type {
  RoutineDeleteEvent,
  AppDeleteEvent,
  BaseDeleteEvent,
  DashboardDeleteEvent,
  SpaceDeleteEvent,
  TableDeleteEvent,
  ViewDeleteEvent,
  WorkflowDeleteEvent,
} from '../../event-emitter/events';
import { Events } from '../../event-emitter/events';
import type { IClsStore } from '../../types/cls';
import { updateOrder } from '../../utils/update-order';
import { getPublicFullStorageUrl } from '../attachments/plugins/utils';
import { LastVisitService } from '../user/last-visit/last-visit.service';

/**
 * One SQL branch of the pin list per type. It receives the caller's pin rows of that type
 * (`pin_resource`, already filtered by user and type), joins the resource table onto them and
 * selects the shared column set through `pinColumns`. All branches are UNION ALLed into a
 * single statement, so listing pins costs one round trip however many types are pinned.
 */
export type IPinSource = (pins: Knex.QueryBuilder) => IPinBranch | Promise<IPinBranch>;

/**
 * A branch's query, wrapped: knex builders are thenables, so handing one back through an
 * `async` source or `Promise.all` would execute it instead of passing it along.
 */
export interface IPinBranch {
  query: Knex.QueryBuilder;
}

/** A pin list row as the statement returns it: one per pin whose resource still exists. */
export interface IPinRow {
  id: string;
  type: string;
  order: number;
  name: string;
  icon: string | null;
  parentBaseId: string | null;
  /** Type-specific extras: view details for views, chat details in the enterprise edition. */
  meta: Record<string, unknown> | null;
}

/** Pin types the space sidebar lists when no type filter is given: navigable resources. */
export const SIDEBAR_PIN_TYPES: PinType[] = [
  PinType.Space,
  PinType.Base,
  PinType.Table,
  PinType.View,
  PinType.Dashboard,
  PinType.Workflow,
  PinType.App,
  PinType.Routine,
];

@Injectable()
export class PinService {
  constructor(
    private readonly prismaService: PrismaService,
    private readonly cls: ClsService<IClsStore>,
    @InjectModel('CUSTOM_KNEX') private readonly knex: Knex,
    private readonly lastVisitService: LastVisitService
  ) {}

  /**
   * The SQL branch of each pin type. One entry per type: adding a type means adding a branch,
   * nothing else. Editions extend the map for the types they own (chat, workflow and app pins
   * live in the enterprise override, whose tables Community does not have); a pin whose type
   * has no branch here is simply left out.
   */
  protected readonly pinSources: Partial<Record<PinType, IPinSource>> = {
    [PinType.Space]: (pins) => ({
      query: pins
        .join('space', 'space.id', 'pin_resource.resource_id')
        .whereNull('space.deleted_time')
        .select(this.pinColumns({ name: 'space.name' })),
    }),
    [PinType.Base]: (pins) => ({
      query: pins
        .join('base', 'base.id', 'pin_resource.resource_id')
        .whereNull('base.deleted_time')
        .select(this.pinColumns({ name: 'base.name', icon: 'base.icon' })),
    }),
    [PinType.Table]: (pins) => ({
      query: pins
        .join('table_meta', 'table_meta.id', 'pin_resource.resource_id')
        .whereNull('table_meta.deleted_time')
        .select(
          this.pinColumns({
            name: 'table_meta.name',
            icon: 'table_meta.icon',
            parentBaseId: 'table_meta.base_id',
          })
        ),
    }),
    [PinType.View]: (pins) => ({
      query: pins
        .join('view', 'view.id', 'pin_resource.resource_id')
        .join('table_meta', 'table_meta.id', 'view.table_id')
        .whereNull('view.deleted_time')
        .whereNull('table_meta.deleted_time')
        .select(
          this.pinColumns({
            name: 'view.name',
            parentBaseId: 'table_meta.base_id',
            meta: this.knex.raw(
              "jsonb_build_object('tableId', table_meta.id, 'type', view.type, 'options', view.options)"
            ),
          })
        ),
    }),
    [PinType.Dashboard]: (pins) => ({
      query: pins
        .join('dashboard', 'dashboard.id', 'pin_resource.resource_id')
        .select(this.pinColumns({ name: 'dashboard.name', parentBaseId: 'dashboard.base_id' })),
    }),
  };

  /** The caller's pin rows of one type: the starting point of every branch. */
  private pinsOf(userId: string, type: PinType) {
    return this.knex('pin_resource')
      .where('pin_resource.created_by', userId)
      .andWhere('pin_resource.type', type);
  }

  /** The column set every branch selects, so the branches can be UNION ALLed. */
  protected pinColumns(columns: {
    name: string;
    icon?: string;
    parentBaseId?: string;
    meta?: Knex.Raw;
  }) {
    return [
      'pin_resource.resource_id as id',
      'pin_resource.type as type',
      'pin_resource.order as order',
      `${columns.name} as name`,
      columns.icon ? `${columns.icon} as icon` : this.knex.raw('NULL::text as icon'),
      columns.parentBaseId
        ? `${columns.parentBaseId} as parentBaseId`
        : this.knex.raw('NULL::text as "parentBaseId"'),
      columns.meta ? columns.meta.wrap('', ' as meta') : this.knex.raw('NULL::jsonb as meta'),
    ];
  }

  /** Type-specific fields of a list item; editions extend it for the types they add. */
  protected pinItemMeta(type: PinType, meta: IPinRow['meta']): Partial<IGetPinListVo[number]> {
    if (type !== PinType.View || !meta) return {};
    const {
      tableId,
      type: viewType,
      options,
    } = meta as {
      tableId: string;
      type: ViewType;
      options: string | null;
    };
    const pluginLogo = options ? JSON.parse(options)?.pluginLogo : undefined;
    return {
      viewMeta: {
        tableId,
        type: viewType,
        pluginLogo: pluginLogo ? getPublicFullStorageUrl(pluginLogo) : undefined,
      },
    };
  }

  private async getMaxOrder(where: Prisma.PinResourceWhereInput) {
    const aggregate = await this.prismaService.pinResource.aggregate({
      where,
      _max: { order: true },
    });
    return aggregate._max.order || 0;
  }

  async addPin(query: AddPinRo) {
    const { type, id } = query;
    const maxOrder = await this.getMaxOrder({
      createdBy: this.cls.get('user.id'),
    });
    return this.prismaService.pinResource
      .create({
        data: {
          type,
          resourceId: id,
          createdBy: this.cls.get('user.id'),
          order: maxOrder + 1,
        },
      })
      .catch(() => {
        throw new CustomHttpException('Pin already exists', HttpErrorCode.VALIDATION_ERROR, {
          localization: {
            i18nKey: 'httpErrors.pin.alreadyExists',
          },
        });
      });
  }

  async deletePin(query: DeletePinRo) {
    const { id, type } = query;
    return this.prismaService.pinResource
      .delete({
        where: {
          // eslint-disable-next-line @typescript-eslint/naming-convention
          createdBy_resourceId: {
            resourceId: id,
            createdBy: this.cls.get('user.id'),
          },
          type,
        },
      })
      .catch(() => {
        throw new CustomHttpException('Pin not found', HttpErrorCode.NOT_FOUND, {
          localization: {
            i18nKey: 'httpErrors.pin.notFound',
          },
        });
      });
  }

  async getList(query?: IGetPinListRo): Promise<IGetPinListVo> {
    const userId = this.cls.get('user.id');
    // No filter means the sidebar: the navigable resource types. Anything else (chat pins) is
    // only listed when asked for by type.
    const requested =
      query?.type == null ? SIDEBAR_PIN_TYPES : ([] as PinType[]).concat(query.type);
    const types = [...new Set(requested)].filter((type) => this.pinSources[type]);
    if (!userId || types.length === 0) return [];

    const branches = await Promise.all(
      types.map((type) => this.pinSources[type]!(this.pinsOf(userId, type)))
    );
    const [first, ...rest] = branches.map((branch) => branch.query);
    const statement = (rest.length ? first.unionAll(rest, true) : first)
      .orderBy('order', 'asc')
      .toQuery();
    const rows = await this.prismaService.$queryRawUnsafe<IPinRow[]>(statement);

    return rows.map((row) => {
      const type = row.type as PinType;
      return {
        id: row.id,
        type,
        order: row.order,
        name: row.name,
        icon: row.icon ?? undefined,
        parentBaseId: row.parentBaseId ?? undefined,
        ...this.pinItemMeta(type, row.meta),
      };
    });
  }

  /**
   * Entry URL per pinned base (its last visited table/view, keyed by baseId)
   * and pinned table (its last visited view, keyed by tableId), resolved
   * purely from the user's own visit history — independent of getList so the
   * pin list itself is never coupled to entry resolution.
   */
  async getEntryMap(): Promise<IPinEntryMapVo> {
    const userId = this.cls.get('user.id');
    const pins = await this.prismaService.pinResource.findMany({
      where: {
        createdBy: userId,
        type: { in: [PinType.Base, PinType.Table] },
      },
      select: { resourceId: true, type: true },
    });
    const baseIds = pins.filter((pin) => pin.type === PinType.Base).map((pin) => pin.resourceId);
    const tableIds = pins.filter((pin) => pin.type === PinType.Table).map((pin) => pin.resourceId);
    const tables = tableIds.length
      ? await this.prismaService.tableMeta.findMany({
          where: { id: { in: tableIds }, deletedTime: null },
          select: { id: true, baseId: true },
        })
      : [];
    const [baseEntryMap, tableEntryMap] = await Promise.all([
      this.lastVisitService.getBaseEntryMap(userId, baseIds),
      this.lastVisitService.getTableEntryUrls(
        userId,
        tables.map((table) => ({ tableId: table.id, baseId: table.baseId }))
      ),
    ]);
    return { ...baseEntryMap, ...tableEntryMap };
  }

  async updateOrder(data: UpdatePinOrderRo) {
    const { id, type, position, anchorId, anchorType } = data;

    const item = await this.prismaService.pinResource
      .findFirstOrThrow({
        select: { order: true, id: true },
        where: {
          resourceId: id,
          type,
          createdBy: this.cls.get('user.id'),
        },
      })
      .catch(() => {
        throw new CustomHttpException('Pin not found', HttpErrorCode.NOT_FOUND, {
          localization: {
            i18nKey: 'httpErrors.pin.notFound',
          },
        });
      });

    const anchorItem = await this.prismaService.pinResource
      .findFirstOrThrow({
        select: { order: true, id: true },
        where: {
          resourceId: anchorId,
          type: anchorType,
          createdBy: this.cls.get('user.id'),
        },
      })
      .catch(() => {
        throw new CustomHttpException('Pin Anchor not found', HttpErrorCode.NOT_FOUND, {
          localization: {
            i18nKey: 'httpErrors.pin.anchorNotFound',
          },
        });
      });

    await updateOrder({
      query: undefined,
      position,
      item,
      anchorItem,
      getNextItem: async (whereOrder, align) => {
        // Pins are ordered per user; a neighbour is only ever one of the caller's own rows.
        return this.prismaService.pinResource.findFirst({
          select: { order: true, id: true },
          where: {
            type: type,
            order: whereOrder,
            createdBy: this.cls.get('user.id'),
          },
          orderBy: { order: align },
        });
      },
      update: async (_, id, data) => {
        await this.prismaService.pinResource.update({
          data: { order: data.newOrder },
          where: { id },
        });
      },
      shuffle: async () => {
        const orderKey = position === 'before' ? 'lt' : 'gt';
        const dataOrderKey = position === 'before' ? 'decrement' : 'increment';
        await this.prismaService.pinResource.updateMany({
          data: { order: { [dataOrderKey]: 1 } },
          where: {
            createdBy: this.cls.get('user.id'),
            order: {
              [orderKey]: anchorItem.order,
            },
          },
        });
      },
    });
  }

  async deletePinWithoutException(query: DeletePinRo) {
    const { id, type } = query;
    const existingPin = await this.prismaService.pinResource.findFirst({
      where: {
        resourceId: id,
        type,
      },
    });
    if (!existingPin) {
      return;
    }
    return this.prismaService.pinResource.deleteMany({
      where: {
        // eslint-disable-next-line @typescript-eslint/naming-convention
        resourceId: id,
        type,
      },
    });
  }

  @OnEvent(Events.TABLE_VIEW_DELETE, { async: true })
  @OnEvent(Events.TABLE_DELETE, { async: true })
  @OnEvent(Events.BASE_DELETE, { async: true })
  @OnEvent(Events.SPACE_DELETE, { async: true })
  @OnEvent(Events.DASHBOARD_DELETE, { async: true })
  @OnEvent(Events.WORKFLOW_DELETE, { async: true })
  @OnEvent(Events.APP_DELETE, { async: true })
  @OnEvent(Events.ROUTINE_DELETE, { async: true })
  protected async resourceDeleteListener(
    listenerEvent:
      | ViewDeleteEvent
      | TableDeleteEvent
      | BaseDeleteEvent
      | SpaceDeleteEvent
      | DashboardDeleteEvent
      | WorkflowDeleteEvent
      | AppDeleteEvent
      | RoutineDeleteEvent
  ) {
    switch (listenerEvent.name) {
      case Events.TABLE_VIEW_DELETE:
        await this.deletePinWithoutException({
          id: listenerEvent.payload.viewId,
          type: PinType.View,
        });
        break;
      case Events.TABLE_DELETE:
        await this.deletePinWithoutException({
          id: listenerEvent.payload.tableId,
          type: PinType.Table,
        });
        break;
      case Events.BASE_DELETE:
        await this.deletePinWithoutException({
          id: listenerEvent.payload.baseId,
          type: PinType.Base,
        });
        break;
      case Events.SPACE_DELETE:
        await this.deletePinWithoutException({
          id: listenerEvent.payload.spaceId,
          type: PinType.Space,
        });
        break;
      case Events.DASHBOARD_DELETE:
        await this.deletePinWithoutException({
          id: listenerEvent.payload.dashboardId,
          type: PinType.Dashboard,
        });
        break;
      case Events.WORKFLOW_DELETE:
        await this.deletePinWithoutException({
          id: listenerEvent.payload.workflowId,
          type: PinType.Workflow,
        });
        break;
      case Events.APP_DELETE:
        await this.deletePinWithoutException({
          id: listenerEvent.payload.appId,
          type: PinType.App,
        });
        break;
      case Events.ROUTINE_DELETE:
        await this.deletePinWithoutException({
          id: listenerEvent.payload.routineId,
          type: PinType.Routine,
        });
        break;
    }
  }
}
