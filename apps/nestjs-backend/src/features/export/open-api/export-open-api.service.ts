import { Readable } from 'stream';
import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { FieldType } from '@teable/core';
import { PrismaService } from '@teable/db-main-prisma';
import type { Response } from 'express';
import Papa from 'papaparse';
import { FieldService } from '../../field/field.service';
import { RecordService } from '../../record/record.service';

@Injectable()
export class ExportOpenApiService {
  private logger = new Logger(ExportOpenApiService.name);
  constructor(
    private readonly recordService: RecordService,
    private readonly fieldService: FieldService,
    private readonly prismaService: PrismaService
  ) {}
  async exportCsvFromTable(tableId: string, response: Response) {
    let count = 0;
    let isOver = false;
    const csvStream = new Readable({
      // eslint-disable-next-line @typescript-eslint/no-empty-function
      read() {},
    });

    const tableRaw = await this.prismaService.tableMeta
      .findUnique({
        where: { id: tableId },
        select: { name: true },
      })
      .catch(() => {
        throw new BadRequestException('table is not found');
      });

    response.setHeader('Content-Type', 'text/csv');
    response.setHeader(
      'Content-Disposition',
      `attachment; filename=${tableRaw?.name || 'export'}.csv`
    );

    csvStream.pipe(response);

    // set headers as first row
    const headers = await this.fieldService.getFieldsByQuery(tableId);
    const headerData = Papa.unparse([headers.map((h) => h.name)]);
    const headersInfoMap = new Map(
      headers.map((h, index) => [
        h.name,
        {
          index,
          type: h.type,
        },
      ])
    );

    csvStream.push(headerData);

    const transformTableToCsvValue = (value: unknown, type: FieldType) => {
      let csvValue = value;
      if (Array.isArray(value)) {
        csvValue =
          type === FieldType.Attachment
            ? value.map((v) => `${v.name} ${v.presignedUrl}`).join(',')
            : value.map((v) => (typeof v !== 'object' ? v : v.title)).join(',');
      }
      return csvValue;
    };

    try {
      while (!isOver) {
        const { records } = await this.recordService.getRecords(tableId, {
          take: 1000,
          skip: count,
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
              const { index: hIndex, type } = headersInfoMap.get(key) ?? {};
              if (hIndex !== undefined && type !== undefined) {
                recordsArr[hIndex] = transformTableToCsvValue(value, type);
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
