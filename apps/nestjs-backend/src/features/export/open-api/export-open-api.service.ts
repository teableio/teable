import { Readable } from 'stream';
import { Injectable, Logger } from '@nestjs/common';
import type { Response } from 'express';
import Papa from 'papaparse';
import { FieldService } from '../../field/field.service';
import { RecordService } from '../../record/record.service';

@Injectable()
export class ExportOpenApiService {
  private logger = new Logger(ExportOpenApiService.name);
  constructor(
    private readonly recordService: RecordService,
    private readonly fieldService: FieldService
  ) {}
  async exportCsvFromTable(tableId: string, response: Response) {
    let count = 0;
    let isOver = false;
    const csvStream = new Readable({
      // eslint-disable-next-line @typescript-eslint/no-empty-function
      read() {},
    });

    response.setHeader('Content-Type', 'text/csv');
    response.setHeader('Content-Disposition', 'attachment; filename=export.csv');

    csvStream.pipe(response);

    // set headers as first row
    const headers = await this.fieldService.getFieldsByQuery(tableId);
    const headerData = Papa.unparse([headers.map((h) => h.name)]);
    csvStream.push(headerData);

    try {
      while (!isOver) {
        const { records } = await this.recordService.getRecords(tableId, {
          take: 10,
          skip: count,
        });
        if (records.length === 0) {
          isOver = true;
          // end the stream
          csvStream.push(null);
          break;
        }
        const csvData = Papa.unparse(
          records.map((r) =>
            Object.values(r.fields).map((value) => {
              if (typeof value === 'object') {
                return '';
              }
              return value;
            })
          )
        );
        csvStream.push('\n');
        csvStream.push(csvData);
        count += records.length;
      }
    } catch (e) {
      this.logger.error((e as Error)?.message, `ExportCsv: ${tableId}`);
    }
  }
}
