import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import type { IFieldRo, IFieldVo, IRecord } from '@teable-group/core';
import { FieldKeyType, FieldType, nullsToUndefined } from '@teable-group/core';
import { CopyAndPasteSchema } from '@teable-group/openapi';
import { isNumber, isString, omit } from 'lodash';
import { PrismaService } from '../../prisma.service';
import { ShareDbService } from '../../share-db/share-db.service';
import { TransactionService } from '../../share-db/transaction.service';
import { FieldService } from '../field/field.service';
import {
  createFieldInstanceByRo,
  createFieldInstanceByVo,
  type IFieldInstance,
} from '../field/model/factory';
import { AttachmentFieldDto } from '../field/model/field-dto/attachment-field.dto';
import { FieldOpenApiService } from '../field/open-api/field-open-api.service';
import { RecordOpenApiService } from '../record/open-api/record-open-api.service';
import { RecordService } from '../record/record.service';

@Injectable()
export class CopyPasteService {
  constructor(
    private recordService: RecordService,
    private fieldService: FieldService,
    private prismaService: PrismaService,
    private recordOpenApiService: RecordOpenApiService,
    private fieldOpenApiService: FieldOpenApiService,
    private transactionService: TransactionService,
    private shareDbService: ShareDbService
  ) {}

  private async getRangeTableContent(tableId: string, viewId: string, range: number[][]) {
    const [start, end] = range;
    const fields = await this.fieldService.getFieldInstances(tableId, { viewId });
    const copyFields = fields.slice(start[0], end[0] + 1);
    const records = await this.recordService.getRecords(tableId, {
      viewId,
      skip: start[1],
      take: end[1] + 1 - start[1],
      fieldKeyType: FieldKeyType.Id,
    });
    return records.records.map(({ fields }) =>
      copyFields.map((field) => field.cellValue2String(fields[field.id] as never))
    );
  }

  private mergeRangesData(rangesData: string[][][], type?: CopyAndPasteSchema.RangeType) {
    if (rangesData.length === 0) {
      return [];
    }
    if (type === CopyAndPasteSchema.RangeType.Column) {
      return rangesData.reduce((result, subArray) => {
        subArray.forEach((row, index) => {
          result[index] = result[index] ? result[index].concat(row) : row;
        });
        return result;
      }, []);
    }
    return rangesData.reduce((acc, row) => acc.concat(row), []);
  }

  private async getCopyHeader(
    tableId: string,
    viewId: string,
    ranges: number[][]
  ): Promise<IFieldVo[]> {
    const fields = await this.fieldService.getFields(tableId, { viewId });
    let headerFields: IFieldVo[] = [];
    for (let i = 0; i < ranges.length; i += 2) {
      const [start, end] = ranges.slice(i, i + 2);
      const copyFields = fields.slice(start[0], end[0] + 1);
      headerFields = headerFields.concat(copyFields);
    }
    return headerFields;
  }

  async copy(tableId: string, viewId: string, query: CopyAndPasteSchema.CopyRo) {
    const { ranges, type } = query;
    const rangesArray = JSON.parse(ranges) as number[][];
    const rangesDataArray = [];
    for (let i = 0; i < rangesArray.length; i += 2) {
      const data = await this.getRangeTableContent(tableId, viewId, rangesArray.slice(i, i + 2));
      rangesDataArray.push(data);
    }

    if (rangesArray.length === 0) {
      return;
    }

    if (rangesDataArray.length > 1 && !type) {
      throw new HttpException(
        'ranges length is more than 3, must be set type',
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }

    const copyHeader = await this.getCopyHeader(tableId, viewId, rangesArray);

    return {
      content: this.mergeRangesData(rangesDataArray, type)
        .map((row) => row.join('\t'))
        .join('\n'),
      header: copyHeader,
    };
  }

  async paste(tableId: string, viewId: string, pasteRo: CopyAndPasteSchema.PasteRo) {
    const { cell, content, header } = pasteRo;
    const [col, row] = cell;
    const tableData = this.parseCopyContent(content);
    const tableColCount = tableData[0].length;

    const rowCountInView = await this.recordService.getRowCount(
      this.prismaService,
      tableId,
      viewId
    );

    const { records } = await this.recordService.getRecords(tableId, {
      viewId,
      skip: row,
      take: tableData.length,
      fieldKeyType: FieldKeyType.Id,
    });
    const fields = await this.fieldService.getFieldInstances(tableId, { viewId });
    const effectFields = fields.slice(col, col + tableColCount);

    const tableSize: [number, number] = [fields.length, rowCountInView];
    const [numColsToExpand, numRowsToExpand] = this.calculateExpansion(tableSize, cell, tableData);

    return await this.transactionService.$transaction(
      this.shareDbService,
      async (_prisma, transactionKey) => {
        // Expansion col
        const expandColumns = await this.expandColumns({
          tableId,
          viewId,
          header,
          numColsToExpand,
          transactionKey,
        });

        // Expansion row
        const expandRows = await this.expandRows({ tableId, numRowsToExpand, transactionKey });

        // Fill cells
        await this.fillCells({
          tableId,
          cell,
          tableData,
          fields: effectFields.concat(expandColumns.map(createFieldInstanceByVo)),
          records: records.concat(expandRows.records),
          transactionKey,
        });
      }
    );
  }

  private parseCopyContent(content: string): string[][] {
    const rows = content.split('\n');
    return rows.map((row) => row.split('\t'));
  }

  private calculateExpansion(
    tableSize: [number, number],
    cell: [number, number],
    content: string[][]
  ): [number, number] {
    const [numCols, numRows] = tableSize;

    const endCol = cell[0] + content[0].length;
    const endRow = cell[1] + content.length;

    const numRowsToExpand = Math.max(0, endRow - numRows);
    const numColsToExpand = Math.max(0, endCol - numCols);

    return [numColsToExpand, numRowsToExpand];
  }

  private async fillCells({
    cell,
    tableData,
    tableId,
    fields,
    records,
    transactionKey,
  }: {
    cell: [number, number];
    tableData: string[][];
    tableId: string;
    fields: IFieldInstance[];
    records: IRecord[];
    transactionKey: string;
  }) {
    const [startCol] = cell;
    const attachments = await this.collectionAttachment({
      fields,
      tableData,
      startColumn: startCol,
    });
    for (let i = 0; i < tableData.length; i++) {
      const rowData = tableData[i];
      const recordFields: IRecord['fields'] = {};
      const row = i;
      for (let j = 0; j < rowData.length; j++) {
        const value = rowData[j];
        const col = j;
        const field = fields[col];
        if (field.isComputed) {
          continue;
        }
        recordFields[field.id] = field.convertStringToCellValue(
          value,
          nullsToUndefined(attachments)
        );
      }
      await this.recordOpenApiService.updateRecordById(
        tableId,
        records[row].id,
        {
          record: { fields: recordFields },
          fieldKeyType: FieldKeyType.Id,
        },
        transactionKey
      );
    }
  }

  private async expandRows({
    tableId,
    numRowsToExpand,
    transactionKey,
  }: {
    tableId: string;
    numRowsToExpand: number;
    transactionKey: string;
  }) {
    const records = Array.from({ length: numRowsToExpand }, () => ({ fields: {} }));
    return await this.recordOpenApiService.multipleCreateRecords(
      tableId,
      { records },
      transactionKey
    );
  }

  private async expandColumns({
    tableId,
    header,
    numColsToExpand,
    transactionKey,
  }: {
    tableId: string;
    viewId: string;
    header: IFieldVo[];
    numColsToExpand: number;
    transactionKey: string;
  }) {
    const colLen = header.length;
    const res: IFieldVo[] = [];
    for (let i = colLen - numColsToExpand; i < colLen; i++) {
      const field: IFieldRo = header[i]
        ? omit(header[i], 'id')
        : {
            type: FieldType.SingleLineText,
          };
      const fieldInstance = createFieldInstanceByRo(field);
      const newField = await this.fieldOpenApiService.createField(
        tableId,
        fieldInstance,
        transactionKey
      );
      res.push(newField);
    }
    return res;
  }

  private async collectionAttachment({
    fields,
    tableData,
    startColumn,
  }: {
    tableData: string[][];
    fields: IFieldInstance[];
    startColumn: number;
  }) {
    const attachmentFieldsIndex = fields
      .slice(startColumn)
      .map((field, index) => (field.type === FieldType.Attachment ? index : null))
      .filter(isNumber);

    const tokens = tableData.reduce((acc, recordData) => {
      const tokensInRecord = attachmentFieldsIndex.reduce((acc, index) => {
        const tokens = recordData[index]
          .split(',')
          .map(AttachmentFieldDto.getTokenByString)
          .filter(isString);
        return acc.concat(tokens);
      }, [] as string[]);
      return acc.concat(tokensInRecord);
    }, [] as string[]);

    return await this.prismaService.attachments.findMany({
      where: {
        token: {
          in: tokens,
        },
      },
      select: {
        token: true,
        size: true,
        mimetype: true,
        width: true,
        height: true,
        path: true,
        url: true,
      },
    });
  }
}
