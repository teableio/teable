import { Body, Controller, Get, Param, Patch, Query } from '@nestjs/common';
import type { ICopyVo, IRangesToIdVo, IPasteVo } from '@teable-group/openapi';
import {
  IRangesToIdQuery,
  rangesToIdQuerySchema,
  rangesQuerySchema,
  IPasteRo,
  pasteRoSchema,
  rangesRoSchema,
  IRangesRo,
} from '@teable-group/openapi';
import { ZodValidationPipe } from '../../zod.validation.pipe';
import { Permissions } from '../auth/decorators/permissions.decorator';
import { TqlPipe } from '../record/open-api/tql.pipe';
import { SelectionService } from './selection.service';

@Controller('api/table/:tableId/selection')
export class SelectionController {
  constructor(private selectionService: SelectionService) {}

  @Permissions('record|read')
  @Get('/range-to-id')
  async getIdsFromRanges(
    @Param('tableId') tableId: string,
    @Query(new ZodValidationPipe(rangesToIdQuerySchema), TqlPipe) query: IRangesToIdQuery
  ): Promise<IRangesToIdVo> {
    return this.selectionService.getIdsFromRanges(tableId, query);
  }

  @Permissions('record|read')
  @Get('/copy')
  async copy(
    @Param('tableId') tableId: string,
    @Query(new ZodValidationPipe(rangesQuerySchema), TqlPipe) query: IRangesRo
  ): Promise<ICopyVo> {
    return this.selectionService.copy(tableId, query);
  }

  @Permissions('record|update')
  @Patch('/paste')
  async paste(
    @Param('tableId') tableId: string,
    @Body(new ZodValidationPipe(pasteRoSchema), TqlPipe)
    pasteRo: IPasteRo
  ): Promise<IPasteVo> {
    const ranges = await this.selectionService.paste(tableId, pasteRo);
    return { ranges };
  }

  @Permissions('record|update')
  @Patch('/clear')
  async clear(
    @Param('tableId') tableId: string,
    @Body(new ZodValidationPipe(rangesRoSchema), TqlPipe)
    rangesRo: IRangesRo
  ) {
    await this.selectionService.clear(tableId, rangesRo);
    return null;
  }
}
