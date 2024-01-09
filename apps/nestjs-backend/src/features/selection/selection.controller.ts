import { Body, Controller, Get, Param, Patch, Query, UseGuards } from '@nestjs/common';
import type { ICopyVo, IRangesToIdVo, PasteVo } from '@teable-group/openapi';
import {
  ClearRo,
  clearRoSchema,
  ICopyRo,
  IRangesToIdRo,
  PasteRo,
  pasteRoSchema,
  rangesSchema,
  rangesToIdRoSchema,
} from '@teable-group/openapi';
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
    @Param('tableId') tableId: string,
    @Param('viewId') viewId: string,
    @Query(new ZodValidationPipe(rangesToIdRoSchema)) query: IRangesToIdRo
  ): Promise<IRangesToIdVo> {
    return this.selectionService.getIdsFromRanges(tableId, viewId, query);
  }

  @Permissions('view|read')
  @Get('/copy')
  async copy(
    @Param('tableId') tableId: string,
    @Param('viewId') viewId: string,
    @Query(new ZodValidationPipe(rangesSchema)) query: ICopyRo
  ): Promise<ICopyVo> {
    return this.selectionService.copy(tableId, viewId, query);
  }

  @Permissions('record|update')
  @Patch('/paste')
  async paste(
    @Param('tableId') tableId: string,
    @Param('viewId') viewId: string,
    @Body(new ZodValidationPipe(pasteRoSchema))
    pasteRo: PasteRo
  ): Promise<PasteVo> {
    const ranges = await this.selectionService.paste(tableId, viewId, pasteRo);
    return { ranges };
  }

  @Permissions('record|update')
  @Patch('/clear')
  async clear(
    @Param('tableId') tableId: string,
    @Param('viewId') viewId: string,
    @Body(new ZodValidationPipe(clearRoSchema))
    clearRo: ClearRo
  ) {
    await this.selectionService.clear(tableId, viewId, clearRo);
    return null;
  }
}
