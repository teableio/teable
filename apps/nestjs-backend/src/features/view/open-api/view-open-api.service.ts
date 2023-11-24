import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import type {
  IColumnMeta,
  IFieldVo,
  IOtOperation,
  IViewRo,
  IViewVo,
  IFieldsViewVisibleRo,
  IColumn,
  IFilter,
  ISort,
  IViewOptionRo,
  ViewType,
} from '@teable-group/core';
import {
  FieldOpBuilder,
  IManualSortRo,
  OpName,
  ViewOpBuilder,
  generateShareId,
  validateOptionType,
} from '@teable-group/core';
import { PrismaService } from '@teable-group/db-main-prisma';
import { Knex } from 'knex';
import { orderBy } from 'lodash';
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
    const result = await this.viewService.createView(tableId, viewRo);
    await this.updateColumnMetaForFields(result.id, tableId, OpName.AddColumnMeta);
    return result;
  }

  private async deleteViewInner(tableId: string, viewId: string) {
    await this.updateColumnMetaForFields(viewId, tableId, OpName.DeleteColumnMeta);
    await this.viewService.deleteView(tableId, viewId);
  }

  private async updateColumnMetaForFields(
    viewId: string,
    tableId: string,
    opName: OpName.AddColumnMeta | OpName.DeleteColumnMeta
  ) {
    let fields = await this.prismaService.txClient().field.findMany({
      where: { tableId, deletedTime: null },
      select: { id: true, columnMeta: true, createdTime: true, isPrimary: true },
    });

    // manually sort to prevent the empty value sort problem in postgres and sqlite
    fields = orderBy(fields, ['isPrimary', 'createdTime']);

    for (let index = 0; index < fields.length; index++) {
      const field = fields[index];

      let data: IOtOperation;
      if (opName === OpName.AddColumnMeta) {
        data = this.addColumnMeta2Op(viewId, index + 1);
      } else {
        data = this.deleteColumnMeta2Op(viewId, JSON.parse(field.columnMeta));
      }

      await this.fieldService.batchUpdateFields(tableId, [{ fieldId: field.id, ops: [data] }]);
    }
  }

  private addColumnMeta2Op(viewId: string, order: number) {
    return FieldOpBuilder.editor.addColumnMeta.build({
      viewId,
      newMetaValue: { order },
    });
  }

  private deleteColumnMeta2Op(viewId: string, oldColumnMeta: IColumnMeta) {
    return FieldOpBuilder.editor.deleteColumnMeta.build({
      viewId,
      oldMetaValue: oldColumnMeta[viewId],
    });
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

  async setViewFieldsVisible(tableId: string, viewId: string, fields: IFieldsViewVisibleRo) {
    const { viewFields } = fields;
    const field = await this.prismaService
      .txClient()
      .field.findMany({
        where: { tableId },
        select: {
          columnMeta: true,
          version: true,
          id: true,
          isPrimary: true,
        },
      })
      .catch(() => {
        throw new BadRequestException('Field found error');
      });
    const ops: { fieldId: string; ops: IOtOperation[] }[] = [];
    type IMetaKey = keyof IColumn;
    viewFields.forEach(({ fieldId, hidden }) => {
      const item = field.find((f) => f.id === fieldId)?.columnMeta;
      const obj = {
        viewId,
        metaKey: 'hidden' as IMetaKey,
        newMetaValue: hidden as boolean,
        oldMetaValue: item ? !!JSON.parse(item)[viewId]?.hidden : undefined,
      };
      const op = {
        fieldId: fieldId,
        ops: [FieldOpBuilder.editor.setColumnMeta.build(obj)],
      };
      ops.push(op);
    });
    await this.prismaService.$tx(async () => {
      await this.fieldService.batchUpdateFields(tableId, ops);
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
    validateOptionType(viewType as ViewType, viewOption);
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
