import { BadRequestException, Injectable, InternalServerErrorException } from '@nestjs/common';
import type {
  ISetViewFilterOpContext,
  ISetViewSortOpContext,
  ISetViewNameOpContext,
  ISetViewOptionsOpContext,
  ISnapshotBase,
  IViewRo,
  IViewVo,
  ISetViewDescriptionOpContext,
  ISort,
  ISetViewShareMetaOpContext,
  IOtOperation,
  ISetViewShareIdOpContext,
  ISetViewEnableShareOpContext,
} from '@teable-group/core';
import { getUniqName, IdPrefix, generateViewId, OpName, ViewOpBuilder } from '@teable-group/core';
import type { Prisma } from '@teable-group/db-main-prisma';
import { PrismaService } from '@teable-group/db-main-prisma';
import { Knex } from 'knex';
import { maxBy } from 'lodash';
import { InjectModel } from 'nest-knexjs';
import { ClsService } from 'nestjs-cls';
import type { IAdapterService } from '../../share-db/interface';
import { RawOpType } from '../../share-db/interface';
import type { IClsStore } from '../../types/cls';
import { BatchService } from '../calculation/batch.service';
import { ROW_ORDER_FIELD_PREFIX } from './constant';
import { createViewInstanceByRaw, createViewVoByRaw } from './model/factory';

type IViewOpContext =
  | ISetViewNameOpContext
  | ISetViewDescriptionOpContext
  | ISetViewFilterOpContext
  | ISetViewOptionsOpContext
  | ISetViewSortOpContext
  | ISetViewShareMetaOpContext
  | ISetViewEnableShareOpContext
  | ISetViewShareIdOpContext;

@Injectable()
export class ViewService implements IAdapterService {
  constructor(
    private readonly cls: ClsService<IClsStore>,
    private readonly batchService: BatchService,
    private readonly prismaService: PrismaService,
    @InjectModel('CUSTOM_KNEX') private readonly knex: Knex
  ) {}

  getRowIndexFieldName(viewId: string) {
    return `${ROW_ORDER_FIELD_PREFIX}_${viewId}`;
  }

  getRowIndexFieldIndexName(viewId: string) {
    return `idx_${ROW_ORDER_FIELD_PREFIX}_${viewId}`;
  }

  private async polishOrderAndName(tableId: string, viewRo: IViewRo) {
    const viewRaws = await this.prismaService.txClient().view.findMany({
      where: { tableId, deletedTime: null },
      select: { name: true, order: true },
    });

    let { name, order } = viewRo;

    const names = viewRaws.map((view) => view.name);
    name = getUniqName(name ?? 'New view', names);

    if (order == null) {
      const maxOrder = maxBy(viewRaws)?.order;
      order = maxOrder == null ? 0 : maxOrder + 1;
    }
    return { name, order };
  }

  async createDbView(tableId: string, viewRo: IViewRo) {
    const userId = this.cls.get('user.id');
    const { description, type, options, sort, filter, group } = viewRo;

    const { name, order } = await this.polishOrderAndName(tableId, viewRo);

    const viewId = generateViewId();
    const prisma = this.prismaService.txClient();

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
        [rowIndexFieldName]: this.knex.ref('__auto_number'),
      })
      .toQuery();
    await prisma.$executeRawUnsafe(updateRowIndexSql);

    // 4. create index
    const createRowIndexSQL = this.knex.schema
      .alterTable(dbTableName, (table) => {
        table.index(rowIndexFieldName, this.getRowIndexFieldIndexName(viewId));
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

  async createView(tableId: string, viewRo: IViewRo): Promise<IViewVo> {
    const viewRaw = await this.createDbView(tableId, viewRo);

    await this.batchService.saveRawOps(tableId, RawOpType.Create, IdPrefix.View, [
      { docId: viewRaw.id, version: 0, data: viewRaw },
    ]);

    return createViewVoByRaw(viewRaw);
  }

  async deleteView(tableId: string, viewId: string) {
    const { version } = await this.prismaService
      .txClient()
      .view.findFirstOrThrow({
        where: { id: viewId, tableId, deletedTime: null },
      })
      .catch(() => {
        throw new BadRequestException('Table not found');
      });

    await this.del(version + 1, tableId, viewId);

    await this.batchService.saveRawOps(tableId, RawOpType.Del, IdPrefix.View, [
      { docId: viewId, version },
    ]);
  }

  async updateViewSort(tableId: string, viewId: string, sort: ISort) {
    const viewRaw = await this.prismaService
      .txClient()
      .view.findFirstOrThrow({
        where: { id: viewId, tableId, deletedTime: null },
        select: {
          sort: true,
          version: true,
        },
      })
      .catch(() => {
        throw new BadRequestException('View not found');
      });

    const updateInput: Prisma.ViewUpdateInput = {
      sort: JSON.stringify(sort),
      lastModifiedBy: this.cls.get('user.id'),
      lastModifiedTime: new Date(),
    };

    const ops = [
      ViewOpBuilder.editor.setViewSort.build({
        newSort: sort,
        oldSort: viewRaw?.sort ? JSON.parse(viewRaw.sort) : null,
      }),
    ];

    const viewRawAfter = await this.prismaService.txClient().view.update({
      where: { id: viewId },
      data: { version: viewRaw.version + 1, ...updateInput },
    });

    await this.batchService.saveRawOps(tableId, RawOpType.Edit, IdPrefix.View, [
      {
        docId: viewId,
        version: viewRaw.version,
        data: ops,
      },
    ]);

    return viewRawAfter;
  }

  async updateViewByOps(tableId: string, viewId: string, ops: IOtOperation[]) {
    const { version } = await this.prismaService.txClient().view.findFirstOrThrow({
      where: { id: viewId, tableId, deletedTime: null },
      select: {
        version: true,
      },
    });
    const opContext = ops.map((op) => {
      const ctx = ViewOpBuilder.detect(op);
      if (!ctx) {
        throw new Error('unknown field editing op');
      }
      return ctx as IViewOpContext;
    });
    await this.update(version + 1, tableId, viewId, opContext);
    await this.batchService.saveRawOps(tableId, RawOpType.Edit, IdPrefix.View, [
      {
        docId: viewId,
        version,
        data: ops,
      },
    ]);
  }

  async create(tableId: string, view: IViewVo) {
    await this.createDbView(tableId, view);
  }

  async del(_version: number, _tableId: string, viewId: string) {
    const rowIndexFieldIndexName = this.getRowIndexFieldIndexName(viewId);

    await this.prismaService.txClient().view.delete({
      where: { id: viewId },
    });

    await this.prismaService.txClient().$executeRawUnsafe(`
      DROP INDEX IF EXISTS "${rowIndexFieldIndexName}";
    `);
  }

  async update(version: number, _tableId: string, viewId: string, opContexts: IViewOpContext[]) {
    const userId = this.cls.get('user.id');

    for (const opContext of opContexts) {
      const updateData: Prisma.ViewUpdateInput = { version };
      switch (opContext.name) {
        case OpName.SetViewName:
          updateData['name'] = opContext.newName;
          break;
        case OpName.SetViewDescription:
          updateData['description'] = opContext.newDescription;
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
        case OpName.SetViewShareMeta:
          updateData['shareMeta'] = JSON.stringify(opContext.newShareMeta) ?? null;
          break;
        case OpName.SetViewEnableShare:
          updateData['enableShare'] = opContext.newEnableShare;
          break;
        case OpName.SetViewShareId:
          updateData['shareId'] = opContext.newShareId;
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
          data: createViewVoByRaw(view),
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
