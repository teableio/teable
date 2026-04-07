/* eslint-disable sonarjs/no-duplicate-string */
import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  Param,
  Patch,
  Query,
  Res,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import type {
  IClearSelectionStreamEvent,
  ICopyVo,
  IDeleteSelectionStreamEvent,
  IDuplicateSelectionStreamEvent,
  IPasteSelectionStreamEvent,
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
  IdReturnType,
} from '@teable/openapi';
import { Response } from 'express';
import { ClsService } from 'nestjs-cls';
import {
  applyTraceResponseHeaders,
  setResponseHeaderIfPossible,
} from '../../tracing/trace-response-headers';
import type { IClsStore } from '../../types/cls';
import { ZodValidationPipe } from '../../zod.validation.pipe';
import { Permissions } from '../auth/decorators/permissions.decorator';
import { UseV2Feature } from '../canary/decorators/use-v2-feature.decorator';
import { V2FeatureGuard } from '../canary/guards/v2-feature.guard';
import {
  V2IndicatorInterceptor,
  X_TEABLE_V2_FEATURE_HEADER,
  X_TEABLE_V2_HEADER,
  X_TEABLE_V2_REASON_HEADER,
} from '../canary/interceptors/v2-indicator.interceptor';
import { RecordOpenApiV2Service } from '../record/open-api/record-open-api-v2.service';
import { RecordOpenApiService } from '../record/open-api/record-open-api.service';
import { TqlPipe } from '../record/open-api/tql.pipe';
import { SelectionService } from './selection.service';

@UseGuards(V2FeatureGuard)
@UseInterceptors(V2IndicatorInterceptor)
@Controller('api/table/:tableId/selection')
export class SelectionController {
  constructor(
    private selectionService: SelectionService,
    private readonly recordOpenApiService: RecordOpenApiService,
    private readonly recordOpenApiV2Service: RecordOpenApiV2Service,
    private readonly cls: ClsService<IClsStore>
  ) {}

  protected applySelectionStreamResponseHeaders(response?: Response) {
    if (!response) {
      return;
    }

    const useV2 = this.cls.get('useV2');
    const v2Reason = this.cls.get('v2Reason');
    const v2Feature = this.cls.get('v2Feature');

    setResponseHeaderIfPossible(response, X_TEABLE_V2_HEADER, useV2 ? 'true' : 'false');
    if (v2Reason) {
      setResponseHeaderIfPossible(response, X_TEABLE_V2_REASON_HEADER, v2Reason);
    }
    if (v2Feature) {
      setResponseHeaderIfPossible(response, X_TEABLE_V2_FEATURE_HEADER, v2Feature);
    }

    applyTraceResponseHeaders(response);
  }

  protected prepareSelectionStreamResponse(response: Response) {
    response.setHeader('Content-Type', 'text/event-stream');
    response.setHeader('Cache-Control', 'no-cache, no-transform');
    response.setHeader('Connection', 'keep-alive');
    response.setHeader('X-Accel-Buffering', 'no');
    this.applySelectionStreamResponseHeaders(response);
    response.flushHeaders();
  }

  protected isSelectionStreamClosed(response: Response) {
    return response.writableEnded || response.destroyed;
  }

  protected sendSelectionSseEvent<T>(response: Response, data: T) {
    if (this.isSelectionStreamClosed(response)) {
      return;
    }

    response.write(`data: ${JSON.stringify(data)}\n\n`);
    (response as Response & { flush?: () => void }).flush?.();
  }

  protected startSelectionHeartbeat(response: Response) {
    const heartbeat = setInterval(() => {
      if (this.isSelectionStreamClosed(response)) {
        return;
      }

      response.write(': ping\n\n');
      (response as Response & { flush?: () => void }).flush?.();
    }, 15_000);

    response.on('close', () => clearInterval(heartbeat));
    return heartbeat;
  }

  protected async streamSelectionResponse<T extends { id: string }>(
    response: Response,
    stream: AsyncIterable<T>,
    createErrorEvent: (message: string) => T
  ) {
    this.prepareSelectionStreamResponse(response);
    const heartbeat = this.startSelectionHeartbeat(response);

    try {
      for await (const event of stream) {
        if (this.isSelectionStreamClosed(response)) {
          break;
        }

        this.sendSelectionSseEvent(response, event);
      }
    } catch (error) {
      this.sendSelectionSseEvent(
        response,
        createErrorEvent(error instanceof Error ? error.message : 'Selection stream failed')
      );
    } finally {
      clearInterval(heartbeat);
      response.end();
    }
  }

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

  @UseV2Feature('clear')
  @Permissions('record|update')
  @Patch('/clear-stream')
  async clearStream(
    @Param('tableId') tableId: string,
    @Body(new ZodValidationPipe(rangesRoSchema), TqlPipe) rangesRo: IRangesRo,
    @Headers('x-window-id') windowId: string | undefined,
    @Res() response: Response
  ): Promise<void> {
    const stream = this.cls.get('useV2')
      ? await this.recordOpenApiV2Service.clearStream(tableId, rangesRo)
      : this.createLegacyClearSelectionStream(tableId, rangesRo, windowId);

    await this.streamSelectionResponse<IClearSelectionStreamEvent>(response, stream, (message) => ({
      id: 'error',
      phase: 'clearing',
      batchIndex: -1,
      totalCount: 0,
      processedCount: 0,
      clearedCount: 0,
      recordIds: [],
      message,
    }));
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

  protected async *createLegacyDeleteSelectionStream(
    tableId: string,
    rangesRo: IRangesRo,
    windowId?: string
  ): AsyncIterable<IDeleteSelectionStreamEvent> {
    const result = await this.selectionService.delete(tableId, rangesRo, {
      windowId,
    });
    yield {
      id: 'progress',
      phase: 'preparing',
      batchIndex: -1,
      totalCount: result.ids.length,
      deletedCount: 0,
      batchDeletedCount: 0,
    };
    yield {
      id: 'done',
      totalCount: result.ids.length,
      deletedCount: result.ids.length,
      data: {
        deletedCount: result.ids.length,
        deletedRecordIds: result.ids,
      },
    };
  }

  protected async *createLegacyClearSelectionStream(
    tableId: string,
    rangesRo: IRangesRo,
    windowId?: string
  ): AsyncIterable<IClearSelectionStreamEvent> {
    const idsResult = await this.selectionService.getIdsFromRanges(tableId, {
      ...rangesRo,
      returnType: IdReturnType.RecordId,
    });
    const totalCount = idsResult.recordIds?.length ?? 0;

    yield {
      id: 'progress',
      phase: 'preparing',
      batchIndex: -1,
      totalCount,
      processedCount: 0,
      clearedCount: 0,
      batchProcessedCount: 0,
      batchClearedCount: 0,
    };

    await this.selectionService.clear(tableId, rangesRo, {
      windowId,
    });

    yield {
      id: 'done',
      totalCount,
      processedCount: totalCount,
      clearedCount: totalCount,
      data: {
        clearedCount: totalCount,
        clearedRecordIds: [],
      },
    };
  }

  protected async *createLegacyDuplicateSelectionStream(
    tableId: string,
    rangesRo: IRangesRo,
    projection?: string[]
  ): AsyncIterable<IDuplicateSelectionStreamEvent> {
    const selectionResult = await this.selectionService.getIdsFromRanges(tableId, {
      ...rangesRo,
      returnType: IdReturnType.RecordId,
      ...(projection ? { projection } : {}),
    });
    const sourceRecordIds = selectionResult.recordIds ?? [];

    yield {
      id: 'progress',
      phase: 'preparing',
      batchIndex: -1,
      totalCount: sourceRecordIds.length,
      duplicatedCount: 0,
      batchDuplicatedCount: 0,
    };

    if (!sourceRecordIds.length) {
      yield {
        id: 'done',
        totalCount: 0,
        duplicatedCount: 0,
        data: {
          duplicatedCount: 0,
          duplicatedRecordIds: [],
        },
      };
      return;
    }

    const duplicatedRecordIds: string[] = [];
    let anchorId = sourceRecordIds.at(-1);

    for (const [index, recordId] of sourceRecordIds.entries()) {
      const duplicatedRecord = await this.recordOpenApiService.duplicateRecord(
        tableId,
        recordId,
        anchorId && rangesRo.viewId
          ? {
              viewId: rangesRo.viewId,
              anchorId,
              position: 'after',
            }
          : undefined,
        projection
      );

      duplicatedRecordIds.push(duplicatedRecord.id);
      anchorId = duplicatedRecord.id;

      yield {
        id: 'progress',
        phase: 'duplicating',
        batchIndex: index,
        totalCount: sourceRecordIds.length,
        duplicatedCount: duplicatedRecordIds.length,
        batchDuplicatedCount: 1,
      };
    }

    yield {
      id: 'done',
      totalCount: sourceRecordIds.length,
      duplicatedCount: duplicatedRecordIds.length,
      data: {
        duplicatedCount: duplicatedRecordIds.length,
        duplicatedRecordIds,
      },
    };
  }

  protected getLegacyPasteStreamTotalCount(pasteRo: IPasteRo) {
    if (Array.isArray(pasteRo.content)) {
      return pasteRo.content.length;
    }

    const content = pasteRo.content.trim();
    if (!content) {
      return 0;
    }

    return content.split(/\r?\n/).length;
  }

  protected async *createLegacyPasteSelectionStream(
    tableId: string,
    pasteRo: IPasteRo,
    windowId?: string
  ): AsyncIterable<IPasteSelectionStreamEvent> {
    const totalCount = this.getLegacyPasteStreamTotalCount(pasteRo);

    yield {
      id: 'progress',
      phase: 'preparing',
      batchIndex: -1,
      totalCount,
      processedCount: 0,
      updatedCount: 0,
      createdCount: 0,
      batchProcessedCount: 0,
    };

    const ranges = await this.selectionService.paste(tableId, pasteRo, { windowId });

    yield {
      id: 'done',
      totalCount,
      processedCount: totalCount,
      updatedCount: 0,
      createdCount: 0,
      data: {
        updatedCount: 0,
        createdCount: 0,
        createdRecordIds: [],
        ranges,
      },
    };
  }

  @UseV2Feature('deleteRecord')
  @Permissions('record|delete')
  @Get('/delete-stream')
  async deleteStream(
    @Param('tableId') tableId: string,
    @Query(new ZodValidationPipe(rangesQuerySchema), TqlPipe) rangesRo: IRangesRo,
    @Headers('x-window-id') windowId: string | undefined,
    @Res() response: Response
  ): Promise<void> {
    const stream = this.cls.get('useV2')
      ? await this.recordOpenApiV2Service.deleteByRangeStream(tableId, rangesRo)
      : this.createLegacyDeleteSelectionStream(tableId, rangesRo, windowId);

    await this.streamSelectionResponse<IDeleteSelectionStreamEvent>(
      response,
      stream,
      (message) => ({
        id: 'error',
        phase: 'deleting',
        batchIndex: -1,
        totalCount: 0,
        deletedCount: 0,
        recordIds: [],
        message,
      })
    );
  }

  @UseV2Feature('paste')
  @Permissions('record|update')
  @Patch('/paste-stream')
  async pasteStream(
    @Param('tableId') tableId: string,
    @Body(new ZodValidationPipe(pasteRoSchema), TqlPipe) pasteRo: IPasteRo,
    @Headers('x-window-id') windowId: string | undefined,
    @Res() response: Response
  ): Promise<void> {
    const stream = this.cls.get('useV2')
      ? await this.recordOpenApiV2Service.pasteStream(tableId, pasteRo, { windowId })
      : this.createLegacyPasteSelectionStream(tableId, pasteRo, windowId);

    await this.streamSelectionResponse<IPasteSelectionStreamEvent>(response, stream, (message) => ({
      id: 'error',
      phase: 'pasting',
      batchIndex: -1,
      totalCount: 0,
      processedCount: 0,
      updatedCount: 0,
      createdCount: 0,
      recordIds: [],
      message,
    }));
  }

  @UseV2Feature('duplicateRecord')
  @Permissions('record|read', 'record|create')
  @Get('/duplicate-stream')
  async duplicateStream(
    @Param('tableId') tableId: string,
    @Query(new ZodValidationPipe(rangesQuerySchema), TqlPipe) rangesRo: IRangesRo,
    @Res() response: Response
  ): Promise<void> {
    const stream = this.cls.get('useV2')
      ? await this.recordOpenApiV2Service.duplicateByRangeStream(tableId, rangesRo)
      : this.createLegacyDuplicateSelectionStream(tableId, rangesRo);

    await this.streamSelectionResponse<IDuplicateSelectionStreamEvent>(
      response,
      stream,
      (message) => ({
        id: 'error',
        phase: 'duplicating',
        batchIndex: -1,
        totalCount: 0,
        duplicatedCount: 0,
        recordIds: [],
        message,
      })
    );
  }
}
