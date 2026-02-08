/* eslint-disable sonarjs/no-duplicate-string */
import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Query,
  Headers,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
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
import { ClsService } from 'nestjs-cls';
import type { IClsStore } from '../../types/cls';
import { ZodValidationPipe } from '../../zod.validation.pipe';
import { Permissions } from '../auth/decorators/permissions.decorator';
import { UseV2Feature } from '../canary/decorators/use-v2-feature.decorator';
import { V2FeatureGuard } from '../canary/guards/v2-feature.guard';
import { V2IndicatorInterceptor } from '../canary/interceptors/v2-indicator.interceptor';
import { RecordOpenApiV2Service } from '../record/open-api/record-open-api-v2.service';
import { TqlPipe } from '../record/open-api/tql.pipe';
import { SelectionService } from './selection.service';

@UseGuards(V2FeatureGuard)
@UseInterceptors(V2IndicatorInterceptor)
@Controller('api/table/:tableId/selection')
export class SelectionController {
  constructor(
    private selectionService: SelectionService,
    private readonly recordOpenApiV2Service: RecordOpenApiV2Service,
    private readonly cls: ClsService<IClsStore>
  ) {}

  @Permissions('record|read')
  @Get('/range-to-id')
  async getIdsFromRanges(
    @Param('tableId') tableId: string,
    @Query(new ZodValidationPipe(rangesToIdQuerySchema), TqlPipe) query: IRangesToIdQuery
  ): Promise<IRangesToIdVo> {
    return this.selectionService.getIdsFromRanges(tableId, query);
  }

  @Permissions('record|read', 'record|copy')
  @Get('/copy')
  async copy(
    @Param('tableId') tableId: string,
    @Query(new ZodValidationPipe(rangesQuerySchema), TqlPipe) query: IRangesRo
  ): Promise<ICopyVo> {
    return this.selectionService.copy(tableId, query);
  }

  @UseV2Feature('paste')
  @Permissions('record|update')
  @Patch('/paste')
  async paste(
    @Param('tableId') tableId: string,
    @Body(new ZodValidationPipe(pasteRoSchema), TqlPipe) pasteRo: IPasteRo,
    @Headers('x-window-id') windowId?: string
  ): Promise<IPasteVo> {
    // Use V2 logic when canary config enables it for this space + feature
    if (this.cls.get('useV2')) {
      return this.recordOpenApiV2Service.paste(tableId, pasteRo, { windowId });
    }

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

  @UseV2Feature('clear')
  @Permissions('record|update')
  @Patch('/clear')
  async clear(
    @Param('tableId') tableId: string,
    @Body(new ZodValidationPipe(rangesRoSchema), TqlPipe) rangesRo: IRangesRo,
    @Headers('x-window-id') windowId?: string
  ) {
    // Use V2 logic when canary config enables it for this space + feature
    if (this.cls.get('useV2')) {
      return this.recordOpenApiV2Service.clear(tableId, rangesRo);
    }

    await this.selectionService.clear(tableId, rangesRo, {
      windowId,
    });
    return null;
  }

  @UseV2Feature('deleteRecord')
  @Permissions('record|delete')
  @Delete('/delete')
  async delete(
    @Param('tableId') tableId: string,
    @Query(new ZodValidationPipe(rangesQuerySchema), TqlPipe) rangesRo: IRangesRo,
    @Headers('x-window-id') windowId?: string
  ): Promise<IDeleteVo> {
    // Use V2 logic when canary config enables it for this space + feature
    if (this.cls.get('useV2')) {
      return this.recordOpenApiV2Service.deleteByRange(tableId, rangesRo);
    }

    return this.selectionService.delete(tableId, rangesRo, {
      windowId,
    });
  }
}
