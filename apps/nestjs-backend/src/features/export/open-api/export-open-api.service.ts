import { PassThrough, Readable } from 'node:stream';
import { setImmediate as yieldToEventLoop } from 'node:timers/promises';
import { Injectable, Logger, Optional } from '@nestjs/common';
import type { IFieldVo } from '@teable/core';
import { FieldKeyType, HttpErrorCode, ViewType } from '@teable/core';
import { PrismaService } from '@teable/db-main-prisma';
import { IExportCsvRo } from '@teable/openapi';
import { createPaginatedExportStream } from '@teable/v2-core';
import { Response } from 'express';
import { keyBy, sortBy } from 'lodash';
import { ClsService } from 'nestjs-cls';
import { CustomHttpException } from '../../../custom.exception';
import { Events } from '../../../event-emitter/events';
import type { IClsStore } from '../../../types/cls';
import { AuditScope } from '../../audit/audit-scope';
import { Audit } from '../../audit/audit.decorator';
import { FieldService } from '../../field/field.service';
import { FieldOpenApiV2Service } from '../../field/open-api/field-open-api-v2.service';
import { RecordOpenApiV2Service } from '../../record/open-api/record-open-api-v2.service';
import { RecordService } from '../../record/record.service';
import { ExportMetricsService } from '../metrics/export-metrics.service';
import { ExportTracingService } from '../metrics/export-tracing.service';
import { CsvExportEncoder } from './csv-export-encoder';

export interface ITableCsvExport {
  /** The table's name, with the view's appended when one was asked for; not URL-encoded. */
  fileName: string;
  stream: Readable;
  /** Fetches the rows into `stream`; resolves once the stream has ended. */
  run: () => Promise<void>;
}

@Injectable()
export class ExportOpenApiService {
  private readonly logger = new Logger(ExportOpenApiService.name);
  constructor(
    private readonly fieldService: FieldService,
    private readonly recordService: RecordService,
    private readonly prismaService: PrismaService,
    private readonly audit: AuditScope,
    private readonly cls: ClsService<IClsStore>,
    private readonly recordOpenApiV2Service: RecordOpenApiV2Service,
    private readonly fieldOpenApiV2Service: FieldOpenApiV2Service,
    @Optional() private readonly exportMetrics?: ExportMetricsService,
    @Optional() private readonly exportTracing?: ExportTracingService
  ) {}

  @Audit({
    action: Events.TABLE_EXPORT,
    resourceId: (_response: Response, tableId: string) => tableId,
    params: (_response: Response, _tableId: string, query?: IExportCsvRo) =>
      query ? ({ ...query } as unknown as Record<string, unknown>) : undefined,
    emit: true,
  })
  async exportCsvFromTable(response: Response, tableId: string, query?: IExportCsvRo) {
    const { fileName, stream, run } = await this.prepareCsvExport(tableId, query);
    if (response.destroyed) {
      stream.destroy();
      return;
    }

    response.setHeader('Content-Type', 'text/csv; charset=utf-8');
    response.setHeader(
      'Content-Disposition',
      `attachment; filename=${encodeURIComponent(fileName)}.csv`
    );

    const onClose = () => {
      if (!response.writableFinished) stream.destroy();
    };
    response.once('close', onClose);
    try {
      if (response.destroyed) {
        stream.destroy();
        return;
      }
      stream.pipe(response);
      await run();
    } finally {
      response.removeListener('close', onClose);
    }
  }

  /**
   * The CSV of a table as a stream plus the work that fills it, with no HTTP response
   * attached: the export route pipes the stream to the client, an archive builder appends it
   * as one entry among many. Everything that can refuse (missing table, unsupported view)
   * has done so by the time this returns; `run` is where the rows are fetched, and it
   * resolves once the stream has ended.
   */
  async prepareCsvExport(tableId: string, query?: IExportCsvRo): Promise<ITableCsvExport> {
    const exportStartTime = Date.now();
    this.exportMetrics?.recordExportStart('csv');
    const {
      viewId,
      filter: queryFilter,
      orderBy: queryOrderBy,
      groupBy: queryGroupBy,
      projection,
      ignoreViewQuery,
      columnMeta: queryColumnMeta,
    } = query ?? {};
    let count = 0;
    const csvStream = new PassThrough();
    const abort = new AbortController();
    csvStream.once('close', () => abort.abort());
    const writeChunk = async (chunk: string): Promise<boolean> => {
      if (csvStream.destroyed) return false;
      if (csvStream.write(chunk)) return true;
      // This package targets ES2022, whose Promise type does not expose withResolvers.
      return new Promise<boolean>((resolve) => {
        const cleanup = () => {
          csvStream.removeListener('drain', onDrain);
          csvStream.removeListener('close', onClose);
        };
        const onDrain = () => {
          cleanup();
          resolve(true);
        };
        const onClose = () => {
          cleanup();
          resolve(false);
        };
        csvStream.once('drain', onDrain);
        csvStream.once('close', onClose);
        if (csvStream.destroyed) onClose();
      });
    };
    let viewRaw = null;

    const tableRaw = await this.prismaService.tableMeta
      .findUnique({
        where: { id: tableId, deletedTime: null },
        select: { name: true },
      })
      .catch(() => {
        throw new CustomHttpException('Table not found', HttpErrorCode.NOT_FOUND, {
          localization: {
            i18nKey: 'httpErrors.table.notFound',
          },
        });
      });

    if (viewId && !ignoreViewQuery) {
      viewRaw = await this.prismaService.view
        .findUnique({
          where: {
            id: viewId,
            tableId,
            deletedTime: null,
          },
          select: {
            id: true,
            type: true,
            name: true,
          },
        })
        .catch((e) => {
          this.logger.error(e?.message, `ExportCsv: ${tableId}`);
        });

      if (viewRaw?.type !== ViewType.Grid) {
        throw new CustomHttpException(
          `${viewRaw?.type} is not support to export`,
          HttpErrorCode.VALIDATION_ERROR,
          {
            localization: {
              i18nKey: 'httpErrors.export.notSupportViewType',
              context: {
                viewType: viewRaw?.type,
              },
            },
          }
        );
      }
    }

    const fileName = tableRaw?.name
      ? `${tableRaw.name}${viewRaw?.name ? `_${viewRaw.name}` : ''}`
      : 'export';

    // set headers as first row
    const viewIdForQuery = ignoreViewQuery ? undefined : viewRaw?.id;
    const useV2 = Boolean(this.cls.get('useV2'));
    let allFields = useV2
      ? await this.fieldOpenApiV2Service.getFields(tableId, {
          viewId: viewIdForQuery,
          filterHidden: Boolean(viewIdForQuery),
        })
      : await this.fieldService.getFieldsByQuery(tableId, {
          viewId: viewIdForQuery,
          filterHidden: Boolean(viewIdForQuery),
        });

    // Sort fields based on:
    // 1. If ignoreViewQuery is true and queryColumnMeta is provided, sort by queryColumnMeta order
    // 2. If viewId is provided (and ignoreViewQuery is false), getFieldsByQuery already sorted by view columnMeta
    // 3. Otherwise, keep table's original field order
    allFields = this.sortFieldsByColumnMeta(allFields, ignoreViewQuery, queryColumnMeta);

    const fieldsMap = keyBy(allFields, 'id');
    // Filter by projection but keep the original field order from view/table
    const headers = allFields.filter((field) => !projection || projection.includes(field.id));
    const encoder = new CsvExportEncoder(headers);
    const headerData = encoder.header();

    const projectionNames = projection
      ? (projection.map((p) => fieldsMap[p]?.name).filter(Boolean) as string[])
      : undefined;

    const writeRecords = async (records: readonly { fields: Record<string, unknown> }[]) => {
      // Limit synchronous work and let other requests run between batches.
      for (let offset = 0; offset < records.length; offset += 100) {
        if (csvStream.destroyed) return false;
        const csvData = encoder.encode(records.slice(offset, offset + 100));
        if (!(await writeChunk(`\r\n${csvData}`))) return false;
        await yieldToEventLoop();
      }
      return true;
    };
    const getPage = async (skip: number, limit: number) => {
      const options = {
        take: limit,
        skip,
        viewId: viewIdForQuery,
        filter: queryFilter,
        orderBy: queryOrderBy,
        groupBy: queryGroupBy,
        ignoreViewQuery,
        projection: projectionNames,
      };
      const result = useV2
        ? await this.recordOpenApiV2Service.getRecords(tableId, {
            ...options,
            fieldKeyType: FieldKeyType.Name,
          })
        : await this.recordService.getRecords(tableId, options, true);
      return result.records;
    };

    const run = async () => {
      try {
        // Add BOM so the CSV opens correctly in Excel.
        if (!(await writeChunk('\uFEFF')) || !(await writeChunk(headerData))) return;
        for await (const records of createPaginatedExportStream({
          pageSize: 1000,
          getPage,
          signal: abort.signal,
        })) {
          if (csvStream.destroyed) return;
          if (!(await writeRecords(records))) return;
          count += records.length;
        }
        if (csvStream.destroyed) return;
        csvStream.end();
        this.exportTracing?.setExportAttributes({ rows: count });
        this.exportMetrics?.recordExportComplete({
          format: 'csv',
          durationMs: Date.now() - exportStartTime,
        });
      } catch (e) {
        if (csvStream.destroyed) return;
        await writeChunk(`\r\nExport fail reason:, ${(e as Error)?.message}`);
        this.logger.error((e as Error)?.message, `ExportCsv: ${tableId}`);
        this.exportMetrics?.recordExportError({
          format: 'csv',
          errorType: (e as Error)?.name ?? 'unknown',
        });
        if (!csvStream.destroyed) csvStream.end();
      }
    };

    return { fileName, stream: csvStream, run };
  }

  /**
   * Sort fields based on columnMeta order
   * @param fields - The fields to sort
   * @param ignoreViewQuery - Whether to ignore view query
   * @param queryColumnMeta - The columnMeta from query params for custom sorting
   * @returns Sorted fields
   */
  private sortFieldsByColumnMeta(
    fields: IFieldVo[],
    ignoreViewQuery?: boolean,
    queryColumnMeta?: Record<string, { order: number }>
  ): IFieldVo[] {
    // If ignoreViewQuery is true and queryColumnMeta is provided, sort by queryColumnMeta order
    if (ignoreViewQuery && queryColumnMeta) {
      return sortBy(fields, (field) => queryColumnMeta[field.id]?.order ?? Infinity);
    }
    // Otherwise, keep the order from getFieldsByQuery (either view columnMeta order or table original order)
    return fields;
  }
}
