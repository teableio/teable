import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CopyAndPasteSchema } from '@teable-group/openapi';
import { responseWrap } from '../../utils';
import { ZodValidationPipe } from '../../zod.validation.pipe';
import { CopyPasteService } from './copy-paste.service';

@ApiBearerAuth()
@ApiTags('copyPaste')
@Controller('api/table/:tableId/view/:viewId/copy-paste')
export class CopyPasteController {
  constructor(private copyPasteService: CopyPasteService) {}

  @Get('/copy')
  async copy(
    @Param('tableId') tableId: string,
    @Param('viewId') viewId: string,
    @Query(new ZodValidationPipe(CopyAndPasteSchema.copyRoSchema)) query: CopyAndPasteSchema.CopyRo
  ) {
    const copyContent = await this.copyPasteService.copy(tableId, viewId, query);
    return responseWrap(copyContent);
  }

  @Post('/paste')
  async paste(
    @Param('tableId') tableId: string,
    @Param('viewId') viewId: string,
    @Body(new ZodValidationPipe(CopyAndPasteSchema.pasteRoSchema))
    pasteRo: CopyAndPasteSchema.PasteRo
  ) {
    await this.copyPasteService.paste(tableId, viewId, pasteRo);
    return responseWrap(null);
  }
}
