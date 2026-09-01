/* eslint-disable @typescript-eslint/no-explicit-any */
import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  Query,
  Request,
  Res,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { IGetFieldsQuery, getFieldsQuerySchema } from '@teable/core';
import {
  ShareViewFormSubmitRo,
  shareViewFormSubmitRoSchema,
  shareViewRowCountRoSchema,
  shareViewAggregationsRoSchema,
  shareViewGroupPointsRoSchema,
  shareViewRecordsRoSchema,
  IShareViewRowCountRo,
  IShareViewGroupPointsRo,
  IShareViewAggregationsRo,
  IShareViewRecordsRo,
  shareViewCopyQuerySchema,
  IShareViewCopyQuery,
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
  IButtonClickVo,
  IRecordsVo,
} from '@teable/openapi';
import { Response } from 'express';
import { ZodValidationPipe } from '../../zod.validation.pipe';
import { AllowAnonymous } from '../auth/decorators/allow-anonymous.decorator';
import { Public } from '../auth/decorators/public.decorator';
import { UseV2Feature } from '../canary/decorators/use-v2-feature.decorator';
import { V2FeatureGuard } from '../canary/guards/v2-feature.guard';
import { V2IndicatorInterceptor } from '../canary/interceptors/v2-indicator.interceptor';
import { TqlPipe } from '../record/open-api/tql.pipe';
import { SpaceDataDbMigrationGuardService } from '../space/space-data-db-migration-guard.service';
import { ShareAuthGuard } from './guard/auth.guard';
import { ShareLinkView } from './guard/link-view.decorator';
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
    private readonly shareSocketService: ShareSocketService,
    protected readonly spaceDataDbMigrationGuardService: SpaceDataDbMigrationGuardService
  ) {}

  @HttpCode(200)
  @UseV2Feature('getSharedView')
  @UseGuards(V2FeatureGuard, ShareAuthLocalGuard)
  @UseInterceptors(V2IndicatorInterceptor)
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

  @ShareLinkView()
  @UseV2Feature('getSharedView')
  @UseGuards(V2FeatureGuard, ShareAuthGuard)
  @UseInterceptors(V2IndicatorInterceptor)
  @AllowAnonymous()
  @Get('/:shareId/view')
  async getShareView(@Request() req?: any): Promise<ShareViewGetVo> {
    const shareInfo = req.shareInfo as IShareViewInfo;
    if (req.useV2) {
      return this.shareService.getShareViewV2(shareInfo);
    }
    return this.shareService.getShareView(shareInfo);
  }

  @ShareLinkView()
  @UseV2Feature('getSharedViewAggregations')
  @UseGuards(V2FeatureGuard, ShareAuthGuard)
  @UseInterceptors(V2IndicatorInterceptor)
  @AllowAnonymous()
  @Get('/:shareId/view/aggregations')
  async getViewAggregations(
    @Request() req: any,
    @Query(new ZodValidationPipe(shareViewAggregationsRoSchema), TqlPipe)
    query?: IShareViewAggregationsRo
  ): Promise<IAggregationVo> {
    const shareInfo = req.shareInfo as IShareViewInfo;
    if (req.useV2) {
      return this.shareService.getViewAggregationsV2(shareInfo, query);
    }
    return this.shareService.getViewAggregations(shareInfo, query);
  }

  @ShareLinkView()
  @UseV2Feature('getSharedViewRowCount')
  @UseGuards(V2FeatureGuard, ShareAuthGuard)
  @UseInterceptors(V2IndicatorInterceptor)
  @AllowAnonymous()
  @Get('/:shareId/view/row-count')
  async getViewRowCount(
    @Request() req: any,
    @Query(new ZodValidationPipe(shareViewRowCountRoSchema), TqlPipe)
    query?: IShareViewRowCountRo
  ): Promise<IRowCountVo> {
    const shareInfo = req.shareInfo as IShareViewInfo;
    if (req.useV2) {
      return this.shareService.getViewRowCountV2(shareInfo, query);
    }
    return this.shareService.getViewRowCount(shareInfo, query);
  }

  @ShareLinkView()
  @UseV2Feature('getSharedViewRecords')
  @UseGuards(V2FeatureGuard, ShareAuthGuard)
  @UseInterceptors(V2IndicatorInterceptor)
  @AllowAnonymous()
  @Get('/:shareId/view/records')
  async getViewRecords(
    @Request() req: any,
    @Query(new ZodValidationPipe(shareViewRecordsRoSchema), TqlPipe)
    query?: IShareViewRecordsRo
  ): Promise<IRecordsVo> {
    const shareInfo = req.shareInfo as IShareViewInfo;
    if (req.useV2) {
      return this.shareService.getViewRecordsV2(shareInfo, query);
    }
    return this.shareService.getViewRecords(shareInfo, query);
  }

  @ShareSubmit()
  @UseV2Feature('formSubmit')
  @UseGuards(V2FeatureGuard, ShareAuthGuard)
  @UseInterceptors(V2IndicatorInterceptor)
  @Post('/:shareId/view/form-submit')
  async submitRecord(
    @Request() req: any,
    @Body(new ZodValidationPipe(shareViewFormSubmitRoSchema))
    shareViewFormSubmitRo: ShareViewFormSubmitRo
  ): Promise<IRecord> {
    const shareInfo = req.shareInfo as IShareViewInfo;
    return this.shareService.formSubmit(shareInfo, shareViewFormSubmitRo);
  }

  @UseV2Feature('getSharedViewCopy')
  @UseGuards(V2FeatureGuard, ShareAuthGuard)
  @UseInterceptors(V2IndicatorInterceptor)
  @AllowAnonymous()
  @Get('/:shareId/view/copy')
  async copy(
    @Request() req: any,
    @Query(new ZodValidationPipe(shareViewCopyQuerySchema), TqlPipe)
    shareViewCopyRo: IShareViewCopyQuery
  ): Promise<ICopyVo> {
    const shareInfo = req.shareInfo as IShareViewInfo;
    if (req.useV2) {
      return this.shareService.copyV2(shareInfo, shareViewCopyRo);
    }
    return this.shareService.copy(shareInfo, shareViewCopyRo);
  }

  @ShareLinkView()
  @UseV2Feature('getSharedViewGroupPoints')
  @UseGuards(V2FeatureGuard, ShareAuthGuard)
  @UseInterceptors(V2IndicatorInterceptor)
  @AllowAnonymous()
  @Get('/:shareId/view/group-points')
  async getViewGroupPoints(
    @Request() req: any,
    @Query(new ZodValidationPipe(shareViewGroupPointsRoSchema))
    query?: IShareViewGroupPointsRo
  ): Promise<IGroupPointsVo> {
    const shareInfo = req.shareInfo as IShareViewInfo;
    if (req.useV2) {
      return this.shareService.getViewGroupPointsV2(shareInfo, query);
    }
    return this.shareService.getViewGroupPoints(shareInfo, query);
  }

  @ShareLinkView()
  @UseV2Feature('getSharedViewCalendarDailyCollection')
  @UseGuards(V2FeatureGuard, ShareAuthGuard)
  @UseInterceptors(V2IndicatorInterceptor)
  @AllowAnonymous()
  @Get('/:shareId/view/calendar-daily-collection')
  async getViewCalendarDailyCollection(
    @Request() req: any,
    @Query(new ZodValidationPipe(shareViewCalendarDailyCollectionRoSchema))
    query: IShareViewCalendarDailyCollectionRo
  ): Promise<ICalendarDailyCollectionVo> {
    const shareInfo = req.shareInfo as IShareViewInfo;
    if (req.useV2) {
      return this.shareService.getViewCalendarDailyCollectionV2(shareInfo, query);
    }
    return this.shareService.getViewCalendarDailyCollection(shareInfo, query);
  }

  @UseV2Feature('getSharedViewLinkRecords')
  @UseGuards(V2FeatureGuard, ShareAuthGuard)
  @UseInterceptors(V2IndicatorInterceptor)
  @AllowAnonymous()
  @Get('/:shareId/view/link-records')
  async viewLinkRecords(
    @Request() req: any,
    @Query(new ZodValidationPipe(shareViewLinkRecordsRoSchema))
    shareViewLinkRecordsRo: IShareViewLinkRecordsRo
  ): Promise<IShareViewLinkRecordsVo> {
    const shareInfo = req.shareInfo as IShareViewInfo;
    if (req.useV2) {
      return this.shareService.getViewLinkRecordsV2(shareInfo, shareViewLinkRecordsRo);
    }
    return this.shareService.getViewLinkRecords(shareInfo, shareViewLinkRecordsRo);
  }

  @UseV2Feature('getSharedViewCollaborators')
  @UseGuards(V2FeatureGuard, ShareAuthGuard)
  @UseInterceptors(V2IndicatorInterceptor)
  @Get('/:shareId/view/collaborators')
  async getViewCollaborators(
    @Request() req: any,
    @Query(new ZodValidationPipe(shareViewCollaboratorsRoSchema)) query: IShareViewCollaboratorsRo
  ): Promise<IShareViewCollaboratorsVo> {
    const shareInfo = req.shareInfo as IShareViewInfo;
    if (req.useV2) {
      return this.shareService.getViewCollaboratorsV2(shareInfo, query);
    }
    return this.shareService.getViewCollaborators(shareInfo, query);
  }

  @UseV2Feature('getSharedViewSearchCount')
  @UseGuards(V2FeatureGuard, ShareAuthGuard)
  @UseInterceptors(V2IndicatorInterceptor)
  @Get('/:shareId/view/search-count')
  async getSearchCount(
    @Request() req: any,
    @Query(new ZodValidationPipe(searchCountRoSchema))
    queryRo: ISearchCountRo
  ): Promise<ISearchCountVo> {
    const shareInfo = req.shareInfo as IShareViewInfo;
    await this.spaceDataDbMigrationGuardService.assertTableRecordSearchReadable(
      shareInfo.tableId,
      queryRo
    );
    if (req.useV2) {
      return this.shareService.getShareSearchCountV2(shareInfo, queryRo);
    }
    const { tableId, view } = shareInfo;
    return this.shareService.getShareSearchCount(tableId, { ...queryRo, viewId: view?.id });
  }

  @UseV2Feature('getSharedViewSearchIndex')
  @UseGuards(V2FeatureGuard, ShareAuthGuard)
  @UseInterceptors(V2IndicatorInterceptor)
  @Get('/:shareId/view/search-index')
  async getSearchIndex(
    @Request() req: any,
    @Query(new ZodValidationPipe(searchIndexByQueryRoSchema))
    queryRo: ISearchIndexByQueryRo
  ): Promise<ISearchIndexVo> {
    const shareInfo = req.shareInfo as IShareViewInfo;
    await this.spaceDataDbMigrationGuardService.assertTableRecordSearchReadable(
      shareInfo.tableId,
      queryRo
    );
    if (req.useV2) {
      return this.shareService.getShareSearchIndexV2(shareInfo, queryRo);
    }
    const { tableId, view } = shareInfo;
    return this.shareService.getShareSearchIndex(tableId, { ...queryRo, viewId: view?.id });
  }

  @UseV2Feature('buttonClick')
  @UseGuards(V2FeatureGuard, ShareAuthGuard)
  @UseInterceptors(V2IndicatorInterceptor)
  @Post('/:shareId/view/record/:recordId/:fieldId/button-click')
  async buttonClick(
    @Request() req: any,
    @Param('recordId') recordId: string,
    @Param('fieldId') fieldId: string
  ): Promise<IButtonClickVo> {
    const shareInfo = req.shareInfo as IShareViewInfo;
    const result = await this.shareService.buttonClick(shareInfo, recordId, fieldId);
    return { ...result, runId: '' };
  }

  @ShareLinkView()
  @UseV2Feature('getSharedViewSocketSnapshotBulk')
  @UseGuards(V2FeatureGuard, ShareAuthGuard)
  @UseInterceptors(V2IndicatorInterceptor)
  @AllowAnonymous()
  @Get('/:shareId/socket/view/snapshot-bulk')
  async getViewSnapshotBulk(@Request() req: any, @Query('ids') ids: string[]) {
    const shareInfo = req.shareInfo as IShareViewInfo;
    return this.shareSocketService.getViewSnapshotBulk(shareInfo, ids);
  }

  @ShareLinkView()
  @UseV2Feature('getSharedViewSocketDocIds')
  @UseGuards(V2FeatureGuard, ShareAuthGuard)
  @UseInterceptors(V2IndicatorInterceptor)
  @AllowAnonymous()
  @Get('/:shareId/socket/view/doc-ids')
  async getViewDocIds(@Request() req: any) {
    const shareInfo = req.shareInfo as IShareViewInfo;
    return this.shareSocketService.getViewDocIdsByQuery(shareInfo);
  }

  @ShareLinkView()
  @UseGuards(ShareAuthGuard)
  @AllowAnonymous()
  @Get('/:shareId/socket/field/snapshot-bulk')
  async getFieldSnapshotBulk(@Request() req: any, @Query('ids') ids: string[]) {
    const shareInfo = req.shareInfo as IShareViewInfo;
    return this.shareSocketService.getFieldSnapshotBulk(shareInfo, ids);
  }

  @ShareLinkView()
  @UseGuards(ShareAuthGuard)
  @AllowAnonymous()
  @Get('/:shareId/socket/field/doc-ids')
  async getFieldDocIds(
    @Request() req: any,
    @Query(new ZodValidationPipe(getFieldsQuerySchema)) query: IGetFieldsQuery
  ) {
    const shareInfo = req.shareInfo as IShareViewInfo;

    return this.shareSocketService.getFieldDocIdsByQuery(shareInfo, query);
  }

  @ShareLinkView()
  @UseGuards(ShareAuthGuard)
  @AllowAnonymous()
  @Get('/:shareId/socket/computed-activity/authorize')
  authorizeComputedActivityRead(
    @Request() req: { shareInfo: IShareViewInfo },
    @Query('tableId') tableId: string
  ): void {
    const { shareInfo } = req;
    this.shareSocketService.authorizeComputedActivityRead(shareInfo, tableId);
  }

  @ShareLinkView()
  @UseV2Feature('getSharedViewRecords')
  @UseGuards(V2FeatureGuard, ShareAuthGuard)
  @UseInterceptors(V2IndicatorInterceptor)
  @AllowAnonymous()
  @Post('/:shareId/socket/record/snapshot-bulk')
  async getRecordSnapshotBulk(
    @Request() req: any,
    @Body('ids') ids: string[],
    @Body('projection') projection?: { [fieldNameOrId: string]: boolean }
  ) {
    const shareInfo = req.shareInfo as IShareViewInfo;
    return this.shareSocketService.getRecordSnapshotBulk(shareInfo, ids, true, projection);
  }

  @ShareLinkView()
  @UseV2Feature('getSharedViewRecords')
  @UseGuards(V2FeatureGuard, ShareAuthGuard)
  @UseInterceptors(V2IndicatorInterceptor)
  @AllowAnonymous()
  @Post('/:shareId/socket/record/doc-ids')
  async getRecordDocIds(
    @Request() req: any,
    @Body(new ZodValidationPipe(getRecordsRoSchema), TqlPipe) query: IGetRecordsRo
  ) {
    const shareInfo = req.shareInfo as IShareViewInfo;
    await this.spaceDataDbMigrationGuardService.assertTableRecordSearchReadable(
      shareInfo.tableId,
      query
    );
    return this.shareSocketService.getRecordDocIdsByQuery(shareInfo, query, true);
  }
}
