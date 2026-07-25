/* eslint-disable sonarjs/no-duplicate-string */
import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  Param,
  Patch,
  Post,
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
  IPasteByIdVo,
  ITemporaryPasteVo,
  ICopyByIdRo,
} from '@teable/openapi';
import {
  IClearByIdRo,
  IPasteByIdRo,
  IDeleteByIdRo,
  IPasteByIdStreamRo,
  IRangesToIdQuery,
  ISelectionIdsRo,
  rangesToIdQuerySchema,
  clearByIdRoSchema,
  pasteByIdRoSchema,
  deleteByIdRoSchema,
  rangesQuerySchema,
  IPasteRo,
  pasteByIdStreamRoSchema,
  pasteRoSchema,
  rangesRoSchema,
  IRangesRo,
  selectionIdsRoSchema,
  temporaryPasteRoSchema,
  ITemporaryPasteRo,
  IdReturnType,
  copyByIdRoSchema,
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
import { ShareViewScopeService } from '../record/share-view-scope.service';
import { SelectionService } from './selection.service';

@UseGuards(V2FeatureGuard)
@UseInterceptors(V2IndicatorInterceptor)
@Controller('api/table/:tableId/selection')
export class SelectionController {
  constructor(
    private selectionService: SelectionService,
    private readonly recordOpenApiService: RecordOpenApiService,
    private readonly recordOpenApiV2Service: RecordOpenApiV2Service,
    private readonly cls: ClsService<IClsStore>,
    // protected (not private) so the EE override controller can reach assertXxx
    // from its own paste / clear / delete overrides.
    protected readonly shareViewScopeService: ShareViewScopeService
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

  private async pasteByIdWithV2(tableId: string, pasteRo: IPasteByIdRo): Promise<IPasteByIdVo> {
    const targetRecordIds = await this.recordOpenApiV2Service.resolveRecordIdsBySelection(
      tableId,
      pasteRo
    );
    const { updatePayload, createPayload, fieldIds, recordIds, createdFieldIds } =
      await this.selectionService.buildPasteByIdPayload(tableId, pasteRo, {
        recordIds: targetRecordIds,
      });
    const beforeSnapshot = await this.selectionService.createPasteByIdMutationSnapshot(
      tableId,
      fieldIds
    );
    await this.recordOpenApiV2Service.updateRecords(tableId, updatePayload);
    const createdRecordIds: string[] = [];
    if (createPayload) {
      const result = await this.recordOpenApiV2Service.createRecords(tableId, createPayload);
      createdRecordIds.push(...result.records.map((record) => record.id));
    }
    return this.selectionService.completePasteByIdResult(
      tableId,
      { recordIds, fieldIds, createdRecordIds, createdFieldIds },
      beforeSnapshot
    );
  }

  protected async *createDeleteByIdSelectionStream(
    tableId: string,
    deleteRo: IDeleteByIdRo,
    windowId?: string
  ): AsyncIterable<IDeleteSelectionStreamEvent> {
    const recordIds = await this.selectionService.resolveRecordIdsBySelection(tableId, deleteRo);
    yield {
      id: 'progress',
      phase: 'preparing',
      batchIndex: -1,
      totalCount: recordIds.length,
      deletedCount: 0,
      batchDeletedCount: 0,
    };

    if (this.cls.get('useV2')) {
      await this.recordOpenApiV2Service.deleteRecordsByIds(tableId, recordIds, windowId);
    } else {
      await this.selectionService.deleteById(tableId, deleteRo, { windowId });
    }

    yield {
      id: 'done',
      totalCount: recordIds.length,
      deletedCount: recordIds.length,
      data: {
        deletedCount: recordIds.length,
        deletedRecordIds: recordIds,
      },
    };
  }

  protected async *createClearByIdSelectionStream(
    tableId: string,
    clearRo: IClearByIdRo,
    windowId?: string
  ): AsyncIterable<IClearSelectionStreamEvent> {
    const recordIds = await this.selectionService.resolveRecordIdsBySelection(tableId, clearRo);
    yield {
      id: 'progress',
      phase: 'preparing',
      batchIndex: -1,
      totalCount: recordIds.length,
      processedCount: 0,
      clearedCount: 0,
      batchProcessedCount: 0,
      batchClearedCount: 0,
    };

    if (this.cls.get('useV2')) {
      const { payload } = await this.selectionService.buildClearByIdUpdatePayload(tableId, clearRo);
      await this.recordOpenApiV2Service.updateRecords(tableId, payload);
    } else {
      await this.selectionService.clearById(tableId, clearRo, { windowId });
    }

    yield {
      id: 'done',
      totalCount: recordIds.length,
      processedCount: recordIds.length,
      clearedCount: recordIds.length,
      data: {
        clearedCount: recordIds.length,
        clearedRecordIds: recordIds,
      },
    };
  }

  protected getPasteStreamTotalCount(content: IPasteRo['content'] | IPasteByIdRo['content']) {
    if (Array.isArray(content)) {
      return content.length;
    }

    const trimmedContent = content.trim();
    if (!trimmedContent) {
      return 0;
    }
    return trimmedContent.split(/\r?\n/).length;
  }

  protected getPasteByIdStreamTotalCount(pasteRo: IPasteByIdRo) {
    return this.getPasteStreamTotalCount(pasteRo.content);
  }

  protected async *createPasteByIdSelectionStream(
    tableId: string,
    pasteRo: IPasteByIdRo,
    windowId?: string
  ): AsyncIterable<IPasteSelectionStreamEvent> {
    const totalCount = this.getPasteByIdStreamTotalCount(pasteRo);
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

    const result = this.cls.get('useV2')
      ? await this.pasteByIdWithV2(tableId, pasteRo)
      : await this.selectionService.pasteById(tableId, pasteRo, { windowId });

    yield {
      id: 'done',
      totalCount,
      processedCount: totalCount,
      updatedCount: 0,
      createdCount: 0,
      data: {
        updatedCount: 0,
        createdCount: 0,
        createdRecordIds: result.createdRecordIds ?? [],
        pastedRecordIds: result.pastedRecordIds ?? result.selection.recordIds,
        pastedFieldIds: result.pastedFieldIds ?? result.selection.fieldIds,
        createdFieldIds: result.createdFieldIds ?? [],
        createdChoiceIdsByFieldId: result.createdChoiceIdsByFieldId,
        createdForeignRecordIds: result.createdForeignRecordIds ?? [],
        skippedAttachments: result.skippedAttachments ?? [],
        selection: result.selection,
      },
    };
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

  @Permissions('record|read', 'record|copy')
  @Post('/copy-by-id')
  async copyById(
    @Param('tableId') tableId: string,
    @Body(new ZodValidationPipe(copyByIdRoSchema), TqlPipe) copyRo: ICopyByIdRo
  ): Promise<ICopyVo> {
    return this.selectionService.copyById(tableId, copyRo);
  }

  @UseV2Feature('paste')
  @Permissions('record|update')
  @Patch('/paste')
  async paste(
    @Param('tableId') tableId: string,
    @Body(new ZodValidationPipe(pasteRoSchema), TqlPipe) pasteRo: IPasteRo,
    @Headers('x-window-id') windowId?: string
  ): Promise<IPasteVo> {
    await this.shareViewScopeService.assertPaste(tableId, pasteRo);

    // Use V2 logic when canary config enables it for this space + feature
    if (this.cls.get('useV2')) {
      return this.recordOpenApiV2Service.paste(tableId, pasteRo, { windowId });
    }

    const ranges = await this.selectionService.paste(tableId, pasteRo, {
      windowId,
    });
    return { ranges };
  }

  @UseV2Feature('paste')
  @Permissions('record|update')
  @Patch('/paste-by-id')
  async pasteById(
    @Param('tableId') tableId: string,
    @Body(new ZodValidationPipe(pasteByIdRoSchema), TqlPipe) pasteRo: IPasteByIdRo,
    @Headers('x-window-id') windowId?: string
  ): Promise<IPasteByIdVo> {
    if (this.cls.get('useV2')) {
      return this.pasteByIdWithV2(tableId, pasteRo);
    }

    return this.selectionService.pasteById(tableId, pasteRo, { windowId });
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
    await this.shareViewScopeService.assertSelectionMutation(tableId, rangesRo);

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
  @Patch('/clear-by-id')
  async clearById(
    @Param('tableId') tableId: string,
    @Body(new ZodValidationPipe(clearByIdRoSchema), TqlPipe) clearRo: IClearByIdRo,
    @Headers('x-window-id') windowId?: string
  ) {
    if (this.cls.get('useV2')) {
      const recordIds = await this.recordOpenApiV2Service.resolveRecordIdsBySelection(
        tableId,
        clearRo
      );
      const { payload } = await this.selectionService.buildClearByIdUpdatePayload(
        tableId,
        clearRo,
        { recordIds }
      );
      await this.recordOpenApiV2Service.updateRecords(tableId, payload);
      return null;
    }

    await this.selectionService.clearById(tableId, clearRo, { windowId });
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
    await this.shareViewScopeService.assertSelectionMutation(tableId, rangesRo);

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

  @UseV2Feature('clear')
  @Permissions('record|update')
  @Patch('/clear-by-id-stream')
  async clearByIdStream(
    @Param('tableId') tableId: string,
    @Body(new ZodValidationPipe(selectionIdsRoSchema), TqlPipe) selectionRo: ISelectionIdsRo,
    @Res() response: Response
  ): Promise<void> {
    const stream = await this.recordOpenApiV2Service.clearByIdStream(tableId, selectionRo);

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
    await this.shareViewScopeService.assertSelectionMutation(tableId, rangesRo);

    // Use V2 logic when canary config enables it for this space + feature
    if (this.cls.get('useV2')) {
      return this.recordOpenApiV2Service.deleteByRange(tableId, rangesRo);
    }

    return this.selectionService.delete(tableId, rangesRo, {
      windowId,
    });
  }

  @UseV2Feature('deleteRecord')
  @Permissions('record|delete')
  @Post('/delete-by-id')
  async deleteById(
    @Param('tableId') tableId: string,
    @Body(new ZodValidationPipe(deleteByIdRoSchema), TqlPipe) deleteRo: IDeleteByIdRo,
    @Headers('x-window-id') windowId?: string
  ): Promise<IDeleteVo> {
    if (this.cls.get('useV2')) {
      const recordIds = await this.recordOpenApiV2Service.resolveRecordIdsBySelection(
        tableId,
        deleteRo
      );
      await this.recordOpenApiV2Service.deleteRecordsByIds(tableId, recordIds, windowId);
      return { ids: recordIds };
    }

    return this.selectionService.deleteById(tableId, deleteRo, { windowId });
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
    return this.getPasteStreamTotalCount(pasteRo.content);
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
    await this.shareViewScopeService.assertSelectionMutation(tableId, rangesRo);

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

  @UseV2Feature('deleteRecord')
  @Permissions('record|delete')
  @Patch('/delete-by-id-stream')
  async deleteByIdStream(
    @Param('tableId') tableId: string,
    @Body(new ZodValidationPipe(selectionIdsRoSchema), TqlPipe) selectionRo: ISelectionIdsRo,
    @Res() response: Response
  ): Promise<void> {
    const stream = await this.recordOpenApiV2Service.deleteByIdStream(tableId, selectionRo);

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
    await this.shareViewScopeService.assertPaste(tableId, pasteRo);

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

  @UseV2Feature('paste')
  @Permissions('record|update')
  @Patch('/paste-by-id-stream')
  async pasteByIdStream(
    @Param('tableId') tableId: string,
    @Body(new ZodValidationPipe(pasteByIdStreamRoSchema), TqlPipe) pasteRo: IPasteByIdStreamRo,
    @Headers('x-window-id') windowId: string | undefined,
    @Res() response: Response
  ): Promise<void> {
    const stream = await this.recordOpenApiV2Service.pasteByIdStream(tableId, pasteRo, {
      windowId,
    });

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
