import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import type {
  IOtOperation,
  IViewRo,
  IViewVo,
  IColumnMetaRo,
  IViewPropertyKeys,
  IViewOptions,
  IGridColumnMeta,
  IFilter,
  IFilterItem,
  ILinkFieldOptions,
  IPluginViewOptions,
} from '@teable/core';
import {
  ViewType,
  IManualSortRo,
  ViewOpBuilder,
  generateShareId,
  VIEW_JSON_KEYS,
  validateOptionsType,
  FieldType,
  IdPrefix,
  generatePluginInstallId,
} from '@teable/core';
import { PrismaService } from '@teable/db-main-prisma';
import { PluginPosition, PluginStatus } from '@teable/openapi';
import type {
  IViewPluginUpdateStorageRo,
  IGetViewFilterLinkRecordsVo,
  IUpdateOrderRo,
  IUpdateRecordOrdersRo,
  IViewInstallPluginRo,
  IViewShareMetaRo,
} from '@teable/openapi';
import { Knex } from 'knex';
import { InjectModel } from 'nest-knexjs';
import { ClsService } from 'nestjs-cls';
import { InjectDbProvider } from '../../../db-provider/db.provider';
import { IDbProvider } from '../../../db-provider/db.provider.interface';
import { EventEmitterService } from '../../../event-emitter/event-emitter.service';
import { Events } from '../../../event-emitter/events';
import type { IClsStore } from '../../../types/cls';
import { Timing } from '../../../utils/timing';
import { updateMultipleOrders, updateOrder } from '../../../utils/update-order';
import { FieldViewSyncService } from '../../field/field-calculate/field-view-sync.service';
import { FieldService } from '../../field/field.service';
import type { IFieldInstance } from '../../field/model/factory';
import { createFieldInstanceByRaw, createFieldInstanceByVo } from '../../field/model/factory';
import { RecordService } from '../../record/record.service';
import { createViewInstanceByRaw } from '../model/factory';
import { ViewService } from '../view.service';

@Injectable()
export class ViewOpenApiService {
  private logger = new Logger(ViewOpenApiService.name);

  constructor(
    private readonly prismaService: PrismaService,
    private readonly recordService: RecordService,
    private readonly viewService: ViewService,
    private readonly fieldService: FieldService,
    private readonly fieldViewSyncService: FieldViewSyncService,
    private readonly eventEmitterService: EventEmitterService,
    private readonly cls: ClsService<IClsStore>,
    @InjectDbProvider() private readonly dbProvider: IDbProvider,
    @InjectModel('CUSTOM_KNEX') private readonly knex: Knex
  ) {}

  async createView(tableId: string, viewRo: IViewRo) {
    if (viewRo.type === ViewType.Plugin) {
      const res = await this.pluginInstall(tableId, {
        name: viewRo.name,
        pluginId: (viewRo.options as IPluginViewOptions).pluginId,
      });
      return this.viewService.getViewById(res.viewId);
    }
    return await this.prismaService.$tx(async () => {
      return this.createViewInner(tableId, viewRo);
    });
  }

  async deleteView(tableId: string, viewId: string) {
    return await this.prismaService.$tx(async () => {
      await this.fieldViewSyncService.deleteLinkOptionsDependenciesByViewId(tableId, viewId);
      return await this.deleteViewInner(tableId, viewId);
    });
  }

  private async createViewInner(tableId: string, viewRo: IViewRo): Promise<IViewVo> {
    return await this.viewService.createView(tableId, viewRo);
  }

  private async deleteViewInner(tableId: string, viewId: string) {
    return await this.viewService.deleteView(tableId, viewId);
  }

  private updateRecordOrderSql(orderRawSql: string, dbTableName: string, indexField: string) {
    return this.knex
      .raw(
        `
        UPDATE :dbTableName:
        SET :indexField: = temp_order.new_order
        FROM (
          SELECT __id, ROW_NUMBER() OVER (ORDER BY ${orderRawSql}) AS new_order FROM :dbTableName:
        ) AS temp_order
        WHERE :dbTableName:.__id = temp_order.__id AND :dbTableName:.:indexField: != temp_order.new_order;
      `,
        {
          dbTableName,
          indexField,
        }
      )
      .toQuery();
  }

  @Timing()
  async manualSort(tableId: string, viewId: string, viewOrderRo: IManualSortRo) {
    const { sortObjs } = viewOrderRo;
    const dbTableName = await this.recordService.getDbTableName(tableId);
    const fields = await this.fieldService.getFieldsByQuery(tableId, { viewId });
    const indexField = await this.viewService.getOrCreateViewIndexField(dbTableName, viewId);

    const queryBuilder = this.knex(dbTableName);

    const fieldInsMap = fields.reduce(
      (map, field) => {
        map[field.id] = createFieldInstanceByVo(field);
        return map;
      },
      {} as Record<string, IFieldInstance>
    );

    const orderRawSql = this.dbProvider
      .sortQuery(queryBuilder, fieldInsMap, sortObjs)
      .getRawSortSQLText();

    // build ops
    const newSort = {
      sortObjs: sortObjs,
      manualSort: true,
    };

    await this.prismaService.$tx(async (prisma) => {
      await prisma.$executeRawUnsafe(
        this.updateRecordOrderSql(orderRawSql, dbTableName, indexField)
      );
      await this.viewService.updateViewSort(tableId, viewId, newSort);
    });
  }

  async updateViewColumnMeta(
    tableId: string,
    viewId: string,
    columnMetaRo: IColumnMetaRo,
    windowId?: string
  ) {
    const view = await this.prismaService.view
      .findFirstOrThrow({
        where: { tableId, id: viewId },
        select: {
          columnMeta: true,
          version: true,
          id: true,
          type: true,
        },
      })
      .catch(() => {
        throw new BadRequestException('view found column meta error');
      });

    // validate field legal
    const fields = await this.prismaService.field.findMany({
      where: { tableId, deletedTime: null },
      select: {
        id: true,
        isPrimary: true,
      },
    });
    const primaryFields = fields.filter((field) => field.isPrimary).map((field) => field.id);

    const isHiddenPrimaryField = columnMetaRo.some(
      (f) => primaryFields.includes(f.fieldId) && (f.columnMeta as IGridColumnMeta).hidden
    );
    const fieldIds = columnMetaRo.map(({ fieldId }) => fieldId);

    if (!fieldIds.every((id) => fields.map(({ id }) => id).includes(id))) {
      throw new BadRequestException('field is not found in table');
    }

    const allowHiddenPrimaryType = [ViewType.Calendar, ViewType.Form];
    /**
     * validate whether hidden primary field
     * only form view or list view(todo) can hidden primary field
     */
    if (isHiddenPrimaryField && !allowHiddenPrimaryType.includes(view.type as ViewType)) {
      throw new ForbiddenException('primary field can not be hidden');
    }

    const curColumnMeta = JSON.parse(view.columnMeta);
    const ops: IOtOperation[] = [];

    columnMetaRo.forEach(({ fieldId, columnMeta }) => {
      const obj = {
        fieldId,
        newColumnMeta: { ...curColumnMeta[fieldId], ...columnMeta },
        oldColumnMeta: curColumnMeta[fieldId] ? curColumnMeta[fieldId] : undefined,
      };
      ops.push(ViewOpBuilder.editor.updateViewColumnMeta.build(obj));
    });

    await this.updateViewByOps(tableId, viewId, ops);

    if (windowId) {
      this.eventEmitterService.emitAsync(Events.OPERATION_VIEW_UPDATE, {
        tableId,
        windowId,
        viewId,
        userId: this.cls.get('user.id'),
        byOps: ops,
      });
    }
  }

  async updateShareMeta(tableId: string, viewId: string, viewShareMetaRo: IViewShareMetaRo) {
    return this.setViewProperty(tableId, viewId, 'shareMeta', viewShareMetaRo);
  }

  async setViewProperty(
    tableId: string,
    viewId: string,
    key: IViewPropertyKeys,
    newValue: unknown,
    windowId?: string
  ) {
    const curView = await this.prismaService.view
      .findFirstOrThrow({
        select: { [key]: true },
        where: { tableId, id: viewId, deletedTime: null },
      })
      .catch(() => {
        throw new BadRequestException('View not found');
      });
    const oldValue =
      curView[key] != null && VIEW_JSON_KEYS.includes(key)
        ? JSON.parse(curView[key])
        : curView[key];
    const ops = ViewOpBuilder.editor.setViewProperty.build({
      key,
      newValue,
      oldValue,
    });

    await this.updateViewByOps(tableId, viewId, [ops]);

    if (windowId) {
      this.eventEmitterService.emitAsync(Events.OPERATION_VIEW_UPDATE, {
        tableId,
        windowId,
        viewId,
        userId: this.cls.get('user.id'),
        byKey: {
          key,
          newValue,
          oldValue,
        },
      });
    }
  }

  async updateViewByOps(tableId: string, viewId: string, ops: IOtOperation[]) {
    return await this.prismaService.$tx(async () => {
      return await this.viewService.updateViewByOps(tableId, viewId, ops);
    });
  }

  async patchViewOptions(
    tableId: string,
    viewId: string,
    viewOptions: IViewOptions,
    windowId?: string
  ) {
    const curView = await this.prismaService.view
      .findFirstOrThrow({
        select: { options: true, type: true },
        where: { tableId, id: viewId, deletedTime: null },
      })
      .catch(() => {
        throw new BadRequestException('View option not found');
      });
    const { options, type: viewType } = curView;

    // validate option type
    try {
      validateOptionsType(viewType as ViewType, viewOptions);
    } catch (err) {
      throw new BadRequestException(err);
    }

    const oldOptions = options ? JSON.parse(options) : options;
    const op = ViewOpBuilder.editor.setViewProperty.build({
      key: 'options',
      newValue: {
        ...oldOptions,
        ...viewOptions,
      },
      oldValue: oldOptions,
    });
    await this.updateViewByOps(tableId, viewId, [op]);

    if (windowId) {
      this.eventEmitterService.emitAsync(Events.OPERATION_VIEW_UPDATE, {
        tableId,
        windowId,
        viewId,
        userId: this.cls.get('user.id'),
        byOps: [op],
      });
    }
  }

  /**
   * shuffle view order
   */
  async shuffle(tableId: string) {
    const views = await this.prismaService.view.findMany({
      where: { tableId, deletedTime: null },
      select: { id: true, order: true },
      orderBy: { order: 'asc' },
    });

    this.logger.log(`lucky view shuffle! ${tableId}`, 'shuffle');

    await this.prismaService.$tx(async () => {
      for (let i = 0; i < views.length; i++) {
        const view = views[i];
        await this.viewService.updateViewByOps(tableId, view.id, [
          ViewOpBuilder.editor.setViewProperty.build({
            key: 'order',
            newValue: i,
            oldValue: view.order,
          }),
        ]);
      }
    });
  }

  async updateViewOrder(
    tableId: string,
    viewId: string,
    orderRo: IUpdateOrderRo,
    windowId?: string
  ) {
    const { anchorId, position } = orderRo;

    const view = await this.prismaService.view
      .findFirstOrThrow({
        select: { order: true, id: true },
        where: { tableId, id: viewId, deletedTime: null },
      })
      .catch(() => {
        throw new NotFoundException(`View ${viewId} not found in the table`);
      });

    const anchorView = await this.prismaService.view
      .findFirstOrThrow({
        select: { order: true, id: true },
        where: { tableId, id: anchorId, deletedTime: null },
      })
      .catch(() => {
        throw new NotFoundException(`Anchor ${anchorId} not found in the table`);
      });

    await updateOrder({
      query: tableId,
      position,
      item: view,
      anchorItem: anchorView,
      getNextItem: async (whereOrder, align) => {
        return this.prismaService.view.findFirst({
          select: { order: true, id: true },
          where: {
            tableId,
            deletedTime: null,
            order: whereOrder,
          },
          orderBy: { order: align },
        });
      },
      update: async (
        parentId: string,
        id: string,
        data: { newOrder: number; oldOrder: number }
      ) => {
        const op = ViewOpBuilder.editor.setViewProperty.build({
          key: 'order',
          newValue: data.newOrder,
          oldValue: data.oldOrder,
        });
        await this.updateViewByOps(parentId, id, [op]);

        if (windowId) {
          this.eventEmitterService.emitAsync(Events.OPERATION_VIEW_UPDATE, {
            tableId,
            windowId,
            viewId,
            userId: this.cls.get('user.id'),
            byOps: [op],
          });
        }
      },
      shuffle: this.shuffle.bind(this),
    });
  }

  /**
   * shuffle record order
   */
  async shuffleRecords(dbTableName: string, indexField: string) {
    const recordCount = await this.recordService.getAllRecordCount(dbTableName);
    if (recordCount > 100_000) {
      throw new BadRequestException('Not enough gap to move the row here');
    }

    const sql = this.updateRecordOrderSql(
      this.knex.raw(`?? ASC`, [indexField]).toQuery(),
      dbTableName,
      indexField
    );

    await this.prismaService.$executeRawUnsafe(sql);
  }

  async updateRecordOrdersInner(props: {
    tableId: string;
    dbTableName: string;
    itemLength: number;
    indexField: string;
    orderRo: {
      anchorId: string;
      position: 'before' | 'after';
    };
    update: (indexes: number[]) => Promise<void>;
  }) {
    const { tableId, itemLength, dbTableName, indexField, orderRo, update } = props;
    const { anchorId, position } = orderRo;

    const anchorRecordSql = this.knex(dbTableName)
      .select({
        id: '__id',
        order: indexField,
      })
      .where('__id', anchorId)
      .toQuery();

    const anchorRecord = await this.prismaService
      .txClient()
      .$queryRawUnsafe<{ id: string; order: number }[]>(anchorRecordSql)
      .then((res) => {
        return res[0];
      });

    if (!anchorRecord) {
      throw new NotFoundException(`Anchor ${anchorId} not found in the table`);
    }

    await updateMultipleOrders({
      parentId: tableId,
      position,
      itemLength,
      anchorItem: anchorRecord,
      getNextItem: async (whereOrder, align) => {
        const nextRecordSql = this.knex(dbTableName)
          .select({
            id: '__id',
            order: indexField,
          })
          .where(
            indexField,
            whereOrder.lt != null ? '<' : '>',
            (whereOrder.lt != null ? whereOrder.lt : whereOrder.gt) as number
          )
          .orderBy(indexField, align)
          .limit(1)
          .toQuery();
        return this.prismaService
          .txClient()
          .$queryRawUnsafe<{ id: string; order: number }[]>(nextRecordSql)
          .then((res) => {
            return res[0];
          });
      },
      update,
      shuffle: async () => {
        await this.shuffleRecords(dbTableName, indexField);
      },
    });
  }

  async updateRecordIndexes(
    tableId: string,
    viewId: string,
    recordsWithOrder: {
      id: string;
      order?: Record<string, number>;
    }[]
  ) {
    // for notify view update only
    await this.prismaService.$tx(async () => {
      const ops = ViewOpBuilder.editor.setViewProperty.build({
        key: 'lastModifiedTime',
        newValue: new Date().toISOString(),
      });
      await this.viewService.updateViewByOps(tableId, viewId, [ops]);
      await this.recordService.updateRecordIndexes(tableId, recordsWithOrder);
    });
  }

  async updateRecordOrders(
    tableId: string,
    viewId: string,
    orderRo: IUpdateRecordOrdersRo,
    windowId?: string
  ) {
    const recordIds = orderRo.recordIds;
    const dbTableName = await this.recordService.getDbTableName(tableId);
    const orderIndexesBefore = windowId
      ? await this.recordService.getRecordIndexes(tableId, recordIds, viewId)
      : undefined;

    const indexField = await this.viewService.getOrCreateViewIndexField(dbTableName, viewId);

    await this.updateRecordOrdersInner({
      tableId,
      dbTableName,
      itemLength: recordIds.length,
      indexField,
      orderRo,
      update: async (indexes) => {
        // for notify view update only
        const ops = ViewOpBuilder.editor.setViewProperty.build({
          key: 'lastModifiedTime',
          newValue: new Date().toISOString(),
        });

        await this.prismaService.$tx(async (prisma) => {
          await this.viewService.updateViewByOps(tableId, viewId, [ops]);
          for (let i = 0; i < recordIds.length; i++) {
            const recordId = recordIds[i];
            const updateRecordSql = this.knex(dbTableName)
              .update({
                [indexField]: indexes[i],
              })
              .where('__id', recordId)
              .toQuery();
            await prisma.$executeRawUnsafe(updateRecordSql);
          }
        });
      },
    });

    if (windowId) {
      const orderIndexesAfter = await this.recordService.getRecordIndexes(
        tableId,
        recordIds,
        viewId
      );
      this.eventEmitterService.emitAsync(Events.OPERATION_RECORDS_ORDER_UPDATE, {
        tableId,
        windowId,
        recordIds,
        viewId,
        userId: this.cls.get('user.id'),
        orderIndexesBefore,
        orderIndexesAfter,
      });
    }
  }

  async refreshShareId(tableId: string, viewId: string) {
    const view = await this.prismaService.view.findUnique({
      where: { id: viewId, tableId, deletedTime: null },
      select: { shareId: true, enableShare: true },
    });
    if (!view) {
      throw new NotFoundException(`View ${viewId} does not exist`);
    }
    const { enableShare } = view;
    if (!enableShare) {
      throw new BadRequestException(`View ${viewId} has not been enabled share`);
    }
    const newShareId = generateShareId();
    const setShareIdOp = ViewOpBuilder.editor.setViewProperty.build({
      key: 'shareId',
      newValue: newShareId,
      oldValue: view.shareId || undefined,
    });
    await this.updateViewByOps(tableId, viewId, [setShareIdOp]);
    return { shareId: newShareId };
  }

  async enableShare(tableId: string, viewId: string) {
    const view = await this.prismaService.view.findUnique({
      where: { id: viewId, tableId, deletedTime: null },
    });
    if (!view) {
      throw new NotFoundException(`View ${viewId} does not exist`);
    }
    const { enableShare, shareId } = view;
    if (enableShare) {
      throw new BadRequestException(`View ${viewId} has already been enabled share`);
    }
    const newShareId = generateShareId();
    const enableShareOp = ViewOpBuilder.editor.setViewProperty.build({
      key: 'enableShare',
      newValue: true,
      oldValue: enableShare || undefined,
    });
    const setShareIdOp = ViewOpBuilder.editor.setViewProperty.build({
      key: 'shareId',
      newValue: newShareId,
      oldValue: shareId || undefined,
    });

    const ops = [enableShareOp, setShareIdOp];

    const viewInstance = createViewInstanceByRaw(view);
    if (!view.shareMeta && viewInstance.defaultShareMeta) {
      const initShareMetaOp = ViewOpBuilder.editor.setViewProperty.build({
        key: 'shareMeta',
        newValue: viewInstance.defaultShareMeta,
      });
      ops.push(initShareMetaOp);
    }
    await this.updateViewByOps(tableId, viewId, ops);
    return { shareId: newShareId };
  }

  async disableShare(tableId: string, viewId: string) {
    const view = await this.prismaService.view.findUnique({
      where: { id: viewId, tableId, deletedTime: null },
      select: { shareId: true, enableShare: true, shareMeta: true },
    });
    if (!view) {
      throw new NotFoundException(`View ${viewId} does not exist`);
    }
    const { enableShare } = view;
    if (!enableShare) {
      throw new BadRequestException(`View ${viewId} has already been disable share`);
    }
    const enableShareOp = ViewOpBuilder.editor.setViewProperty.build({
      key: 'enableShare',
      newValue: false,
      oldValue: enableShare || undefined,
    });

    await this.updateViewByOps(tableId, viewId, [enableShareOp]);
  }

  /**
   * @param linkFields {fieldId: foreignTableId}
   * @returns {foreignTableId: Set<recordId>}
   */
  private collectFilterLinkFieldRecords(linkFields: Record<string, string>, filter?: IFilter) {
    if (!filter || !filter.filterSet) {
      return undefined;
    }

    const tableRecordMap: Record<string, Set<string>> = {};

    const mergeRecordMap = (source: Record<string, Set<string>> = {}) => {
      for (const [fieldId, recordSet] of Object.entries(source)) {
        tableRecordMap[fieldId] = tableRecordMap[fieldId] || new Set();
        recordSet.forEach((item) => tableRecordMap[fieldId].add(item));
      }
    };

    for (const filterItem of filter.filterSet) {
      if ('filterSet' in filterItem) {
        const groupTableRecordMap = this.collectFilterLinkFieldRecords(
          linkFields,
          filterItem as IFilter
        );
        if (groupTableRecordMap) {
          mergeRecordMap(groupTableRecordMap);
        }
        continue;
      }

      const { value, fieldId } = filterItem as IFilterItem;

      const foreignTableId = linkFields[fieldId];
      if (!foreignTableId) {
        continue;
      }

      if (Array.isArray(value)) {
        mergeRecordMap({ [foreignTableId]: new Set(value as string[]) });
      } else if (typeof value === 'string' && value.startsWith(IdPrefix.Record)) {
        mergeRecordMap({ [foreignTableId]: new Set([value]) });
      }
    }

    return tableRecordMap;
  }

  async getFilterLinkRecords(tableId: string, viewId: string) {
    const view = await this.viewService.getViewById(viewId);
    return this.getFilterLinkRecordsByTable(tableId, view.filter);
  }

  async getFilterLinkRecordsByTable(tableId: string, filter?: IFilter) {
    if (!filter) {
      return [];
    }
    const linkFields = await this.prismaService.field.findMany({
      where: { tableId, deletedTime: null, type: FieldType.Link },
    });
    const linkFieldTableMap = linkFields.reduce(
      (map, field) => {
        const { foreignTableId } = JSON.parse(field.options as string) as ILinkFieldOptions;
        map[field.id] = foreignTableId;
        return map;
      },
      {} as Record<string, string>
    );

    const tableRecordMap = this.collectFilterLinkFieldRecords(linkFieldTableMap, filter);

    if (!tableRecordMap) {
      return [];
    }
    const res: IGetViewFilterLinkRecordsVo = [];
    for (const [foreignTableId, recordSet] of Object.entries(tableRecordMap)) {
      const dbTableName = await this.recordService.getDbTableName(foreignTableId);
      const primaryField = await this.prismaService.field.findFirst({
        where: { tableId: foreignTableId, isPrimary: true, deletedTime: null },
      });
      if (!primaryField) {
        continue;
      }

      const dbFieldName = primaryField.dbFieldName;

      const nativeQuery = this.knex(dbTableName)
        .select('__id as id', `${dbFieldName} as title`)
        .orderBy('__auto_number')
        .whereIn('__id', Array.from(recordSet))
        .toQuery();

      const list = await this.prismaService
        .txClient()
        .$queryRawUnsafe<{ id: string; title: string | null }[]>(nativeQuery);
      const fieldInstances = createFieldInstanceByRaw(primaryField);
      res.push({
        tableId: foreignTableId,
        records: list.map(({ id, title }) => ({
          id,
          title:
            fieldInstances.cellValue2String(fieldInstances.convertDBValue2CellValue(title)) ||
            undefined,
        })),
      });
    }
    return res;
  }

  async pluginInstall(tableId: string, ro: IViewInstallPluginRo) {
    const userId = this.cls.get('user.id');
    const { name, pluginId } = ro;
    const plugin = await this.prismaService.plugin.findUnique({
      where: { id: pluginId, status: PluginStatus.Published },
      select: { id: true, name: true, logo: true, positions: true },
    });
    if (!plugin) {
      throw new NotFoundException(`Plugin ${pluginId} not found`);
    }
    if (!plugin.positions.includes(PluginPosition.View)) {
      throw new BadRequestException(`Plugin ${pluginId} does not support install in view`);
    }
    const viewName = name || plugin.name;
    return this.prismaService.$tx(async (prisma) => {
      const pluginInstallId = generatePluginInstallId();
      const view = await this.createViewInner(tableId, {
        name: viewName,
        type: ViewType.Plugin,
        options: {
          pluginInstallId,
          pluginId,
          pluginLogo: plugin.logo,
        } as IPluginViewOptions,
      });
      const table = await prisma.tableMeta.findUniqueOrThrow({
        where: { id: tableId, deletedTime: null },
        select: { baseId: true },
      });
      const newPlugin = await prisma.pluginInstall.create({
        data: {
          id: pluginInstallId,
          baseId: table?.baseId,
          positionId: view.id,
          position: PluginPosition.View,
          name: viewName,
          pluginId: ro.pluginId,
          createdBy: userId,
        },
      });
      return {
        pluginId: newPlugin.pluginId,
        pluginInstallId: newPlugin.id,
        name: newPlugin.name,
        viewId: view.id,
      };
    });
  }

  async updatePluginStorage(viewId: string, storage: IViewPluginUpdateStorageRo['storage']) {
    const pluginInstall = await this.prismaService.pluginInstall.findFirst({
      where: { positionId: viewId, position: PluginPosition.View },
      select: { id: true },
    });
    if (!pluginInstall) {
      throw new NotFoundException(`Plugin install not found`);
    }
    return this.prismaService.pluginInstall.update({
      where: { id: pluginInstall.id },
      data: { storage: JSON.stringify(storage) },
    });
  }

  async getPluginInstall(tableId: string, viewId: string) {
    const table = await this.prismaService.tableMeta.findUniqueOrThrow({
      where: { id: tableId, deletedTime: null },
      select: { baseId: true },
    });
    const pluginInstall = await this.prismaService.pluginInstall.findFirst({
      where: { positionId: viewId, position: PluginPosition.View },
      select: {
        id: true,
        pluginId: true,
        name: true,
        storage: true,
        plugin: {
          select: { url: true },
        },
      },
    });
    if (!pluginInstall) {
      throw new NotFoundException(`Plugin install not found`);
    }
    return {
      name: pluginInstall.name,
      pluginId: pluginInstall.pluginId,
      pluginInstallId: pluginInstall.id,
      storage: pluginInstall.storage ? JSON.parse(pluginInstall.storage) : undefined,
      baseId: table.baseId,
      url: pluginInstall.plugin.url || undefined,
    };
  }
}
