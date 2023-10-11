import { Injectable, InternalServerErrorException } from '@nestjs/common';
import type {
  ISetViewFilterOpContext,
  ISetViewSortOpContext,
  ISetViewNameOpContext,
  ISetViewOptionsOpContext,
  ISnapshotBase,
  IViewRo,
  IViewVo,
  ViewType,
} from '@teable-group/core';
import { generateViewId, OpName } from '@teable-group/core';
import type { Prisma } from '@teable-group/db-main-prisma';
import { PrismaService } from '@teable-group/db-main-prisma';
import { Knex } from 'knex';
import { InjectModel } from 'nest-knexjs';
import { ClsService } from 'nestjs-cls';
import type { IClsStore } from 'src/types/cls';
import type { IAdapterService } from '../../share-db/interface';
import { ROW_ORDER_FIELD_PREFIX } from './constant';
import { createViewInstanceByRaw } from './model/factory';

@Injectable()
export class ViewService implements IAdapterService {
  constructor(
    private readonly prismaService: PrismaService,
    private readonly cls: ClsService<IClsStore>,
    @InjectModel() private readonly knex: Knex
  ) {}

  getRowIndexFieldName(viewId: string) {
    return `${ROW_ORDER_FIELD_PREFIX}_${viewId}`;
  }

  getRowIndexFieldIndexName(viewId: string) {
    return `idx_${ROW_ORDER_FIELD_PREFIX}_${viewId}`;
  }

  async createViewTransaction(
    tableId: string,
    createViewRo: IViewRo & { id?: string; name: string }
  ) {
    const userId = this.cls.get('user.id');
    const { id, name, description, type, options, sort, filter, group } = createViewRo;
    let order = createViewRo.order;
    const viewId = id || generateViewId();
    const prisma = this.prismaService.txClient();

    if (!order) {
      const viewAggregate = await prisma.view.aggregate({
        where: { tableId, deletedTime: null },
        _max: { order: true },
      });
      order = (viewAggregate._max.order || 0) + 1;
    }

    const data: Prisma.ViewCreateInput = {
      id: viewId,
      table: {
        connect: {
          id: tableId,
        },
      },
      name,
      description,
      type,
      options: options ? JSON.stringify(options) : undefined,
      sort: sort ? JSON.stringify(sort) : undefined,
      filter: filter ? JSON.stringify(filter) : undefined,
      group: group ? JSON.stringify(group) : undefined,
      version: 1,
      order,
      createdBy: userId,
      lastModifiedBy: userId,
    };

    const { dbTableName } = await prisma.tableMeta.findUniqueOrThrow({
      where: {
        id: tableId,
      },
      select: {
        dbTableName: true,
      },
    });

    const rowIndexFieldName = this.getRowIndexFieldName(viewId);

    // 1. create a new view in view model
    const viewData = await prisma.view.create({ data });

    // 2. add a field for maintain row order number
    const addRowIndexColumnSql = this.knex.schema
      .alterTable(dbTableName, (table) => {
        table.double(rowIndexFieldName);
      })
      .toQuery();
    await prisma.$executeRawUnsafe(addRowIndexColumnSql);

    // 3. fill initial order for every record, with auto increment integer
    const updateRowIndexSql = this.knex(dbTableName)
      .update({
        [rowIndexFieldName]: this.knex.ref('__row_default'),
      })
      .toQuery();
    await prisma.$executeRawUnsafe(updateRowIndexSql);

    // 4. create index
    const createRowIndexSQL = this.knex.schema
      .alterTable(dbTableName, (table) => {
        table.unique(rowIndexFieldName, {
          indexName: this.getRowIndexFieldIndexName(viewId),
        });
      })
      .toQuery();
    await prisma.$executeRawUnsafe(createRowIndexSQL);
    return viewData;
  }

  async getViewById(viewId: string): Promise<IViewVo> {
    const viewRaw = await this.prismaService.txClient().view.findUniqueOrThrow({
      where: { id: viewId },
    });

    return createViewInstanceByRaw(viewRaw) as IViewVo;
  }

  async getViews(tableId: string): Promise<IViewVo[]> {
    const viewRaws = await this.prismaService.txClient().view.findMany({
      where: { tableId, deletedTime: null },
    });

    return viewRaws.map((viewRaw) => createViewInstanceByRaw(viewRaw) as IViewVo);
  }

  async create(tableId: string, view: IViewVo) {
    await this.createViewTransaction(tableId, view);
  }

  async del(_version: number, _tableId: string, viewId: string) {
    const userId = this.cls.get('user.id');

    const rowIndexFieldIndexName = this.getRowIndexFieldIndexName(viewId);

    await this.prismaService.txClient().view.update({
      where: { id: viewId },
      data: { deletedTime: new Date(), lastModifiedBy: userId },
    });

    await this.prismaService.txClient().$executeRawUnsafe(`
      DROP INDEX IF EXISTS "${rowIndexFieldIndexName}";
    `);
  }

  async update(
    version: number,
    _tableId: string,
    viewId: string,
    opContexts: (
      | ISetViewNameOpContext
      | ISetViewFilterOpContext
      | ISetViewOptionsOpContext
      | ISetViewSortOpContext
    )[]
  ) {
    const userId = this.cls.get('user.id');

    for (const opContext of opContexts) {
      const updateData: Prisma.ViewUpdateInput = { version };
      switch (opContext.name) {
        case OpName.SetViewName:
          updateData['name'] = opContext.newName;
          break;
        case OpName.SetViewFilter:
          updateData['filter'] = JSON.stringify(opContext.newFilter) ?? null;
          break;
        case OpName.SetViewSort:
          updateData['sort'] = JSON.stringify(opContext.newSort) ?? null;
          break;
        case OpName.SetViewOptions:
          updateData['options'] = JSON.stringify(opContext.newOptions) ?? null;
          break;
        default:
          throw new InternalServerErrorException(`Unknown context ${opContext} for view update`);
      }

      await this.prismaService.txClient().view.update({
        where: { id: viewId },
        data: {
          ...updateData,
          lastModifiedBy: userId,
        },
      });
    }
  }

  async getSnapshotBulk(tableId: string, ids: string[]): Promise<ISnapshotBase<IViewVo>[]> {
    const views = await this.prismaService.txClient().view.findMany({
      where: { tableId, id: { in: ids } },
    });

    return views
      .map((view) => {
        return {
          id: view.id,
          v: view.version,
          type: 'json0',
          data: {
            ...view,
            deletedTime: view.deletedTime?.toISOString() || undefined,
            type: view.type as ViewType,
            description: view.description || undefined,
            filter: JSON.parse(view.filter as string) || undefined,
            sort: JSON.parse(view.sort as string) || undefined,
            group: JSON.parse(view.group as string) || undefined,
            options: JSON.parse(view.options as string) || undefined,
          },
        };
      })
      .sort((a, b) => ids.indexOf(a.id) - ids.indexOf(b.id));
  }

  async getDocIdsByQuery(tableId: string, _query: unknown) {
    const views = await this.prismaService.txClient().view.findMany({
      where: { tableId, deletedTime: null },
      select: { id: true },
      orderBy: { order: 'asc' },
    });

    return { ids: views.map((v) => v.id) };
  }
}
