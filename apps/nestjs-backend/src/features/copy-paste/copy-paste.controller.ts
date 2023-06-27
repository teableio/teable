import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { responseWrap } from '../../../src/utils';
import { CopyPasteService } from './copy-paste.service';
import { CopyRo } from './modal/copy.ro';
import { PasteRo } from './modal/paste.ro';

@ApiBearerAuth()
@ApiTags('copyPaste')
@Controller('api/table/:tableId/view/:viewId/copy-paste')
export class CopyPasteController {
  constructor(private copyPasteService: CopyPasteService) {}

  @Get('/copy')
  async copy(
    @Param('tableId') tableId: string,
    @Param('viewId') viewId: string,
    @Query() query: CopyRo
  ) {
    const copyContent = await this.copyPasteService.copy(tableId, viewId, query);
    return responseWrap(copyContent);
  }

  @Post('/paste')
  async paste(
    @Param('tableId') tableId: string,
    @Param('viewId') viewId: string,
    @Body() pasteVo: PasteRo
  ) {
    await this.copyPasteService.paste(tableId, viewId, pasteVo);
    return responseWrap(null);
  }
}
