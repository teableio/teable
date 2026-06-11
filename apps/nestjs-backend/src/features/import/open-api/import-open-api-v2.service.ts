import { Injectable, HttpException, HttpStatus, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { HttpErrorCode } from '@teable/core';
import { CreateRecordAction, type IInplaceImportOptionRo } from '@teable/openapi';
import {
  v2CoreTokens,
  type ICommandBus,
  ImportRecordsCommand,
  type ImportRecordsResult,
} from '@teable/v2-core';
import { difference } from 'lodash';
import { ClsService } from 'nestjs-cls';
import { z } from 'zod';
import { BaseConfig, type IBaseConfig } from '../../../configs/base.config';
import { CustomHttpException, getDefaultCodeByStatus } from '../../../custom.exception';
import { Events } from '../../../event-emitter/events';
import type { IClsStore } from '../../../types/cls';
import { AuditScope } from '../../audit/audit-scope';
import { Audit } from '../../audit/audit.decorator';
import { V2ContainerService } from '../../v2/v2-container.service';
import { V2ExecutionContextFactory } from '../../v2/v2-execution-context.factory';

/**
 * V2 Import Open API Service
 *
 * Handles import operations using the V2 architecture via CommandBus.
 */
@Injectable()
export class ImportOpenApiV2Service {
  private readonly logger = new Logger(ImportOpenApiV2Service.name);

  constructor(
    private readonly v2ContainerService: V2ContainerService,
    private readonly v2ContextFactory: V2ExecutionContextFactory,
    private readonly cls: ClsService<IClsStore>,
    private readonly configService: ConfigService,
    private readonly audit: AuditScope,
    private readonly eventEmitter: EventEmitter2,
    @BaseConfig() private readonly baseConfig: IBaseConfig
  ) {}

  /**
   * Resolve a relative URL to an absolute URL.
   * If the URL is already absolute, return as-is.
   */
  private resolveUrl(url: string): string {
    const trimmedUrl = url.trim();
    if (z.string().url().safeParse(trimmedUrl).success) {
      return trimmedUrl;
    }
    const storagePrefix =
      this.baseConfig.storagePrefix ?? process.env.STORAGE_PREFIX ?? process.env.PUBLIC_ORIGIN;
    if (storagePrefix) {
      const normalizedPrefix = storagePrefix.replace(/\/$/, '');
      const normalizedPath = trimmedUrl.startsWith('/') ? trimmedUrl : `/${trimmedUrl}`;
      return `${normalizedPrefix}${normalizedPath}`;
    }
    // For relative URLs, use localhost with the configured port
    const port = this.configService.get<number>('PORT') || 3000;
    return `http://localhost:${port}${trimmedUrl}`;
  }

  private throwV2Error(
    error: {
      code: string;
      message: string;
      tags?: ReadonlyArray<string>;
      details?: Readonly<Record<string, unknown>>;
    },
    status: number
  ): never {
    throw new CustomHttpException(error.message, getDefaultCodeByStatus(status), {
      domainCode: error.code,
      domainTags: error.tags,
      details: error.details,
    });
  }

  /**
   * Import records using V2 architecture via CommandBus.
   * Appends records from a file (CSV/Excel) to an existing table.
   *
   * The ImportRecordsCommand handler is responsible for:
   * - Finding the table by ID
   * - Parsing the import source
   * - Handling typecast and side effects (new select options)
   * - Resolving link fields
   * - Streaming record insertion
   *
   * @param baseId - The base ID
   * @param tableId - The table ID to import into
   * @param importOptions - Import options (V1 API type for compatibility)
   * @param maxRowCount - Optional max row count limit
   * @param projection - Optional field projection for permission check
   */
  @Audit({
    rootAction: CreateRecordAction.InplaceImport,
    resourceId: (_baseId: string, tableId: string) => tableId,
    params: (_baseId: string, _tableId: string, importOptions: IInplaceImportOptionRo) => ({
      fileType: importOptions.fileType,
    }),
  })
  async importRecords(
    baseId: string,
    tableId: string,
    importOptions: IInplaceImportOptionRo,
    maxRowCount?: number,
    projection?: string[]
  ): Promise<{ totalImported: number }> {
    const container = await this.v2ContainerService.getContainerForTable(tableId);
    const commandBus = container.resolve<ICommandBus>(v2CoreTokens.commandBus);

    const context = await this.v2ContextFactory.createContext(container);

    const { attachmentUrl, fileType, insertConfig } = importOptions;
    const { sourceColumnMap, sourceWorkSheetKey, excludeFirstRow } = insertConfig;

    // Validate field permissions if projection is provided
    if (projection) {
      const fieldIds = Object.keys(sourceColumnMap);
      const noUpdateFields = difference(fieldIds, projection);
      if (noUpdateFields.length !== 0) {
        const tips = noUpdateFields.join(',');
        throw new CustomHttpException(
          `There is no permission to update these fields: ${tips}`,
          HttpErrorCode.RESTRICTED_RESOURCE,
          {
            localization: {
              i18nKey: 'httpErrors.permission.updateRecordWithDeniedFields',
              context: {
                fields: tips,
              },
            },
          }
        );
      }
    }

    // Resolve relative URL to absolute URL
    const resolvedUrl = this.resolveUrl(attachmentUrl);

    // Align with v1 behavior: treat 0 (or negative) as no limit
    const normalizedMaxRowCount =
      maxRowCount !== undefined && maxRowCount > 0 ? maxRowCount : undefined;

    // Create command
    const commandResult = ImportRecordsCommand.createFromUrl({
      tableId,
      url: resolvedUrl,
      fileType,
      sourceColumnMap,
      options: {
        skipFirstNLines: excludeFirstRow ? 1 : 0,
        sheetName: sourceWorkSheetKey,
        typecast: true,
        batchSize: normalizedMaxRowCount ? Math.min(normalizedMaxRowCount, 500) : 500,
        maxRowCount: normalizedMaxRowCount,
      },
    });

    if (commandResult.isErr()) {
      throw new HttpException(commandResult.error.message, HttpStatus.BAD_REQUEST);
    }

    // Execute via CommandBus
    const result = await commandBus.execute<ImportRecordsCommand, ImportRecordsResult>(
      context,
      commandResult.value
    );

    if (result.isErr()) {
      this.logger.error('V2 import records failed', result.error);

      // Map domain error to HTTP status
      const status =
        result.error.code === 'import.field_not_found' ||
        result.error.code === 'import.column_index_out_of_range' ||
        result.error.tags?.includes('validation')
          ? HttpStatus.BAD_REQUEST
          : result.error.tags?.includes('not-found')
            ? HttpStatus.NOT_FOUND
            : HttpStatus.INTERNAL_SERVER_ERROR;

      // Mirror the V1 worker (import-csv.processor.ts) terminal signal so e2e tests
      // and downstream consumers wake up on V2 imports too. V1 emits on lastChunk +
      // catch; V2 is synchronous so emits at the return-success/throw boundary.
      this.eventEmitter.emit(Events.TABLE_IMPORT_FINISH, {
        tableId,
        baseId,
        status: 'failed',
        error: result.error.message,
      });

      this.throwV2Error(result.error, status);
    }

    // No manual audit emit: ImportRecordsHandler publishes RecordsBatchCreated per batch.
    // The projection writes one audit_log row per batch naturally, keeping the atomic
    // record-create action and attaching rootAction=InplaceImport from this operation.
    this.eventEmitter.emit(Events.TABLE_IMPORT_FINISH, {
      tableId,
      baseId,
      status: 'completed',
    });
    return { totalImported: result.value.totalImported };
  }
}
