import { BadRequestException, Injectable } from '@nestjs/common';
import type {
  ISnapshotBase,
  IViewRo,
  IViewVo,
  ISort,
  IOtOperation,
  IUpdateViewColumnMetaOpContext,
  ISetViewPropertyOpContext,
  IColumnMeta,
  IViewPropertyKeys,
  IFormViewOptions,
  IGroup,
  IViewOptions,
  IFilter,
  IKanbanViewOptions,
  IFilterSet,
  IPluginViewOptions,
  IGalleryViewOptions,
  ICalendarViewOptions,
} from '@teable/core';
import {
  getUniqName,
  IdPrefix,
  generateViewId,
  OpName,
  ViewOpBuilder,
  viewVoSchema,
  ViewType,
  FieldType,
  CellValueType,
} from '@teable/core';
import type { Prisma } from '@teable/db-main-prisma';
import { PrismaService } from '@teable/db-main-prisma';
import { UploadType } from '@teable/openapi';
import { Knex } from 'knex';
import { isEmpty, merge } from 'lodash';
import { InjectModel } from 'nest-knexjs';
import { ClsService } from 'nestjs-cls';
import { fromZodError } from 'zod-validation-error';
import { InjectDbProvider } from '../../db-provider/db.provider';
import { IDbProvider } from '../../db-provider/db.provider.interface';
import type { IReadonlyAdapterService } from '../../share-db/interface';
import { RawOpType } from '../../share-db/interface';
import type { IClsStore } from '../../types/cls';
import StorageAdapter from '../attachments/plugins/adapter';
import { getFullStorageUrl } from '../attachments/plugins/utils';
import { BatchService } from '../calculation/batch.service';
import { ROW_ORDER_FIELD_PREFIX } from './constant';
import { createViewInstanceByRaw, createViewVoByRaw } from './model/factory';

type IViewOpContext = IUpdateViewColumnMetaOpContext | ISetViewPropertyOpContext;

@Injectable()
export class ViewService implements IReadonlyAdapterService {
  constructor(
    private readonly cls: ClsService<IClsStore>,
    private readonly batchService: BatchService,
    private readonly prismaService: PrismaService,
    @InjectModel('CUSTOM_KNEX') private readonly knex: Knex,
    @InjectDbProvider() private readonly dbProvider: IDbProvider
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
      orderBy: { order: 'asc' },
    });

    let { name } = viewRo;

    const names = viewRaws.map((view) => view.name);
    name = getUniqName(name ?? 'New view', names);

    const maxOrder = viewRaws[viewRaws.length - 1]?.order;
    const order = maxOrder == null ? 0 : maxOrder + 1;

    return { name, order };
  }

  async existIndex(dbTableName: string, viewId: string) {
    const columnName = this.getRowIndexFieldName(viewId);
    const exists = await this.dbProvider.checkColumnExist(
      dbTableName,
      columnName,
      this.prismaService.txClient()
    );

    if (exists) {
      return columnName;
    }
  }

  async createViewIndexField(dbTableName: string, viewId: string) {
    const prisma = this.prismaService.txClient();

    const rowIndexFieldName = this.getRowIndexFieldName(viewId);

    // add a field for maintain row order number
    const addRowIndexColumnSql = this.knex.schema
      .alterTable(dbTableName, (table) => {
        table.double(rowIndexFieldName);
      })
      .toQuery();
    await prisma.$executeRawUnsafe(addRowIndexColumnSql);

    // fill initial order for every record, with auto increment integer
    const updateRowIndexSql = this.knex(dbTableName)
      .update({
        [rowIndexFieldName]: this.knex.ref('__auto_number'),
      })
      .toQuery();
    await prisma.$executeRawUnsafe(updateRowIndexSql);

    // create index
    const createRowIndexSQL = this.knex.schema
      .alterTable(dbTableName, (table) => {
        table.index(rowIndexFieldName, this.getRowIndexFieldIndexName(viewId));
      })
      .toQuery();
    await prisma.$executeRawUnsafe(createRowIndexSQL);
    return rowIndexFieldName;
  }

  async getOrCreateViewIndexField(dbTableName: string, viewId: string) {
    const indexFieldName = await this.existIndex(dbTableName, viewId);
    if (indexFieldName) {
      return indexFieldName;
    }
    return this.createViewIndexField(dbTableName, viewId);
  }

  private async viewDataCompensation(tableId: string, viewRo: IViewRo) {
    // create view compensation data
    const innerViewRo = { ...viewRo };
    // primary field set visible default
    if ([ViewType.Kanban, ViewType.Gallery, ViewType.Calendar].includes(viewRo.type)) {
      const primaryField = await this.prismaService.txClient().field.findFirstOrThrow({
        where: { tableId, isPrimary: true, deletedTime: null },
        select: { id: true },
      });
      const columnMeta = innerViewRo.columnMeta ?? {};
      const primaryFieldColumnMeta = columnMeta[primaryField.id] ?? {};
      innerViewRo.columnMeta = {
        ...columnMeta,
        [primaryField.id]: { ...primaryFieldColumnMeta, visible: true },
      };

      // set default cover field id for gallery view
      if (innerViewRo.type === ViewType.Gallery) {
        const fields = await this.prismaService.txClient().field.findMany({
          where: { tableId, deletedTime: null },
          select: { id: true, type: true },
        });
        const galleryOptions = (innerViewRo.options ?? {}) as IGalleryViewOptions;
        const coverFieldId =
          galleryOptions.coverFieldId ??
          fields.find((field) => field.type === FieldType.Attachment)?.id;
        innerViewRo.options = {
          ...galleryOptions,
          coverFieldId,
        };
      }

      // set default start date and end date field ids for calendar view
      if (innerViewRo.type === ViewType.Calendar) {
        const fields = await this.prismaService.txClient().field.findMany({
          where: { tableId, deletedTime: null },
          select: { id: true, cellValueType: true, isMultipleCellValue: true },
        });
        const calendarOptions = (innerViewRo.options ?? {}) as ICalendarViewOptions;

        const dateFieldIds = fields
          .filter(
            ({ cellValueType, isMultipleCellValue }) =>
              cellValueType === CellValueType.DateTime && !isMultipleCellValue
          )
          .map(({ id }) => id);

        if (!dateFieldIds.length) return innerViewRo;

        const startDateFieldId = calendarOptions.startDateFieldId ?? dateFieldIds[0];
        const endDateFieldId = calendarOptions.endDateFieldId ?? dateFieldIds[1] ?? dateFieldIds[0];

        innerViewRo.options = {
          ...calendarOptions,
          startDateFieldId,
          endDateFieldId,
        };
      }
    }
    return innerViewRo;
  }

  async restoreView(tableId: string, viewId: string) {
    await this.prismaService.$tx(async () => {
      await this.prismaService.view.update({
        where: { id: viewId },
        data: {
          deletedTime: null,
        },
      });
      const ops = ViewOpBuilder.editor.setViewProperty.build({
        key: 'lastModifiedTime',
        newValue: new Date().toISOString(),
      });
      await this.updateViewByOps(tableId, viewId, [ops]);
    });
  }

  async createDbView(tableId: string, viewRo: IViewRo) {
    const userId = this.cls.get('user.id');
    const createViewRo = await this.viewDataCompensation(tableId, viewRo);

    const { description, type, options, sort, filter, group, columnMeta } = createViewRo;

    const { name, order } = await this.polishOrderAndName(tableId, createViewRo);

    const viewId = generateViewId();
    const prisma = this.prismaService.txClient();

    const orderColumnMeta = await this.generateViewOrderColumnMeta(tableId);

    const mergedColumnMeta = merge(orderColumnMeta, columnMeta);

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
      columnMeta: mergedColumnMeta ? JSON.stringify(mergedColumnMeta) : JSON.stringify({}),
    };

    return await prisma.view.create({ data });
  }

  async getViewById(viewId: string): Promise<IViewVo> {
    const viewRaw = await this.prismaService.txClient().view.findUniqueOrThrow({
      where: { id: viewId, deletedTime: null },
    });

    return this.convertViewVoAttachmentUrl(createViewInstanceByRaw(viewRaw) as IViewVo);
  }

  convertViewVoAttachmentUrl(viewVo: IViewVo) {
    if (viewVo.type === ViewType.Form) {
      const formOptions = viewVo.options as IFormViewOptions;
      formOptions?.coverUrl &&
        (formOptions.coverUrl = formOptions.coverUrl
          ? getFullStorageUrl(StorageAdapter.getBucket(UploadType.Form), formOptions.coverUrl)
          : undefined);
      formOptions?.logoUrl &&
        (formOptions.logoUrl = formOptions.logoUrl
          ? getFullStorageUrl(StorageAdapter.getBucket(UploadType.Form), formOptions.logoUrl)
          : undefined);
    }
    if (viewVo.type === ViewType.Plugin) {
      const pluginOptions = viewVo.options as IPluginViewOptions;
      pluginOptions.pluginLogo = getFullStorageUrl(
        StorageAdapter.getBucket(UploadType.Plugin),
        pluginOptions.pluginLogo
      );
    }
    return viewVo;
  }

  async getViews(tableId: string): Promise<IViewVo[]> {
    const viewRaws = await this.prismaService.txClient().view.findMany({
      where: { tableId, deletedTime: null },
      orderBy: { order: 'asc' },
    });

    return viewRaws.map((viewRaw) => this.convertViewVoAttachmentUrl(createViewVoByRaw(viewRaw)));
  }

  async createView(tableId: string, viewRo: IViewRo): Promise<IViewVo> {
    const viewRaw = await this.createDbView(tableId, viewRo);

    await this.batchService.saveRawOps(tableId, RawOpType.Create, IdPrefix.View, [
      { docId: viewRaw.id, version: 0, data: viewRaw },
    ]);

    return this.convertViewVoAttachmentUrl(createViewVoByRaw(viewRaw));
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
      ViewOpBuilder.editor.setViewProperty.build({
        key: 'sort',
        newValue: sort,
        oldValue: viewRaw?.sort ? JSON.parse(viewRaw.sort) : null,
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
    await this.prismaService.txClient().view.update({
      where: { id: viewId },
      data: {
        deletedTime: new Date(),
      },
    });
  }

  // get column order map for all views, order by fieldIds, key by viewId
  async getColumnsMetaMap(tableId: string, fieldIds: string[]): Promise<IColumnMeta[]> {
    const viewRaws = await this.prismaService.txClient().view.findMany({
      select: { id: true, columnMeta: true },
      where: { tableId, deletedTime: null },
    });

    const viewRawMap = viewRaws.reduce<{ [viewId: string]: IColumnMeta }>((pre, cur) => {
      pre[cur.id] = JSON.parse(cur.columnMeta);
      return pre;
    }, {});

    return fieldIds.map((fieldId) => {
      return viewRaws.reduce<IColumnMeta>((pre, view) => {
        pre[view.id] = viewRawMap[view.id][fieldId];
        return pre;
      }, {});
    });
  }

  async getUpdatedColumnMeta(
    tableId: string,
    viewId: string,
    opContexts: IUpdateViewColumnMetaOpContext
  ) {
    const { fieldId, newColumnMeta } = opContexts;
    const { columnMeta: rawColumnMeta } = await this.prismaService
      .txClient()
      .view.findUniqueOrThrow({
        select: { columnMeta: true },
        where: { tableId, id: viewId, deletedTime: null },
      });
    const columnMeta = JSON.parse(rawColumnMeta);

    // delete column meta
    if (!newColumnMeta) {
      const preData = {
        ...columnMeta,
      };
      delete preData[fieldId];
      return (
        JSON.stringify({
          ...preData,
        }) ?? {}
      );
    }

    return (
      JSON.stringify({
        ...columnMeta,
        [fieldId]: newColumnMeta,
      }) ?? {}
    );
  }

  async update(version: number, tableId: string, viewId: string, opContexts: IViewOpContext[]) {
    const userId = this.cls.get('user.id');

    for (const opContext of opContexts) {
      const updateData: Prisma.ViewUpdateInput = { version, lastModifiedBy: userId };
      if (opContext.name === OpName.UpdateViewColumnMeta) {
        const columnMeta = await this.getUpdatedColumnMeta(tableId, viewId, opContext);
        await this.prismaService.txClient().view.update({
          where: { id: viewId },
          data: {
            ...updateData,
            columnMeta,
          },
        });
        continue;
      }
      const { key, newValue } = opContext;
      const result = viewVoSchema.partial().safeParse({ [key]: newValue });
      if (!result.success) {
        throw new BadRequestException(fromZodError(result.error).message);
      }
      const parsedValue = result.data[key] as IViewPropertyKeys;
      await this.prismaService.txClient().view.update({
        where: { id: viewId },
        data: {
          ...updateData,
          [key]:
            parsedValue == null
              ? null
              : typeof parsedValue === 'object'
                ? JSON.stringify(parsedValue)
                : parsedValue,
        },
      });
    }
  }

  async getSnapshotBulk(tableId: string, ids: string[]): Promise<ISnapshotBase<IViewVo>[]> {
    const views = await this.prismaService.txClient().view.findMany({
      where: { tableId, id: { in: ids }, deletedTime: null },
    });

    if (views.length !== ids.length) {
      const notFoundIds = ids.filter((id) => !views.some((view) => view.id === id));
      throw new BadRequestException(`View not found: ${notFoundIds.join(', ')}`);
    }

    return views
      .map((view) => {
        return {
          id: view.id,
          v: view.version,
          type: 'json0',
          data: this.convertViewVoAttachmentUrl(createViewVoByRaw(view)),
        };
      })
      .sort((a, b) => ids.indexOf(a.id) - ids.indexOf(b.id));
  }

  async getDocIdsByQuery(tableId: string, query?: { includeIds: string[] }) {
    const views = await this.prismaService.txClient().view.findMany({
      where: { tableId, deletedTime: null, id: { in: query?.includeIds } },
      select: { id: true },
      orderBy: { order: 'asc' },
    });

    return { ids: views.map((v) => v.id) };
  }

  async generateViewOrderColumnMeta(tableId: string) {
    const fields = await this.prismaService.txClient().field.findMany({
      select: { id: true },
      where: { tableId, deletedTime: null },
      orderBy: [
        { isPrimary: { sort: 'asc', nulls: 'last' } },
        { order: 'asc' },
        { createdTime: 'asc' },
      ],
    });

    if (isEmpty(fields)) {
      return;
    }

    return fields.reduce<IColumnMeta>((pre, cur, index) => {
      pre[cur.id] = { order: index };
      return pre;
    }, {});
  }

  async initViewColumnMeta(tableId: string, fieldIds: string[], columnsMeta?: IColumnMeta[]) {
    // 1. get all views id and column meta by tableId
    const view = await this.prismaService.txClient().view.findMany({
      where: { tableId, deletedTime: null },
      select: { columnMeta: true, id: true },
    });

    if (isEmpty(view)) {
      return;
    }

    for (let i = 0; i < view.length; i++) {
      const ops: IOtOperation[] = [];
      const viewId = view[i].id;
      const curColumnMeta: IColumnMeta = JSON.parse(view[i].columnMeta);
      const maxOrder = isEmpty(curColumnMeta)
        ? -1
        : Math.max(...Object.values(curColumnMeta).map((meta) => meta.order));
      fieldIds.forEach((fieldId, i) => {
        const columnMeta = columnsMeta?.[i]?.[viewId];
        const op = ViewOpBuilder.editor.updateViewColumnMeta.build({
          fieldId: fieldId,
          newColumnMeta: columnMeta
            ? { ...columnMeta, order: columnMeta.order ?? maxOrder + 1 }
            : { order: maxOrder + 1 },
          oldColumnMeta: undefined,
        });
        ops.push(op);
      });

      // 2. build update ops and emit
      await this.updateViewByOps(tableId, viewId, ops);
    }
  }

  async deleteViewRelativeByFields(tableId: string, fieldIds: string[]) {
    // 1. get all views id and column meta by tableId
    const view = await this.prismaService.txClient().view.findMany({
      select: {
        columnMeta: true,
        group: true,
        options: true,
        sort: true,
        filter: true,
        id: true,
        type: true,
      },
      where: { tableId, deletedTime: null },
    });

    if (!view) {
      throw new Error(`no view in this table`);
    }

    for (let i = 0; i < view.length; i++) {
      const ops: IOtOperation[] = [];
      const viewId = view[i].id;
      const viewType = view[i].type;

      const curColumnMeta: IColumnMeta = JSON.parse(view[i].columnMeta);
      const curSort: ISort = view[i].sort ? JSON.parse(view[i].sort!) : null;
      const curGroup: IGroup = view[i].group ? JSON.parse(view[i].group!) : null;
      const curOptions: IViewOptions = view[i].options ? JSON.parse(view[i].options!) : null;
      const curFilter: IFilter = view[i].filter ? JSON.parse(view[i].filter!) : null;

      fieldIds.forEach((fieldId) => {
        const columnOps = this.getDeleteColumnMetaByFieldIdOps(curColumnMeta, fieldId);
        ops.push(columnOps);

        // filter
        if (view[i].filter && view[i].filter?.includes(fieldId) && curFilter) {
          const filterOps = this.getDeleteFilterByFieldIdOps(curFilter, fieldId);
          ops.push(filterOps);
        }

        // sort
        if (curSort && Array.isArray(curSort.sortObjs)) {
          const sortOps = this.getDeleteSortByFieldIdOps(curSort, fieldId);
          ops.push(sortOps);
        }

        // group
        if (curGroup && Array.isArray(curGroup)) {
          const groupOps = this.getDeleteGroupByFieldIdOps(curGroup, fieldId);
          ops.push(groupOps);
        }

        // options for kanban view stackFieldId
        if (viewType === ViewType.Kanban && curOptions) {
          const optionsOps = this.getDeleteOptionByFieldIdOps(curOptions, fieldId);
          ops.push(optionsOps);
        }
      });

      // 2. build update ops and emit
      await this.updateViewByOps(tableId, viewId, ops);
    }
  }

  getDeleteFilterByFieldIdOps(filter: IFilterSet, fieldId: string) {
    const newFilter = this.getDeletedFilterByFieldId(filter, fieldId);
    return ViewOpBuilder.editor.setViewProperty.build({
      key: 'filter',
      newValue: newFilter,
      oldValue: filter,
    });
  }
  getDeletedFilterByFieldId(filter: IFilterSet, fieldId: string) {
    const removeItemsByFieldId = (filter: IFilterSet, fieldId: string) => {
      if (Array.isArray(filter.filterSet)) {
        filter.filterSet = filter.filterSet.filter((item) => {
          if ('fieldId' in item && item.fieldId === fieldId) {
            return false;
          }
          if ('filterSet' in item && item.filterSet) {
            removeItemsByFieldId(item, fieldId);
            return item.filterSet.length > 0;
          }
          return true;
        });
      }
      return filter;
    };
    const newFilter = removeItemsByFieldId({ ...filter }, fieldId) as IFilter;
    return newFilter?.filterSet?.length ? newFilter : null;
  }
  private getDeleteSortByFieldIdOps(sort: NonNullable<ISort>, fieldId: string) {
    const newSort: ISort = {
      sortObjs: sort.sortObjs.filter((sortItem) => sortItem.fieldId !== fieldId),
      manualSort: !!sort.manualSort,
    };
    return ViewOpBuilder.editor.setViewProperty.build({
      key: 'sort',
      newValue: newSort?.sortObjs.length ? newSort : null,
      oldValue: sort,
    });
  }
  private getDeleteGroupByFieldIdOps(group: NonNullable<IGroup>, fieldId: string) {
    const newGroup: IGroup = group.filter((groupItem) => groupItem.fieldId !== fieldId);
    return ViewOpBuilder.editor.setViewProperty.build({
      key: 'group',
      newValue: newGroup?.length ? newGroup : null,
      oldValue: group,
    });
  }
  private getDeleteColumnMetaByFieldIdOps(columnMeta: NonNullable<IColumnMeta>, fieldId: string) {
    return ViewOpBuilder.editor.updateViewColumnMeta.build({
      fieldId: fieldId,
      newColumnMeta: null,
      oldColumnMeta: { ...columnMeta[fieldId] },
    });
  }
  private getDeleteOptionByFieldIdOps(options: IViewOptions, fieldId: string) {
    const newOptions = { ...options } as IKanbanViewOptions;
    if (newOptions.stackFieldId === fieldId) {
      delete newOptions.stackFieldId;
    }
    if (newOptions.coverFieldId === fieldId) {
      delete newOptions.coverFieldId;
    }
    return ViewOpBuilder.editor.setViewProperty.build({
      key: 'options',
      newValue: newOptions,
      oldValue: options,
    });
  }
}
