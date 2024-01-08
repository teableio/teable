import { Body, Controller, Get, Param, Patch, Query, Req, UseGuards } from '@nestjs/common';
import type { User as UserModel } from '@teable-group/db-main-prisma';
import type { ICopyVo, IRangesToIdVo, PasteVo } from '@teable-group/openapi';
import {
  IRangesToIdRo,
  rangesToIdRoSchema,
  ClearRo,
  clearRoSchema,
  ICopyRo,
  rangesSchema,
  PasteRo,
  pasteRoSchema,
} from '@teable-group/openapi';
import { Request } from 'express';
import { ZodValidationPipe } from '../../zod.validation.pipe';
import { Permissions } from '../auth/decorators/permissions.decorator';
import { PermissionGuard } from '../auth/guard/permission.guard';
import { SelectionService } from './selection.service';

@Controller('api/table/:tableId/view/:viewId/selection')
@UseGuards(PermissionGuard)
export class SelectionController {
  constructor(private selectionService: SelectionService) {}

  @Permissions('view|read')
  @Get('/rangeToId')
  async getIdsFromRanges(
    @Req() req: Request,
    @Param('tableId') tableId: string,
    @Param('viewId') viewId: string,
    @Query(new ZodValidationPipe(rangesToIdRoSchema)) query: IRangesToIdRo
  ): Promise<IRangesToIdVo> {
    const { id: queryUserId } = req.user as UserModel;
    return this.selectionService.getIdsFromRanges(tableId, viewId, { ...query, queryUserId });
  }

  @Permissions('view|read')
  @Get('/copy')
  async copy(
    @Req() req: Request,
    @Param('tableId') tableId: string,
    @Param('viewId') viewId: string,
    @Query(new ZodValidationPipe(rangesSchema)) query: ICopyRo
  ): Promise<ICopyVo> {
    const { id: queryUserId } = req.user as UserModel;
    return this.selectionService.copy(tableId, viewId, { ...query, queryUserId });
  }

  @Permissions('record|update')
  @Patch('/paste')
  async paste(
    @Req() req: Request,
    @Param('tableId') tableId: string,
    @Param('viewId') viewId: string,
    @Body(new ZodValidationPipe(pasteRoSchema))
    pasteRo: PasteRo
  ): Promise<PasteVo> {
    const { id: queryUserId } = req.user as UserModel;
    const ranges = await this.selectionService.paste(tableId, viewId, { ...pasteRo, queryUserId });
    return { ranges };
  }

  @Permissions('record|update')
  @Patch('/clear')
  async clear(
    @Req() req: Request,
    @Param('tableId') tableId: string,
    @Param('viewId') viewId: string,
    @Body(new ZodValidationPipe(clearRoSchema))
    clearRo: ClearRo
  ) {
    const { id: queryUserId } = req.user as UserModel;
    await this.selectionService.clear(tableId, viewId, clearRo);
    return null;
  }
}
