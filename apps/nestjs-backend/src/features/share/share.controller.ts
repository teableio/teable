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
import { type IAggregationVo, type IRowCountVo } from '@teable-group/core';
import {
  ShareViewFormSubmitRo,
  shareViewCopyRoSchema,
  shareViewFormSubmitRoSchema,
  IShareViewCopyRo,
  shareViewRowCountQueryRoSchema,
  shareViewAggregationsQueryRoSchema,
  shareViewLinkRecordsRoSchema,
  IShareViewLinkRecordsRo,
  IShareViewRowCountQueryRo,
  IShareViewAggregationsQueryRo,
} from '@teable-group/openapi';
import type {
  IShareViewCopyVo,
  IShareViewLinkRecordsVo,
  ShareViewFormSubmitVo,
  ShareViewGetVo,
  IShareViewAggregationsQuery,
  IShareViewRowCountQuery,
} from '@teable-group/openapi';
import { Response } from 'express';
import { ZodValidationPipe } from '../../zod.validation.pipe';
import { Public } from '../auth/decorators/public.decorator';
import { RecordPipe } from '../record/open-api/record.pipe';
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
    @Query(new ZodValidationPipe(shareViewAggregationsQueryRoSchema))
    query?: IShareViewAggregationsQueryRo
  ): Promise<IAggregationVo> {
    const shareInfo = req.shareInfo as IShareViewInfo;
    return await this.shareService.getViewAggregations(
      shareInfo,
      query?.query as IShareViewAggregationsQuery
    );
  }

  @UseGuards(AuthGuard)
  @Get('/:shareId/view/rowCount')
  async getViewRowCount(
    @Request() req: any,
    @Query(new ZodValidationPipe(shareViewRowCountQueryRoSchema))
    query?: IShareViewRowCountQueryRo
  ): Promise<IRowCountVo> {
    const shareInfo = req.shareInfo as IShareViewInfo;
    return await this.shareService.getViewRowCount(
      shareInfo,
      query?.query as IShareViewRowCountQuery
    );
  }

  @UseGuards(AuthGuard)
  @Post('/:shareId/view/formSubmit')
  async submitRecord(
    @Request() req: any,
    @Body(new ZodValidationPipe(shareViewFormSubmitRoSchema))
    shareViewFormSubmitRo: ShareViewFormSubmitRo
  ): Promise<ShareViewFormSubmitVo> {
    const shareInfo = req.shareInfo as IShareViewInfo;
    return await this.shareService.formSubmit(shareInfo, shareViewFormSubmitRo);
  }

  @UseGuards(AuthGuard)
  @Get('/:shareId/view/copy')
  async copy(
    @Request() req: any,
    @Query(new ZodValidationPipe(shareViewCopyRoSchema)) shareViewCopyRo: IShareViewCopyRo
  ): Promise<IShareViewCopyVo> {
    const shareInfo = req.shareInfo as IShareViewInfo;
    return this.shareService.copy(shareInfo, shareViewCopyRo);
  }

  @UseGuards(AuthGuard)
  @Get('/:shareId/view/linkRecords')
  async linkRecords(
    @Request() req: any,
    @Query(new ZodValidationPipe(shareViewLinkRecordsRoSchema), RecordPipe)
    shareViewLinkRecordsRo: IShareViewLinkRecordsRo
  ): Promise<IShareViewLinkRecordsVo> {
    const shareInfo = req.shareInfo as IShareViewInfo;
    return this.shareService.getLinkRecords(shareInfo, shareViewLinkRecordsRo);
  }
}
