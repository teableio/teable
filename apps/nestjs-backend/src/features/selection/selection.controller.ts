import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { SelectionSchema } from '@teable-group/openapi';
import { ZodValidationPipe } from '../../zod.validation.pipe';
import { SelectionService } from './selection.service';

@Controller('api/table/:tableId/view/:viewId/selection')
export class SelectionController {
  constructor(private selectionService: SelectionService) {}

  @Get('/copy')
  async copy(
    @Param('tableId') tableId: string,
    @Param('viewId') viewId: string,
    @Query(new ZodValidationPipe(SelectionSchema.copyRoSchema)) query: SelectionSchema.CopyRo
  ): Promise<SelectionSchema.CopyVo> {
    return await this.selectionService.copy(tableId, viewId, query);
  }

  @Post('/paste')
  async paste(
    @Param('tableId') tableId: string,
    @Param('viewId') viewId: string,
    @Body(new ZodValidationPipe(SelectionSchema.pasteRoSchema))
    pasteRo: SelectionSchema.PasteRo
  ): Promise<SelectionSchema.PasteVo> {
    const ranges = await this.selectionService.paste(tableId, viewId, pasteRo);
    return { ranges };
  }

  @Post('/clear')
  async clear(
    @Param('tableId') tableId: string,
    @Param('viewId') viewId: string,
    @Body(new ZodValidationPipe(SelectionSchema.clearRoSchema))
    clearRo: SelectionSchema.ClearRo
  ) {
    await this.selectionService.clear(tableId, viewId, clearRo);
    return null;
  }
}
