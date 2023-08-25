import { Injectable } from '@nestjs/common';
import type { IFieldRo, IFieldVo, IRecord, IUpdateRecordRo } from '@teable-group/core';
import { FieldKeyType, FieldType, nullsToUndefined } from '@teable-group/core';
import { SelectionSchema } from '@teable-group/openapi';
import { isNumber, isString, omit } from 'lodash';
import { TransactionService } from '../..//share-db/transaction.service';
import { PrismaService } from '../../prisma.service';
import { ShareDbService } from '../../share-db/share-db.service';
import { FieldSupplementService } from '../field/field-supplement.service';
import { FieldService } from '../field/field.service';
import type { IFieldInstance } from '../field/model/factory';
import { createFieldInstanceByRo, createFieldInstanceByVo } from '../field/model/factory';
import { AttachmentFieldDto } from '../field/model/field-dto/attachment-field.dto';
import { FieldOpenApiService } from '../field/open-api/field-open-api.service';
import { RecordOpenApiService } from '../record/open-api/record-open-api.service';
import { RecordService } from '../record/record.service';

@Injectable()
export class SelectionService {
  constructor(
    private recordService: RecordService,
    private fieldService: FieldService,
    private prismaService: PrismaService,
    private recordOpenApiService: RecordOpenApiService,
    private fieldOpenApiService: FieldOpenApiService,
    private fieldSupplementService: FieldSupplementService,
    private transactionService: TransactionService,
    private shareDbService: ShareDbService
  ) {}

  private async columnsSelectionCtx(tableId: string, viewId: string, ranges: number[][]) {
    const records = await this.recordService.getRecordsFields(tableId, {
      viewId,
      skip: 0,
      take: -1,
      fieldKeyType: FieldKeyType.Id,
    });
    const fields = await this.fieldService.getFields(tableId, { viewId, filterHidden: true });

    return {
      records,
      fields: ranges.reduce((acc, range) => {
        return acc.concat(fields.slice(range[0], range[1] + 1));
      }, [] as IFieldVo[]),
    };
  }

  private async rowsSelectionCtx(tableId: string, viewId: string, ranges: number[][]) {
    const fields = await this.fieldService.getFields(tableId, { viewId, filterHidden: true });
    let records: Pick<IRecord, 'id' | 'fields'>[] = [];
    for (const [start, end] of ranges) {
      const recordsFields = await this.recordService.getRecordsFields(tableId, {
        viewId,
        skip: start,
        take: end + 1 - start,
        fieldKeyType: FieldKeyType.Id,
      });
      records = records.concat(recordsFields);
    }

    return {
      records,
      fields,
    };
  }

  private async defaultSelectionCtx(tableId: string, viewId: string, ranges: number[][]) {
    const [start, end] = ranges;
    const fields = await this.fieldService.getFieldInstances(tableId, {
      viewId,
      filterHidden: true,
    });
    const records = await this.recordService.getRecordsFields(tableId, {
      viewId,
      skip: start[1],
      take: end[1] + 1 - start[1],
      fieldKeyType: FieldKeyType.Id,
    });
    return { records, fields: fields.slice(start[0], end[0] + 1) };
  }

  private async getSelectionCtxByRange(
    tableId: string,
    viewId: string,
    ranges: number[][],
    type?: SelectionSchema.RangeType
  ) {
    switch (type) {
      case SelectionSchema.RangeType.Columns: {
        return await this.columnsSelectionCtx(tableId, viewId, ranges);
      }
      case SelectionSchema.RangeType.Rows: {
        return await this.rowsSelectionCtx(tableId, viewId, ranges);
      }
      default:
        return await this.defaultSelectionCtx(tableId, viewId, ranges);
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
    const createdRecords = await this.recordOpenApiService.multipleCreateRecords(
      tableId,
      { records },
      transactionKey
    );
    return createdRecords.records.map(({ id, fields }) => ({ id, fields }));
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
      const fieldRo = await this.fieldSupplementService.prepareField(field);
      const fieldInstance = createFieldInstanceByRo(fieldRo);
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
  }: {
    tableData: string[][];
    fields: IFieldInstance[];
  }) {
    const attachmentFieldsIndex = fields
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

    return nullsToUndefined(
      await this.prismaService.attachments.findMany({
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
      })
    );
  }

  private parseCopyContent(content: string): string[][] {
    const rows = content.split('\n');
    return rows.map((row) => row.split('\t'));
  }

  private calculateExpansion(
    tableSize: [number, number],
    cell: [number, number],
    tableDataSize: [number, number]
  ): [number, number] {
    const [numCols, numRows] = tableSize;
    const [dataNumCols, dataNumRows] = tableDataSize;

    const endCol = cell[0] + dataNumCols;
    const endRow = cell[1] + dataNumRows;

    const numRowsToExpand = Math.max(0, endRow - numRows);
    const numColsToExpand = Math.max(0, endCol - numCols);

    return [numColsToExpand, numRowsToExpand];
  }

  private async fillCells({
    tableData,
    fields,
    records,
  }: {
    tableData: string[][];
    fields: IFieldInstance[];
    records: Pick<IRecord, 'id' | 'fields'>[];
  }) {
    const attachments = await this.collectionAttachment({
      fields,
      tableData,
    });
    const updateRecordsRo: (IUpdateRecordRo & { recordId: string })[] = [];
    fields.forEach((field, col) => {
      if (field.isComputed) {
        return;
      }
      records.forEach((record, row) => {
        const stringValue = tableData?.[row]?.[col] ?? null;
        const recordField = updateRecordsRo[row]?.record?.fields || {};

        if (stringValue === null) {
          recordField[field.id] = null;
        } else {
          recordField[field.id] = field.convertStringToCellValue(stringValue, attachments);
        }

        updateRecordsRo[row] = {
          recordId: record.id,
          record: { fields: recordField },
          fieldKeyType: FieldKeyType.Id,
        };
      });
    });
    return updateRecordsRo;
  }

  async copy(tableId: string, viewId: string, query: SelectionSchema.CopyRo) {
    const { ranges, type } = query;
    const rangesArray = JSON.parse(ranges) as number[][];
    const { fields, records } = await this.getSelectionCtxByRange(
      tableId,
      viewId,
      rangesArray,
      type
    );
    const fieldInstances = fields.map(createFieldInstanceByVo);
    const rectangleData = records.map((record) =>
      fieldInstances.map((fieldInstance) =>
        fieldInstance.cellValue2String(record.fields[fieldInstance.id] as never)
      )
    );
    return {
      content: rectangleData.map((row) => row.join('\t')).join('\n'),
      header: fields,
    };
  }

  async paste(tableId: string, viewId: string, pasteRo: SelectionSchema.PasteRo) {
    const { cell, content, header } = pasteRo;
    const [col, row] = cell;
    const tableData = this.parseCopyContent(content);
    const tableColCount = tableData[0].length;
    const tableRowCount = tableData.length;

    const rowCountInView = await this.recordService.getRowCount(
      this.prismaService,
      tableId,
      viewId
    );

    const records = await this.recordService.getRecordsFields(tableId, {
      viewId,
      skip: row,
      take: tableData.length,
      fieldKeyType: FieldKeyType.Id,
    });
    const fields = await this.fieldService.getFieldInstances(tableId, { viewId });
    const effectFields = fields.slice(col, col + tableColCount);

    const tableSize: [number, number] = [fields.length, rowCountInView];
    const [numColsToExpand, numRowsToExpand] = this.calculateExpansion(tableSize, cell, [
      tableColCount,
      tableRowCount,
    ]);

    const updateRange: SelectionSchema.PasteVo['ranges'] = [cell, cell];

    await this.transactionService.$transaction(
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

        const updateFields = effectFields.concat(expandColumns.map(createFieldInstanceByVo));
        const updateRecords = records.concat(expandRows);

        // Fill cells
        const updateRecordsRo = await this.fillCells({
          tableData,
          fields: updateFields,
          records: updateRecords,
        });

        updateRange[1] = [col + updateFields.length - 1, row + updateFields.length - 1];
        await this.recordOpenApiService.updateRecords(tableId, updateRecordsRo, transactionKey);
      }
    );

    return updateRange;
  }

  async clear(tableId: string, viewId: string, clearRo: SelectionSchema.ClearRo) {
    const { ranges, type } = clearRo;
    const { fields, records } = await this.getSelectionCtxByRange(tableId, viewId, ranges, type);
    const fieldInstances = fields.map(createFieldInstanceByVo);
    const updateRecordsRo = await this.fillCells({
      tableData: [],
      fields: fieldInstances,
      records,
    });

    await this.recordOpenApiService.updateRecords(tableId, updateRecordsRo);
  }
}
