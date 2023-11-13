import { BadRequestException, Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { FieldKeyType } from '@teable-group/core';
import type {
  IViewVo,
  IShareViewMeta,
  IRawAggregationVo,
  IRawRowCountVo,
  IViewRowCountVo,
} from '@teable-group/core';
import { PrismaService } from '@teable-group/db-main-prisma';
import { type ShareViewGetVo } from '@teable-group/openapi';
import { AggregationService } from '../aggregation/aggregation.service';
import { FieldService } from '../field/field.service';
import { RecordService } from '../record/record.service';
import { createViewVoByRaw } from '../view/model/factory';

export interface IShareViewInfo {
  shareId: string;
  tableId: string;
  view: IViewVo;
}

@Injectable()
export class ShareService {
  constructor(
    private readonly prismaService: PrismaService,
    private readonly jwtService: JwtService,
    private readonly fieldService: FieldService,
    private readonly recordService: RecordService,
    private readonly aggregationService: AggregationService
  ) {}

  async authShareView(shareId: string, pass: string): Promise<string | null> {
    const view = await this.prismaService.view.findFirst({
      where: { shareId, enableShare: true, deletedTime: null },
      select: { shareId: true, shareMeta: true },
    });
    if (!view) {
      return null;
    }
    const shareMeta = view.shareMeta ? (JSON.parse(view.shareMeta) as IShareViewMeta) : undefined;
    const password = shareMeta?.password;
    if (!password) {
      throw new BadRequestException('Password restriction is not enabled');
    }
    return pass === password ? shareId : null;
  }

  async authToken(shareId: string) {
    return await this.jwtService.signAsync({ shareId });
  }

  async getShareViewInfo(shareId: string): Promise<IShareViewInfo> {
    const view = await this.prismaService.view.findFirst({
      where: { shareId, enableShare: true, deletedTime: null },
    });
    if (!view) {
      throw new BadRequestException('share view not found');
    }

    return {
      shareId,
      tableId: view.tableId,
      view: createViewVoByRaw(view),
    };
  }

  async getShareView(shareId: string): Promise<ShareViewGetVo> {
    const view = await this.prismaService.view.findFirst({
      where: { shareId, enableShare: true, deletedTime: null },
    });
    if (!view) {
      throw new BadRequestException('share view not found');
    }
    const shareMeta = view.shareMeta ? (JSON.parse(view.shareMeta) as IShareViewMeta) : undefined;
    const { tableId, id: viewId } = view;
    const fields = await this.fieldService.getFields(tableId, {
      viewId: view.id,
      filterHidden: !shareMeta?.includeHiddenField,
    });
    const { records } = await this.recordService.getRecords(tableId, {
      viewId,
      skip: 0,
      take: 50,
      fieldKeyType: FieldKeyType.Id,
    });
    return {
      shareMeta,
      shareId,
      tableId,
      viewId,
      view: createViewVoByRaw(view),
      fields,
      records,
    };
  }

  async getViewAggregations(shareInfo: IShareViewInfo) {
    const viewId = shareInfo.view.id;
    const tableId = shareInfo.tableId;
    const result = (await this.aggregationService.performAggregation(
      { tableId, withView: { viewId } },
      { fieldAggregation: true }
    )) as IRawAggregationVo;

    return { viewId: viewId, aggregations: result[viewId]?.aggregations };
  }

  async getViewRowCount(shareInfo: IShareViewInfo): Promise<IViewRowCountVo> {
    const viewId = shareInfo.view.id;
    const tableId = shareInfo.tableId;
    const result = (await this.aggregationService.performAggregation(
      { tableId, withView: { viewId } },
      { rowCount: true }
    )) as IRawRowCountVo;

    return {
      rowCount: result[viewId].rowCount,
    };
  }
}
