import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { SelectionSchema } from '@teable-group/openapi';
import type { ApiResponse } from '../../utils';
import { responseWrap } from '../../utils';
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
  ): Promise<ApiResponse<SelectionSchema.CopyVo>> {
    const res = await this.selectionService.copy(tableId, viewId, query);
    return responseWrap(res);
  }

  @Post('/paste')
  async paste(
    @Param('tableId') tableId: string,
    @Param('viewId') viewId: string,
    @Body(new ZodValidationPipe(SelectionSchema.pasteRoSchema))
    pasteRo: SelectionSchema.PasteRo
  ): Promise<ApiResponse<SelectionSchema.PasteVo>> {
    const ranges = await this.selectionService.paste(tableId, viewId, pasteRo);
    return responseWrap({ ranges });
  }

  @Post('/clear')
  async clear(
    @Param('tableId') tableId: string,
    @Param('viewId') viewId: string,
    @Body(new ZodValidationPipe(SelectionSchema.clearRoSchema))
    clearRo: SelectionSchema.ClearRo
  ) {
    await this.selectionService.clear(tableId, viewId, clearRo);
    return responseWrap(null);
  }
}
