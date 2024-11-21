/* eslint-disable @typescript-eslint/no-explicit-any */
import {
  Controller,
  HttpCode,
  Post,
  Res,
  UseGuards,
  Request,
  Get,
  Body,
  Query,
} from '@nestjs/common';
import { IGetFieldsQuery, getFieldsQuerySchema } from '@teable/core';
import {
  ShareViewFormSubmitRo,
  shareViewFormSubmitRoSchema,
  shareViewRowCountRoSchema,
  shareViewAggregationsRoSchema,
  shareViewGroupPointsRoSchema,
  IShareViewRowCountRo,
  IShareViewGroupPointsRo,
  IShareViewAggregationsRo,
  rangesQuerySchema,
  IRangesRo,
  shareViewLinkRecordsRoSchema,
  IShareViewLinkRecordsRo,
  shareViewCollaboratorsRoSchema,
  IShareViewCollaboratorsRo,
  getRecordsRoSchema,
  IGetRecordsRo,
  shareViewCalendarDailyCollectionRoSchema,
  IShareViewCalendarDailyCollectionRo,
  searchCountRoSchema,
  ISearchCountRo,
  ISearchIndexByQueryRo,
  searchIndexByQueryRoSchema,
} from '@teable/openapi';
import type {
  IRecord,
  IAggregationVo,
  IRowCountVo,
  IGroupPointsVo,
  ICopyVo,
  ShareViewGetVo,
  IShareViewLinkRecordsVo,
  IShareViewCollaboratorsVo,
  ICalendarDailyCollectionVo,
  ISearchCountVo,
  ISearchIndexVo,
} from '@teable/openapi';
import { Response } from 'express';
import { ZodValidationPipe } from '../../zod.validation.pipe';
import { Public } from '../auth/decorators/public.decorator';
import { TqlPipe } from '../record/open-api/tql.pipe';
import { ShareAuthGuard } from './guard/auth.guard';
import { ShareAuthLocalGuard } from './guard/share-auth-local.guard';
import { ShareSubmit } from './guard/submit.decorator';
import type { IShareViewInfo } from './share-auth.service';
import { ShareAuthService } from './share-auth.service';
import { ShareSocketService } from './share-socket.service';
import { ShareService } from './share.service';

@Controller('api/share')
@Public()
export class ShareController {
  constructor(
    private readonly shareService: ShareService,
    private readonly shareAuthService: ShareAuthService,
    private readonly shareSocketService: ShareSocketService
  ) {}

  @HttpCode(200)
  @UseGuards(ShareAuthLocalGuard)
  @Post('/:shareId/view/auth')
  async auth(@Request() req: any, @Res({ passthrough: true }) res: Response) {
    const shareId = req.shareId;
    const password = req.password;
    const token = await this.shareAuthService.authToken({ shareId, password });
    res.cookie(shareId, token, {
      httpOnly: true,
      maxAge: 1000 * 60 * 60 * 24 * 7,
    });
    return { token };
  }

  @UseGuards(ShareAuthGuard)
  @Get('/:shareId/view')
  async getShareView(@Request() req?: any): Promise<ShareViewGetVo> {
    const shareInfo = req.shareInfo as IShareViewInfo;
    return this.shareService.getShareView(shareInfo);
  }

  @UseGuards(ShareAuthGuard)
  @Get('/:shareId/view/aggregations')
  async getViewAggregations(
    @Request() req: any,
    @Query(new ZodValidationPipe(shareViewAggregationsRoSchema), TqlPipe)
    query?: IShareViewAggregationsRo
  ): Promise<IAggregationVo> {
    const shareInfo = req.shareInfo as IShareViewInfo;
    return this.shareService.getViewAggregations(shareInfo, query);
  }

  @UseGuards(ShareAuthGuard)
  @Get('/:shareId/view/row-count')
  async getViewRowCount(
    @Request() req: any,
    @Query(new ZodValidationPipe(shareViewRowCountRoSchema), TqlPipe)
    query?: IShareViewRowCountRo
  ): Promise<IRowCountVo> {
    const shareInfo = req.shareInfo as IShareViewInfo;
    return this.shareService.getViewRowCount(shareInfo, query);
  }

  @ShareSubmit()
  @UseGuards(ShareAuthGuard)
  @Post('/:shareId/view/form-submit')
  async submitRecord(
    @Request() req: any,
    @Body(new ZodValidationPipe(shareViewFormSubmitRoSchema))
    shareViewFormSubmitRo: ShareViewFormSubmitRo
  ): Promise<IRecord> {
    const shareInfo = req.shareInfo as IShareViewInfo;
    return this.shareService.formSubmit(shareInfo, shareViewFormSubmitRo);
  }

  @UseGuards(ShareAuthGuard)
  @Get('/:shareId/view/copy')
  async copy(
    @Request() req: any,
    @Query(new ZodValidationPipe(rangesQuerySchema), TqlPipe) shareViewCopyRo: IRangesRo
  ): Promise<ICopyVo> {
    const shareInfo = req.shareInfo as IShareViewInfo;
    return this.shareService.copy(shareInfo, shareViewCopyRo);
  }

  @UseGuards(ShareAuthGuard)
  @Get('/:shareId/view/group-points')
  async getViewGroupPoints(
    @Request() req: any,
    @Query(new ZodValidationPipe(shareViewGroupPointsRoSchema))
    query?: IShareViewGroupPointsRo
  ): Promise<IGroupPointsVo> {
    const shareInfo = req.shareInfo as IShareViewInfo;
    return this.shareService.getViewGroupPoints(shareInfo, query);
  }

  @UseGuards(ShareAuthGuard)
  @Get('/:shareId/view/calendar-daily-collection')
  async getViewCalendarDailyCollection(
    @Request() req: any,
    @Query(new ZodValidationPipe(shareViewCalendarDailyCollectionRoSchema))
    query: IShareViewCalendarDailyCollectionRo
  ): Promise<ICalendarDailyCollectionVo> {
    const shareInfo = req.shareInfo as IShareViewInfo;
    return this.shareService.getViewCalendarDailyCollection(shareInfo, query);
  }

  @UseGuards(ShareAuthGuard)
  @Get('/:shareId/view/link-records')
  async viewLinkRecords(
    @Request() req: any,
    @Query(new ZodValidationPipe(shareViewLinkRecordsRoSchema))
    shareViewLinkRecordsRo: IShareViewLinkRecordsRo
  ): Promise<IShareViewLinkRecordsVo> {
    const shareInfo = req.shareInfo as IShareViewInfo;
    return this.shareService.getViewLinkRecords(shareInfo, shareViewLinkRecordsRo);
  }

  @UseGuards(ShareAuthGuard)
  @Get('/:shareId/view/collaborators')
  async getViewCollaborators(
    @Request() req: any,
    @Query(new ZodValidationPipe(shareViewCollaboratorsRoSchema)) query: IShareViewCollaboratorsRo
  ): Promise<IShareViewCollaboratorsVo> {
    const shareInfo = req.shareInfo as IShareViewInfo;
    return this.shareService.getViewCollaborators(shareInfo, query);
  }

  @UseGuards(ShareAuthGuard)
  @Get('/:shareId/view/search-count')
  async getSearchCount(
    @Request() req: any,
    @Query(new ZodValidationPipe(searchCountRoSchema))
    queryRo: ISearchCountRo
  ): Promise<ISearchCountVo> {
    const { tableId, view } = req.shareInfo as IShareViewInfo;
    return this.shareService.getShareSearchCount(tableId, { ...queryRo, viewId: view?.id });
  }

  @UseGuards(ShareAuthGuard)
  @Get('/:shareId/view/search-index')
  async getSearchIndex(
    @Request() req: any,
    @Query(new ZodValidationPipe(searchIndexByQueryRoSchema))
    queryRo: ISearchIndexByQueryRo
  ): Promise<ISearchIndexVo> {
    const { tableId, view } = req.shareInfo as IShareViewInfo;
    return this.shareService.getShareSearchIndex(tableId, { ...queryRo, viewId: view?.id });
  }

  @UseGuards(ShareAuthGuard)
  @Get('/:shareId/socket/view/snapshot-bulk')
  async getViewSnapshotBulk(@Request() req: any, @Query('ids') ids: string[]) {
    const shareInfo = req.shareInfo as IShareViewInfo;
    return this.shareSocketService.getViewSnapshotBulk(shareInfo, ids);
  }

  @UseGuards(ShareAuthGuard)
  @Get('/:shareId/socket/view/doc-ids')
  async getViewDocIds(@Request() req: any) {
    const shareInfo = req.shareInfo as IShareViewInfo;
    return this.shareSocketService.getViewDocIdsByQuery(shareInfo);
  }

  @UseGuards(ShareAuthGuard)
  @Get('/:shareId/socket/field/snapshot-bulk')
  async getFieldSnapshotBulk(@Request() req: any, @Query('ids') ids: string[]) {
    const shareInfo = req.shareInfo as IShareViewInfo;
    return this.shareSocketService.getFieldSnapshotBulk(shareInfo, ids);
  }

  @UseGuards(ShareAuthGuard)
  @Get('/:shareId/socket/field/doc-ids')
  async getFieldDocIds(
    @Request() req: any,
    @Query(new ZodValidationPipe(getFieldsQuerySchema)) query: IGetFieldsQuery
  ) {
    const shareInfo = req.shareInfo as IShareViewInfo;

    return this.shareSocketService.getFieldDocIdsByQuery(shareInfo, query);
  }

  @UseGuards(ShareAuthGuard)
  @Get('/:shareId/socket/record/snapshot-bulk')
  async getRecordSnapshotBulk(@Request() req: any, @Query('ids') ids: string[]) {
    const shareInfo = req.shareInfo as IShareViewInfo;
    return this.shareSocketService.getRecordSnapshotBulk(shareInfo, ids);
  }

  @UseGuards(ShareAuthGuard)
  @Get('/:shareId/socket/record/doc-ids')
  async getRecordDocIds(
    @Request() req: any,
    @Query(new ZodValidationPipe(getRecordsRoSchema), TqlPipe) query: IGetRecordsRo
  ) {
    const shareInfo = req.shareInfo as IShareViewInfo;
    return this.shareSocketService.getRecordDocIdsByQuery(shareInfo, query);
  }
}
