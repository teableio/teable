import {
  Controller,
  Get,
  UseGuards,
  Query,
  Post,
  Body,
  Param,
  Patch,
  UseInterceptors,
  Res,
} from '@nestjs/common';
import {
  analyzeRoSchema,
  IAnalyzeRo,
  IImportOptionRo,
  importOptionRoSchema,
  IInplaceImportOptionRo,
  inplaceImportOptionRoSchema,
} from '@teable/openapi';
import type {
  ITableFullVo,
  IAnalyzeVo,
  IImportStatusVo,
  IImportStreamEvent,
} from '@teable/openapi';
import { Response } from 'express';
import { ClsService } from 'nestjs-cls';
import {
  applyTraceResponseHeaders,
  setResponseHeaderIfPossible,
} from '../../../tracing/trace-response-headers';
import type { IClsStore } from '../../../types/cls';
import { ZodValidationPipe } from '../../../zod.validation.pipe';
import { Permissions } from '../../auth/decorators/permissions.decorator';
import { TokenAccess } from '../../auth/decorators/token.decorator';
import { PermissionGuard } from '../../auth/guard/permission.guard';
import { UseV2Feature } from '../../canary/decorators/use-v2-feature.decorator';
import { V2FeatureGuard } from '../../canary/guards/v2-feature.guard';
import {
  V2IndicatorInterceptor,
  X_TEABLE_V2_FEATURE_HEADER,
  X_TEABLE_V2_HEADER,
  X_TEABLE_V2_REASON_HEADER,
} from '../../canary/interceptors/v2-indicator.interceptor';
import { TableBaseScopeGuard } from '../../table/guard/table-base-scope.guard';
import { ImportOpenApiV2Service } from './import-open-api-v2.service';
import { ImportOpenApiService } from './import-open-api.service';

@Controller('api/import')
@UseGuards(PermissionGuard, V2FeatureGuard, TableBaseScopeGuard)
@UseInterceptors(V2IndicatorInterceptor)
export class ImportController {
  constructor(
    protected readonly importOpenService: ImportOpenApiService,
    protected readonly importOpenApiV2Service: ImportOpenApiV2Service,
    protected readonly cls: ClsService<IClsStore>
  ) {}
  @Get('/analyze')
  @TokenAccess()
  async analyzeSheetFromFile(
    @Query(new ZodValidationPipe(analyzeRoSchema)) analyzeRo: IAnalyzeRo
  ): Promise<IAnalyzeVo> {
    return await this.importOpenService.analyze(analyzeRo);
  }

  @Get('/status/:tableId')
  @Permissions('base|table_import')
  @TokenAccess()
  async getImportStatus(@Param('tableId') tableId: string): Promise<IImportStatusVo> {
    return await this.importOpenService.getImportStatus(tableId);
  }

  @Post(':baseId')
  @UseV2Feature('importCsv')
  @Permissions('base|table_import')
  @TokenAccess()
  async createTableFromImport(
    @Param('baseId') baseId: string,
    @Body(new ZodValidationPipe(importOptionRoSchema)) importRo: IImportOptionRo
  ): Promise<ITableFullVo[]> {
    if (this.cls.get('useV2')) {
      return await this.importOpenApiV2Service.createTableFromImport(baseId, importRo);
    }

    return await this.importOpenService.createTableFromImport(baseId, importRo);
  }

  @Post(':baseId/stream')
  @UseV2Feature('importCsv')
  @Permissions('base|table_import')
  @TokenAccess()
  async createTableFromImportStream(
    @Param('baseId') baseId: string,
    @Body(new ZodValidationPipe(importOptionRoSchema)) importRo: IImportOptionRo,
    @Res() response: Response
  ): Promise<void> {
    const stream = this.cls.get('useV2')
      ? this.importOpenApiV2Service.createTableFromImportStream(baseId, importRo)
      : this.createLegacyImportTableStream(baseId, importRo);

    await this.streamImportResponse(response, stream, (message) =>
      this.createImportStreamErrorEvent(message)
    );
  }

  @UseV2Feature('importRecords')
  @Patch(':baseId/:tableId')
  @Permissions('table|import')
  async inplaceImportTable(
    @Param('baseId') baseId: string,
    @Param('tableId') tableId: string,
    @Body(new ZodValidationPipe(inplaceImportOptionRoSchema))
    inplaceImportRo: IInplaceImportOptionRo
  ): Promise<void> {
    // Use V2 logic when canary config enables it for this space + feature
    if (this.cls.get('useV2')) {
      await this.importOpenApiV2Service.importRecords(baseId, tableId, inplaceImportRo);
      return;
    }

    return await this.importOpenService.inplaceImportTable(baseId, tableId, inplaceImportRo);
  }

  @UseV2Feature('importRecords')
  @Patch(':baseId/:tableId/stream')
  @Permissions('table|import')
  async inplaceImportTableStream(
    @Param('baseId') baseId: string,
    @Param('tableId') tableId: string,
    @Body(new ZodValidationPipe(inplaceImportOptionRoSchema))
    inplaceImportRo: IInplaceImportOptionRo,
    @Res() response: Response
  ): Promise<void> {
    const stream = this.cls.get('useV2')
      ? this.importOpenApiV2Service.importRecordsStream(baseId, tableId, inplaceImportRo)
      : this.createLegacyInplaceImportStream(baseId, tableId, inplaceImportRo);

    await this.streamImportResponse(response, stream, (message) =>
      this.createImportStreamErrorEvent(message)
    );
  }

  protected applyImportStreamResponseHeaders(response: Response) {
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

  protected prepareImportStreamResponse(response: Response) {
    response.setHeader('Content-Type', 'text/event-stream');
    response.setHeader('Cache-Control', 'no-cache, no-transform');
    response.setHeader('Connection', 'keep-alive');
    response.setHeader('X-Accel-Buffering', 'no');
    this.applyImportStreamResponseHeaders(response);
    response.flushHeaders();
  }

  protected isImportStreamClosed(response: Response) {
    return response.writableEnded || response.destroyed;
  }

  protected sendImportSseEvent<T>(response: Response, data: T) {
    if (this.isImportStreamClosed(response)) {
      return;
    }

    response.write(`data: ${JSON.stringify(data)}\n\n`);
    (response as Response & { flush?: () => void }).flush?.();
  }

  protected startImportHeartbeat(response: Response) {
    const heartbeat = setInterval(() => {
      if (this.isImportStreamClosed(response)) {
        return;
      }

      response.write(': ping\n\n');
      (response as Response & { flush?: () => void }).flush?.();
    }, 15_000);

    response.on('close', () => clearInterval(heartbeat));
    return heartbeat;
  }

  protected async streamImportResponse<T extends { id: string }>(
    response: Response,
    stream: AsyncIterable<T>,
    createErrorEvent: (message: string) => T
  ) {
    this.prepareImportStreamResponse(response);
    const heartbeat = this.startImportHeartbeat(response);

    try {
      for await (const event of stream) {
        if (this.isImportStreamClosed(response)) {
          break;
        }

        this.sendImportSseEvent(response, event);
      }
    } catch (error) {
      this.sendImportSseEvent(
        response,
        createErrorEvent(error instanceof Error ? error.message : 'Import stream failed')
      );
    } finally {
      clearInterval(heartbeat);
      response.end();
    }
  }

  protected async *createLegacyImportTableStream(
    baseId: string,
    importRo: IImportOptionRo,
    maxRowCount?: number
  ): AsyncIterable<IImportStreamEvent> {
    yield this.createImportStreamProgressEvent();
    const tables = await this.importOpenService.createTableFromImport(
      baseId,
      importRo,
      maxRowCount
    );
    yield {
      id: 'done',
      totalCount: 0,
      processedCount: 0,
      importedCount: 0,
      data: {
        tables,
        tableId: tables[0]?.id,
      },
    };
  }

  protected async *createLegacyInplaceImportStream(
    baseId: string,
    tableId: string,
    inplaceImportRo: IInplaceImportOptionRo
  ): AsyncIterable<IImportStreamEvent> {
    yield this.createImportStreamProgressEvent();
    await this.importOpenService.inplaceImportTable(baseId, tableId, inplaceImportRo);
    yield {
      id: 'done',
      totalCount: 0,
      processedCount: 0,
      importedCount: 0,
      data: { tableId },
    };
  }

  protected createImportStreamProgressEvent(): IImportStreamEvent {
    return {
      id: 'progress',
      phase: 'preparing',
      sheetIndex: 0,
      sheetCount: 1,
      batchIndex: -1,
      totalCount: 0,
      processedCount: 0,
      importedCount: 0,
      sheetTotalCount: 0,
      sheetProcessedCount: 0,
      batchProcessedCount: 0,
    };
  }

  protected createImportStreamErrorEvent(message: string): IImportStreamEvent {
    return {
      id: 'error',
      phase: 'importing',
      sheetIndex: 0,
      sheetCount: 1,
      batchIndex: -1,
      totalCount: 0,
      processedCount: 0,
      importedCount: 0,
      message,
    };
  }
}
