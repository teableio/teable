import { Readable } from 'stream';
import { Injectable, Logger, Optional } from '@nestjs/common';
import type { IAttachmentCellValue, IFieldVo } from '@teable/core';
import { FieldType, HttpErrorCode, ViewType } from '@teable/core';
import { PrismaService } from '@teable/db-main-prisma';
import type { IExportCsvRo } from '@teable/openapi';
import type { Response } from 'express';
import { keyBy, sortBy } from 'lodash';
import Papa from 'papaparse';
import { CustomHttpException } from '../../../custom.exception';
import { FieldService } from '../../field/field.service';
import { createFieldInstanceByVo } from '../../field/model/factory';
import { RecordService } from '../../record/record.service';
import { ExportMetricsService } from '../metrics/export-metrics.service';

@Injectable()
export class ExportOpenApiService {
  private logger = new Logger(ExportOpenApiService.name);
  constructor(
    private readonly fieldService: FieldService,
    private readonly recordService: RecordService,
    private readonly prismaService: PrismaService,
    @Optional() private readonly exportMetrics?: ExportMetricsService
  ) {}
  async exportCsvFromTable(response: Response, tableId: string, query?: IExportCsvRo) {
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
    let isOver = false;
    const csvStream = new Readable({
      // eslint-disable-next-line @typescript-eslint/no-empty-function
      read() {},
    });
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
      ? encodeURIComponent(`${tableRaw?.name}${viewRaw?.name ? `_${viewRaw.name}` : ''}`)
      : 'export';

    response.setHeader('Content-Type', 'text/csv; charset=utf-8');
    response.setHeader('Content-Disposition', `attachment; filename=${fileName}.csv`);

    csvStream.pipe(response);

    // set headers as first row
    const viewIdForQuery = ignoreViewQuery ? undefined : viewRaw?.id;
    let allFields = await this.fieldService.getFieldsByQuery(tableId, {
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
    const headerData = Papa.unparse([headers.map((h) => h.name)]);

    const projectionNames = projection
      ? (projection.map((p) => fieldsMap[p]?.name).filter((p) => Boolean(p)) as string[])
      : undefined;

    const headersInfoMap = new Map(
      headers.map((h, index) => [
        h.name,
        {
          index,
          type: h.type,
          fieldInstance: createFieldInstanceByVo(h),
        },
      ])
    );

    // add BOM to make sure the csv file can be opened correctly in excel
    csvStream.push('\uFEFF');
    csvStream.push(headerData);

    try {
      while (!isOver) {
        const { records } = await this.recordService.getRecords(
          tableId,
          {
            take: 1000,
            skip: count,
            viewId: viewIdForQuery,
            filter: queryFilter,
            orderBy: queryOrderBy,
            groupBy: queryGroupBy,
            ignoreViewQuery,
            projection: projectionNames,
          },
          true
        );

        if (records.length === 0) {
          isOver = true;
          // end the stream
          csvStream.push(null);
          this.exportMetrics?.recordExportComplete({
            format: 'csv',
            rows: count,
            durationMs: Date.now() - exportStartTime,
          });
          break;
        }

        const csvData = Papa.unparse(
          records.map((r) => {
            const { fields } = r;
            const recordsArr = Array.from({ length: headers.length });
            for (const [key, value] of Object.entries(fields)) {
              const { index: hIndex, type, fieldInstance } = headersInfoMap.get(key) ?? {};
              if (hIndex !== undefined && type !== undefined) {
                const finalValue =
                  type === FieldType.Attachment
                    ? (value as IAttachmentCellValue)
                        .map((v) => `${v.name} ${v.presignedUrl}`)
                        .join(',')
                    : fieldInstance?.cellValue2String(value);
                recordsArr[hIndex] = finalValue;
              }
            }
            return recordsArr;
          })
        );

        csvStream.push('\r\n');
        csvStream.push(csvData);
        count += records.length;
      }
    } catch (e) {
      csvStream.push('\r\n');
      csvStream.push(`Export fail reason:, ${(e as Error)?.message}`);
      this.logger.error((e as Error)?.message, `ExportCsv: ${tableId}`);
      this.exportMetrics?.recordExportError({
        format: 'csv',
        errorType: (e as Error)?.name ?? 'unknown',
      });
    }
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
