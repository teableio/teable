import { Readable } from 'stream';
import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import type { IAttachmentCellValue, IFilter } from '@teable/core';
import { FieldType, mergeFilter, ViewType } from '@teable/core';
import { PrismaService } from '@teable/db-main-prisma';
import type { Response } from 'express';
import Papa from 'papaparse';
import { FieldService } from '../../field/field.service';
import { createFieldInstanceByVo } from '../../field/model/factory';
import { RecordService } from '../../record/record.service';

@Injectable()
export class ExportOpenApiService {
  private logger = new Logger(ExportOpenApiService.name);
  constructor(
    private readonly fieldService: FieldService,
    private readonly recordService: RecordService,
    private readonly prismaService: PrismaService
  ) {}
  async exportCsvFromTable(
    response: Response,
    tableId: string,
    viewId?: string,
    exportQuery?: {
      projection?: string[];
      recordFilter?: IFilter;
    }
  ) {
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
        throw new BadRequestException('table is not found');
      });

    if (viewId) {
      viewRaw = await this.prismaService.view
        .findUnique({
          where: {
            id: viewId,
            tableId,
            deletedTime: null,
          },
          select: {
            name: true,
            id: true,
            type: true,
            filter: true,
          },
        })
        .catch((e) => {
          this.logger.error(e?.message, `ExportCsv: ${tableId}`);
        });

      if (viewRaw?.type !== ViewType.Grid) {
        throw new BadRequestException(`${viewRaw?.type} is not support to export`);
      }
    }

    const fileName = tableRaw?.name
      ? encodeURIComponent(`${tableRaw?.name}${viewRaw?.name ? `_${viewRaw.name}` : ''}`)
      : 'export';

    response.setHeader('Content-Type', 'text/csv; charset=utf-8');
    response.setHeader('Content-Disposition', `attachment; filename=${fileName}.csv`);

    csvStream.pipe(response);

    // set headers as first row
    const headers = (
      await this.fieldService.getFieldsByQuery(tableId, {
        viewId: viewRaw?.id ? viewRaw?.id : undefined,
        filterHidden: viewRaw?.id ? true : undefined,
      })
    ).filter((field) => {
      if (exportQuery?.projection) {
        return exportQuery?.projection.includes(field.id);
      }

      return true;
    });
    const headerData = Papa.unparse([headers.map((h) => h.name)]);

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

    const mergedFilter = viewRaw?.filter
      ? mergeFilter(JSON.parse(viewRaw?.filter), exportQuery?.recordFilter)
      : exportQuery?.recordFilter;

    try {
      while (!isOver) {
        const { records } = await this.recordService.getRecords(tableId, {
          take: 1000,
          skip: count,
          viewId: viewRaw?.id ? viewRaw?.id : undefined,
          filter: mergedFilter,
        });
        if (records.length === 0) {
          isOver = true;
          // end the stream
          csvStream.push(null);
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
    }
  }
}
