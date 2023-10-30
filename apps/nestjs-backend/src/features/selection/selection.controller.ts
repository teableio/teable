import { Body, Controller, Get, Param, Patch, Query } from '@nestjs/common';
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
import { ZodValidationPipe } from '../../zod.validation.pipe';
import { SelectionService } from './selection.service';

@Controller('api/table/:tableId/view/:viewId/selection')
export class SelectionController {
  constructor(private selectionService: SelectionService) {}

  @Get('/getIdsFromRanges')
  async getIdsFromRanges(
    @Param('tableId') tableId: string,
    @Param('viewId') viewId: string,
    @Query(new ZodValidationPipe(rangesToIdRoSchema)) query: IRangesToIdRo
  ): Promise<IRangesToIdVo> {
    return this.selectionService.getIdsFromRanges(tableId, viewId, query);
  }

  @Get('/copy')
  async copy(
    @Param('tableId') tableId: string,
    @Param('viewId') viewId: string,
    @Query(new ZodValidationPipe(rangesSchema)) query: ICopyRo
  ): Promise<ICopyVo> {
    return this.selectionService.copy(tableId, viewId, query);
  }

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
