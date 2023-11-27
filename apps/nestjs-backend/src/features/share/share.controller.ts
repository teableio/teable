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
  type IViewAggregationVo,
  type IViewRowCountVo,
  viewRowCountRoSchema,
  IViewRowCountRo,
} from '@teable-group/core';
import {
  ShareViewFormSubmitRo,
  shareViewCopyRoSchema,
  shareViewFormSubmitRoSchema,
  IShareViewCopyRo,
  shareViewAggregationsRoSchema,
  IShareViewAggregationsRo,
} from '@teable-group/openapi';
import type {
  IShareViewCopyVo,
  ShareViewFormSubmitVo,
  ShareViewGetVo,
} from '@teable-group/openapi';
import { Response } from 'express';
import { ZodValidationPipe } from '../../zod.validation.pipe';
import { Public } from '../auth/decorators/public.decorator';
import { AuthGuard } from './guard/auth.guard';
import { ShareAuthLocalGuard } from './guard/share-auth-local.guard';
import type { IShareViewInfo } from './share.service';
import { ShareService } from './share.service';

@Controller('api/share')
@Public()
export class ShareController {
  constructor(private readonly shareService: ShareService) {}

  @HttpCode(200)
  @UseGuards(ShareAuthLocalGuard)
  @Post('/:shareId/view/auth')
  async auth(@Request() req: any, @Res({ passthrough: true }) res: Response) {
    const shareId = req.shareId;
    const token = await this.shareService.authToken(shareId);
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
    @Query(new ZodValidationPipe(shareViewAggregationsRoSchema)) query?: IShareViewAggregationsRo
  ): Promise<IViewAggregationVo> {
    const shareInfo = req.shareInfo as IShareViewInfo;
    return await this.shareService.getViewAggregations(shareInfo, query);
  }

  @UseGuards(AuthGuard)
  @Get('/:shareId/view/rowCount')
  async getViewRowCount(
    @Request() req: any,
    @Query(new ZodValidationPipe(viewRowCountRoSchema)) query?: IViewRowCountRo
  ): Promise<IViewRowCountVo> {
    const shareInfo = req.shareInfo as IShareViewInfo;
    return await this.shareService.getViewRowCount(shareInfo, query);
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
}
