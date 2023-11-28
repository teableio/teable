import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ANONYMOUS_USER_ID, FieldKeyType } from '@teable-group/core';
import type {
  IViewVo,
  IShareViewMeta,
  IRawAggregationVo,
  IRawRowCountVo,
  IViewRowCountVo,
  IViewRowCountRo,
  IViewAggregationRo,
} from '@teable-group/core';
import { PrismaService } from '@teable-group/db-main-prisma';
import type {
  IShareViewCopyRo,
  ShareViewFormSubmitRo,
  ShareViewGetVo,
} from '@teable-group/openapi';
import { ClsService } from 'nestjs-cls';
import type { IClsStore } from '../../types/cls';
import { AggregationService } from '../aggregation/aggregation.service';
import { FieldService } from '../field/field.service';
import { RecordOpenApiService } from '../record/open-api/record-open-api.service';
import { RecordService } from '../record/record.service';
import { SelectionService } from '../selection/selection.service';
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
    private readonly aggregationService: AggregationService,
    private readonly recordOpenApiService: RecordOpenApiService,
    private readonly cls: ClsService<IClsStore>,
    private readonly selectionService: SelectionService
  ) {}

  async validateJwtToken(token: string) {
    try {
      return await this.jwtService.verifyAsync<{ shareId: string }>(token);
    } catch {
      throw new UnauthorizedException();
    }
  }

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

  async getViewAggregations(shareInfo: IShareViewInfo, query: IViewAggregationRo = {}) {
    const viewId = shareInfo.view.id;
    const tableId = shareInfo.tableId;
    const { filter } = query;
    const result = (await this.aggregationService.performAggregation(
      { tableId, withView: { viewId, customFilter: filter } },
      { fieldAggregation: true }
    )) as IRawAggregationVo;

    return { viewId: viewId, aggregations: result[viewId]?.aggregations };
  }

  async getViewRowCount(
    shareInfo: IShareViewInfo,
    query: IViewRowCountRo = {}
  ): Promise<IViewRowCountVo> {
    const viewId = shareInfo.view.id;
    const tableId = shareInfo.tableId;
    const { filter } = query;
    const result = (await this.aggregationService.performAggregation(
      { tableId, withView: { viewId, customFilter: filter } },
      { rowCount: true }
    )) as IRawRowCountVo;

    return {
      rowCount: result[viewId].rowCount,
    };
  }

  async formSubmit(shareInfo: IShareViewInfo, shareViewFormSubmitRo: ShareViewFormSubmitRo) {
    const { tableId } = shareInfo;
    const { fields } = shareViewFormSubmitRo;
    return await this.cls.runWith(
      {
        ...this.cls.get('shareViewId'),
        user: {
          id: ANONYMOUS_USER_ID,
          name: ANONYMOUS_USER_ID,
          email: '',
        },
      },
      async () => {
        const { records } = await this.prismaService.$tx(async () => {
          return await this.recordOpenApiService.createRecords(
            tableId,
            [{ fields }],
            FieldKeyType.Id
          );
        });
        if (records.length === 0) {
          throw new InternalServerErrorException('The number of successful submit records is 0');
        }
        return records[0];
      }
    );
  }

  async copy(shareInfo: IShareViewInfo, shareViewCopyRo: IShareViewCopyRo) {
    return this.selectionService.copy(shareInfo.tableId, shareInfo.view.id, shareViewCopyRo);
  }
}
