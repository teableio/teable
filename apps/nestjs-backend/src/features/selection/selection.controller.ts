/* eslint-disable sonarjs/no-duplicate-string */
import { Body, Controller, Delete, Get, Param, Patch, Query, Headers } from '@nestjs/common';
import type {
  ICopyVo,
  IRangesToIdVo,
  IPasteVo,
  IDeleteVo,
  ITemporaryPasteVo,
} from '@teable/openapi';
import {
  IRangesToIdQuery,
  rangesToIdQuerySchema,
  rangesQuerySchema,
  IPasteRo,
  pasteRoSchema,
  rangesRoSchema,
  IRangesRo,
  temporaryPasteRoSchema,
  ITemporaryPasteRo,
} from '@teable/openapi';
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
    @Body(new ZodValidationPipe(pasteRoSchema), TqlPipe) pasteRo: IPasteRo,
    @Headers('x-window-id') windowId?: string
  ): Promise<IPasteVo> {
    const ranges = await this.selectionService.paste(tableId, pasteRo, {
      windowId,
    });
    return { ranges };
  }

  @Permissions('record|read')
  @Patch('/temporaryPaste')
  async temporaryPaste(
    @Param('tableId') tableId: string,
    @Body(new ZodValidationPipe(temporaryPasteRoSchema), TqlPipe)
    temporaryPasteRo: ITemporaryPasteRo
  ): Promise<ITemporaryPasteVo> {
    return await this.selectionService.temporaryPaste(tableId, temporaryPasteRo);
  }

  @Permissions('record|update')
  @Patch('/clear')
  async clear(
    @Param('tableId') tableId: string,
    @Body(new ZodValidationPipe(rangesRoSchema), TqlPipe) rangesRo: IRangesRo,
    @Headers('x-window-id') windowId?: string
  ) {
    await this.selectionService.clear(tableId, rangesRo, {
      windowId,
    });
    return null;
  }

  @Permissions('record|delete')
  @Delete('/delete')
  async delete(
    @Param('tableId') tableId: string,
    @Query(new ZodValidationPipe(rangesQuerySchema), TqlPipe) rangesRo: IRangesRo,
    @Headers('x-window-id') windowId?: string
  ): Promise<IDeleteVo> {
    return this.selectionService.delete(tableId, rangesRo, {
      windowId,
    });
  }
}
