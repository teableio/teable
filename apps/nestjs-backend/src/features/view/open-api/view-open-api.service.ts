import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import type {
  IFieldVo,
  IOtOperation,
  IViewRo,
  IViewVo,
  IFilter,
  ISort,
  IViewOptionRo,
  ViewType,
  IColumnMetaRo,
} from '@teable-group/core';
import {
  IManualSortRo,
  ViewOpBuilder,
  generateShareId,
  validateOptionType,
} from '@teable-group/core';
import { PrismaService } from '@teable-group/db-main-prisma';
import { Knex } from 'knex';
import { InjectModel } from 'nest-knexjs';
import { Timing } from '../../../utils/timing';
import { FieldService } from '../../field/field.service';
import { RecordService } from '../../record/record.service';
import { ViewService } from '../view.service';

@Injectable()
export class ViewOpenApiService {
  private logger = new Logger(ViewOpenApiService.name);

  constructor(
    private readonly prismaService: PrismaService,
    private readonly recordService: RecordService,
    private readonly viewService: ViewService,
    private readonly fieldService: FieldService,
    @InjectModel('CUSTOM_KNEX') private readonly knex: Knex
  ) {}

  async createView(tableId: string, viewRo: IViewRo) {
    return await this.prismaService.$tx(async () => {
      return await this.createViewInner(tableId, viewRo);
    });
  }

  async deleteView(tableId: string, viewId: string) {
    return await this.prismaService.$tx(async () => {
      return await this.deleteViewInner(tableId, viewId);
    });
  }

  private async createViewInner(tableId: string, viewRo: IViewRo): Promise<IViewVo> {
    return await this.viewService.createView(tableId, viewRo);
  }

  private async deleteViewInner(tableId: string, viewId: string) {
    await this.viewService.deleteView(tableId, viewId);
  }

  @Timing()
  async manualSort(tableId: string, viewId: string, viewOrderRo: IManualSortRo) {
    const { sortObjs } = viewOrderRo;
    const dbTableName = await this.recordService.getDbTableName(tableId);
    const fields = await this.fieldService.getFields(tableId, { viewId });
    const fieldIndexId = this.viewService.getRowIndexFieldName(viewId);

    const fieldMap = fields.reduce(
      (map, field) => {
        map[field.id] = field;
        return map;
      },
      {} as Record<string, IFieldVo>
    );

    let orderRawSql = sortObjs
      .map((sort) => {
        const { fieldId, order } = sort;

        const field = fieldMap[fieldId];
        if (!field) {
          return;
        }

        const column =
          field.dbFieldType === 'JSON'
            ? this.knex.raw(`CAST(?? as text)`, [field.dbFieldName]).toQuery()
            : this.knex.ref(field.dbFieldName).toQuery();

        const nulls = order.toUpperCase() === 'ASC' ? 'FIRST' : 'LAST';

        return `${column} ${order} NULLS ${nulls}`;
      })
      .join();

    // ensure order stable
    orderRawSql += this.knex.raw(`, ?? ASC`, ['__auto_number']).toQuery();

    const updateRecordsOrderSql = this.knex
      .raw(
        `
          UPDATE :dbTableName:
          SET :fieldIndexId: = temp_order.new_order
          FROM (
            SELECT __id, ROW_NUMBER() OVER (ORDER BY ${orderRawSql}) AS new_order FROM :dbTableName:
          ) AS temp_order
          WHERE :dbTableName:.__id = temp_order.__id AND :dbTableName:.:fieldIndexId: != temp_order.new_order;
        `,
        {
          dbTableName: dbTableName,
          fieldIndexId: fieldIndexId,
        }
      )
      .toQuery();

    // build ops
    const newSort = {
      sortObjs: sortObjs,
      manualSort: true,
    };

    await this.prismaService.$tx(async (prisma) => {
      await prisma.$executeRawUnsafe(updateRecordsOrderSql);
      await this.viewService.updateViewSort(tableId, viewId, newSort);
    });
  }

  async setViewColumnMeta(tableId: string, viewId: string, columnMetaRo: IColumnMetaRo) {
    const view = await this.prismaService
      .txClient()
      .view.findFirstOrThrow({
        where: { tableId, id: viewId },
        select: {
          columnMeta: true,
          version: true,
          id: true,
        },
      })
      .catch(() => {
        throw new BadRequestException('view found column meta error');
      });
    const curColumnMeta = JSON.parse(view.columnMeta);
    const ops: IOtOperation[] = [];
    columnMetaRo.forEach(({ fieldId, columnMeta }) => {
      const obj = {
        fieldId,
        newMetaValue: { ...curColumnMeta[fieldId], ...columnMeta },
        oldMetaValue: curColumnMeta[fieldId] ? curColumnMeta[fieldId] : undefined,
      };
      ops.push(ViewOpBuilder.editor.setViewColumnMeta.build(obj));
    });
    await this.prismaService.$tx(async () => {
      await this.viewService.updateViewByOps(tableId, viewId, ops);
    });
  }

  async setViewFilter(tableId: string, viewId: string, filter: IFilter) {
    const curView = await this.prismaService
      .txClient()
      .view.findFirstOrThrow({
        select: { filter: true },
        where: { tableId, id: viewId, deletedTime: null },
      })
      .catch(() => {
        throw new BadRequestException('View filter not found');
      });
    const { filter: oldFilter } = curView;
    const ops = ViewOpBuilder.editor.setViewFilter.build({
      newFilter: filter,
      oldFilter: oldFilter ? JSON.parse(oldFilter) : oldFilter,
    });
    await this.prismaService.$tx(async () => {
      await this.viewService.updateViewByOps(tableId, viewId, [ops]);
    });
  }

  async setViewSort(tableId: string, viewId: string, sort: ISort) {
    const curView = await this.prismaService
      .txClient()
      .view.findFirstOrThrow({
        select: { sort: true },
        where: { tableId, id: viewId, deletedTime: null },
      })
      .catch(() => {
        throw new BadRequestException('View not found');
      });
    const { sort: oldSort } = curView;
    const ops = ViewOpBuilder.editor.setViewSort.build({
      newSort: sort,
      oldSort: oldSort ? JSON.parse(oldSort) : oldSort,
    });
    await this.prismaService.$tx(async () => {
      await this.viewService.updateViewByOps(tableId, viewId, [ops]);
    });
  }

  async setViewOption(tableId: string, viewId: string, viewOption: IViewOptionRo) {
    const curView = await this.prismaService
      .txClient()
      .view.findFirstOrThrow({
        select: { options: true, type: true },
        where: { tableId, id: viewId, deletedTime: null },
      })
      .catch(() => {
        throw new BadRequestException('View option not found');
      });
    const { options, type: viewType } = curView;

    try {
      validateOptionType(viewType as ViewType, viewOption);
    } catch (result) {
      throw new BadRequestException(result);
    }

    const oldOptions = options ? JSON.parse(options) : options;
    const ops = ViewOpBuilder.editor.setViewOption.build({
      newOptions: {
        ...oldOptions,
        ...viewOption,
      },
      oldOptions: oldOptions,
    });
    await this.prismaService.$tx(async () => {
      await this.viewService.updateViewByOps(tableId, viewId, [ops]);
    });
  }

  async enableShare(tableId: string, viewId: string) {
    const view = await this.prismaService.txClient().view.findUnique({
      where: { id: viewId, tableId, deletedTime: null },
      select: { shareId: true, enableShare: true },
    });
    if (!view) {
      throw new NotFoundException(`View ${viewId} does not exist`);
    }
    const { enableShare, shareId } = view;
    if (enableShare) {
      throw new BadRequestException(`View ${viewId} has already been enabled share`);
    }
    const newShareId = generateShareId();
    const enableShareOp = ViewOpBuilder.editor.setViewEnableShare.build({
      newEnableShare: true,
      oldEnableShare: enableShare || undefined,
    });
    const setShareIdOp = ViewOpBuilder.editor.setViewShareId.build({
      newShareId,
      oldShareId: shareId || undefined,
    });
    await this.prismaService.$tx(async () => {
      await this.viewService.updateViewByOps(tableId, viewId, [enableShareOp, setShareIdOp]);
    });
    return { shareId: newShareId };
  }

  async disableShare(tableId: string, viewId: string) {
    const view = await this.prismaService.txClient().view.findUnique({
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
    const shareMeta = JSON.parse(view.shareMeta as string) || undefined;
    const enableShareOp = ViewOpBuilder.editor.setViewEnableShare.build({
      newEnableShare: false,
      oldEnableShare: enableShare || undefined,
    });

    const shareMetaOp = ViewOpBuilder.editor.setViewShareMeta.build({
      oldShareMeta: shareMeta || undefined,
    });

    await this.prismaService.$tx(async () => {
      await this.viewService.updateViewByOps(tableId, viewId, [enableShareOp, shareMetaOp]);
    });
  }
}
