/* eslint-disable @typescript-eslint/no-explicit-any */
import {
  Controller,
  HttpCode,
  Post,
  Res,
  UseGuards,
  Request,
  Get,
  Param,
  Body,
  Query,
} from '@nestjs/common';
import {
  ShareViewFormSubmitRo,
  shareViewFormSubmitRoSchema,
  shareViewRowCountRoSchema,
  shareViewAggregationsRoSchema,
  shareViewLinkRecordsRoSchema,
  shareViewGroupPointsRoSchema,
  IShareViewLinkRecordsRo,
  IShareViewRowCountRo,
  IShareViewGroupPointsRo,
  IShareViewAggregationsRo,
  rangesQuerySchema,
  IRangesRo,
} from '@teable/openapi';
import type {
  IRecord,
  IAggregationVo,
  IRowCountVo,
  IGroupPointsVo,
  ICopyVo,
  IShareViewLinkRecordsVo,
  ShareViewGetVo,
} from '@teable/openapi';
import { Response } from 'express';
import { ZodValidationPipe } from '../../zod.validation.pipe';
import { Public } from '../auth/decorators/public.decorator';
import { TqlPipe } from '../record/open-api/tql.pipe';
import { AuthGuard } from './guard/auth.guard';
import { ShareAuthLocalGuard } from './guard/share-auth-local.guard';
import { ShareAuthService } from './share-auth.service';
import type { IShareViewInfo } from './share.service';
import { ShareService } from './share.service';

@Controller('api/share')
@Public()
export class ShareController {
  constructor(
    private readonly shareService: ShareService,
    private readonly shareAuthService: ShareAuthService
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

  @UseGuards(AuthGuard)
  @Get('/:shareId/view')
  async getShareView(@Param('shareId') shareId: string): Promise<ShareViewGetVo> {
    return await this.shareService.getShareView(shareId);
  }

  @UseGuards(AuthGuard)
  @Get('/:shareId/view/aggregations')
  async getViewAggregations(
    @Request() req: any,
    @Query(new ZodValidationPipe(shareViewAggregationsRoSchema), TqlPipe)
    query?: IShareViewAggregationsRo
  ): Promise<IAggregationVo> {
    const shareInfo = req.shareInfo as IShareViewInfo;
    return await this.shareService.getViewAggregations(shareInfo, query);
  }

  @UseGuards(AuthGuard)
  @Get('/:shareId/view/row-count')
  async getViewRowCount(
    @Request() req: any,
    @Query(new ZodValidationPipe(shareViewRowCountRoSchema), TqlPipe)
    query?: IShareViewRowCountRo
  ): Promise<IRowCountVo> {
    const shareInfo = req.shareInfo as IShareViewInfo;
    return await this.shareService.getViewRowCount(shareInfo, query);
  }

  @UseGuards(AuthGuard)
  @Post('/:shareId/view/form-submit')
  async submitRecord(
    @Request() req: any,
    @Body(new ZodValidationPipe(shareViewFormSubmitRoSchema))
    shareViewFormSubmitRo: ShareViewFormSubmitRo
  ): Promise<IRecord> {
    const shareInfo = req.shareInfo as IShareViewInfo;
    return await this.shareService.formSubmit(shareInfo, shareViewFormSubmitRo);
  }

  @UseGuards(AuthGuard)
  @Get('/:shareId/view/copy')
  async copy(
    @Request() req: any,
    @Query(new ZodValidationPipe(rangesQuerySchema), TqlPipe) shareViewCopyRo: IRangesRo
  ): Promise<ICopyVo> {
    const shareInfo = req.shareInfo as IShareViewInfo;
    return this.shareService.copy(shareInfo, shareViewCopyRo);
  }

  @UseGuards(AuthGuard)
  @Get('/:shareId/view/link-records')
  async linkRecords(
    @Request() req: any,
    @Query(new ZodValidationPipe(shareViewLinkRecordsRoSchema), TqlPipe)
    shareViewLinkRecordsRo: IShareViewLinkRecordsRo
  ): Promise<IShareViewLinkRecordsVo> {
    const shareInfo = req.shareInfo as IShareViewInfo;
    return this.shareService.getLinkRecords(shareInfo, shareViewLinkRecordsRo);
  }

  @UseGuards(AuthGuard)
  @Get('/:shareId/view/group-points')
  async getViewGroupPoints(
    @Request() req: any,
    @Query(new ZodValidationPipe(shareViewGroupPointsRoSchema))
    query?: IShareViewGroupPointsRo
  ): Promise<IGroupPointsVo> {
    const shareInfo = req.shareInfo as IShareViewInfo;
    return await this.shareService.getViewGroupPoints(shareInfo, query);
  }
}
