import { Injectable } from '@nestjs/common';
import type {
  ISetViewNameOpContext,
  ISnapshotBase,
  IViewRo,
  IViewVo,
  ViewType,
} from '@teable-group/core';
import { generateViewId, OpName } from '@teable-group/core';
import type { Prisma } from '@teable-group/db-main-prisma';
import { PrismaService } from '../../prisma.service';
import type { IAdapterService } from '../../share-db/interface';
import { ROW_ORDER_FIELD_PREFIX } from './constant';
import { createViewInstanceByRaw } from './model/factory';

@Injectable()
export class ViewService implements IAdapterService {
  constructor(private readonly prisma: PrismaService) {}

  getRowIndexFieldName(viewId: string) {
    return `${ROW_ORDER_FIELD_PREFIX}_${viewId}`;
  }

  getRowIndexFieldIndexName(viewId: string) {
    return `idx_${ROW_ORDER_FIELD_PREFIX}_${viewId}`;
  }

  async createViewTransaction(
    prisma: Prisma.TransactionClient,
    tableId: string,
    createViewRo: IViewRo & { id?: string; name: string }
  ) {
    const { id, name, description, type, options, sort, filter, group } = createViewRo;
    let order = createViewRo.order;
    const viewId = id || generateViewId();

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
      createdBy: 'admin',
      lastModifiedBy: 'admin',
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
    const rowIndexFieldIndexName = this.getRowIndexFieldIndexName(viewId);

    // 1. create a new view in view model
    const viewData = await prisma.view.create({
      data,
    });

    // 2. add a field for maintain row order number
    await prisma.$executeRawUnsafe(`
      ALTER TABLE ${dbTableName}
      ADD ${rowIndexFieldName} REAL;
    `);

    // 3. fill initial order for every record, with auto increment integer
    await prisma.$executeRawUnsafe(`
      UPDATE ${dbTableName} SET ${rowIndexFieldName} = __row_default;
    `);

    // 4. create index
    await prisma.$executeRawUnsafe(`
      CREATE UNIQUE INDEX ${rowIndexFieldIndexName} ON  ${dbTableName}(${rowIndexFieldName});
    `);

    // set strick not null and unique type for safety（sqlite cannot do that)
    // prisma.$executeRawUnsafe(`
    //   ALTER TABLE ${dbTableName}
    //   CONSTRAINT COLUMN ${rowIndexFieldName} NOT NULL UNIQUE;
    // `),

    return viewData;
  }

  async getViewById(viewId: string): Promise<IViewVo> {
    const viewRaw = await this.prisma.view.findUniqueOrThrow({
      where: { id: viewId },
    });

    return createViewInstanceByRaw(viewRaw) as IViewVo;
  }

  async getViews(tableId: string): Promise<IViewVo[]> {
    const viewRaws = await this.prisma.view.findMany({
      where: { tableId, deletedTime: null },
    });

    return viewRaws.map((viewRaw) => createViewInstanceByRaw(viewRaw) as IViewVo);
  }

  async create(prisma: Prisma.TransactionClient, tableId: string, view: IViewVo) {
    await this.createViewTransaction(prisma, tableId, view);
  }

  async del(prisma: Prisma.TransactionClient, _tableId: string, viewId: string) {
    const rowIndexFieldIndexName = this.getRowIndexFieldIndexName(viewId);

    await prisma.view.update({
      where: { id: viewId },
      data: { deletedTime: new Date() },
    });

    await prisma.$executeRawUnsafe(`
      DROP INDEX IF EXISTS ${rowIndexFieldIndexName};
    `);
  }

  async update(
    prisma: Prisma.TransactionClient,
    version: number,
    _tableId: string,
    viewId: string,
    opContexts: ISetViewNameOpContext[]
  ) {
    for (const opContext of opContexts) {
      if (opContext.name === OpName.SetViewName) {
        const { newName } = opContext;
        await prisma.view.update({
          where: { id: viewId },
          data: { name: newName, version },
        });
        return;
      }
      throw new Error(`Unknown context ${opContext.name} for view update`);
    }
  }

  async getSnapshotBulk(
    prisma: Prisma.TransactionClient,
    tableId: string,
    ids: string[]
  ): Promise<ISnapshotBase<IViewVo>[]> {
    const views = await prisma.view.findMany({
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

  async getDocIdsByQuery(prisma: Prisma.TransactionClient, tableId: string, _query: unknown) {
    const views = await prisma.view.findMany({
      where: { tableId, deletedTime: null },
      select: { id: true },
      orderBy: { order: 'asc' },
    });

    return { ids: views.map((v) => v.id) };
  }
}
