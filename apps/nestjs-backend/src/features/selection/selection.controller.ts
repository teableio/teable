import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import type { CopyVo, PasteVo } from '@teable-group/openapi';
import {
  ClearRo,
  clearRoSchema,
  CopyRo,
  copyRoSchema,
  PasteRo,
  pasteRoSchema,
} from '@teable-group/openapi';
import { ZodValidationPipe } from '../../zod.validation.pipe';
import { SelectionService } from './selection.service';

@Controller('api/table/:tableId/view/:viewId/selection')
export class SelectionController {
  constructor(private selectionService: SelectionService) {}

  @Get('/copy')
  async copy(
    @Param('tableId') tableId: string,
    @Param('viewId') viewId: string,
    @Query(new ZodValidationPipe(copyRoSchema)) query: CopyRo
  ): Promise<CopyVo> {
    return await this.selectionService.copy(tableId, viewId, query);
  }

  @Post('/paste')
  async paste(
    @Param('tableId') tableId: string,
    @Param('viewId') viewId: string,
    @Body(new ZodValidationPipe(pasteRoSchema))
    pasteRo: PasteRo
  ): Promise<PasteVo> {
    const ranges = await this.selectionService.paste(tableId, viewId, pasteRo);
    return { ranges };
  }

  @Post('/clear')
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
