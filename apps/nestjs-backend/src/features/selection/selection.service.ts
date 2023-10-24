import { BadRequestException, Injectable } from '@nestjs/common';
import type {
  AttachmentFieldCore,
  FieldCore,
  IFieldRo,
  IFieldVo,
  IRecord,
  IUpdateRecordsRo,
  SelectFieldCore,
} from '@teable-group/core';
import { FieldKeyType, FieldType, nullsToUndefined } from '@teable-group/core';
import { PrismaService } from '@teable-group/db-main-prisma';
import type {
  ICopyRo,
  PasteRo,
  PasteVo,
  ClearRo,
  IRangesToIdRo,
  IRangesToIdVo,
} from '@teable-group/openapi';
import { IdReturnType, RangeType } from '@teable-group/openapi';
import { isNumber, isString, map, omit } from 'lodash';
import { FieldCreatingService } from '../field/field-calculate/field-creating.service';
import { FieldSupplementService } from '../field/field-calculate/field-supplement.service';
import { FieldService } from '../field/field.service';
import type { IFieldInstance } from '../field/model/factory';
import { createFieldInstanceByVo } from '../field/model/factory';
import { AttachmentFieldDto } from '../field/model/field-dto/attachment-field.dto';
import { RecordOpenApiService } from '../record/open-api/record-open-api.service';
import { RecordService } from '../record/record.service';

@Injectable()
export class SelectionService {
  constructor(
    private recordService: RecordService,
    private fieldService: FieldService,
    private prismaService: PrismaService,
    private recordOpenApiService: RecordOpenApiService,
    private fieldCreatingService: FieldCreatingService,
    private fieldSupplementService: FieldSupplementService
  ) {}

  async getIdsFromRanges(
    tableId: string,
    viewId: string,
    query: IRangesToIdRo
  ): Promise<IRangesToIdVo> {
    const ranges = JSON.parse(query.ranges) as [number, number][];
    const { returnType, type } = query;
    if (returnType === IdReturnType.RecordId) {
      return {
        recordIds: await this.rowSelectionToIds(tableId, viewId, ranges, type),
      };
    }

    if (returnType === IdReturnType.FieldId) {
      return {
        fieldIds: await this.columnSelectionToIds(tableId, viewId, ranges, type),
      };
    }

    if (returnType === IdReturnType.All) {
      return {
        fieldIds: await this.columnSelectionToIds(tableId, viewId, ranges, type),
        recordIds: await this.rowSelectionToIds(tableId, viewId, ranges, type),
      };
    }

    throw new BadRequestException('Invalid return type');
  }

  private async columnSelectionToIds(
    tableId: string,
    viewId: string,
    ranges: [number, number][],
    type: RangeType | undefined
  ): Promise<string[]> {
    const result = await this.fieldService.getDocIdsByQuery(tableId, {
      viewId,
      filterHidden: true,
    });

    if (type === RangeType.Rows) {
      return result.ids;
    }

    if (type === RangeType.Columns) {
      return ranges.reduce<string[]>((acc, range) => {
        return acc.concat(result.ids.slice(range[0], range[1] + 1));
      }, []);
    }

    const [start, end] = ranges;
    return result.ids.slice(start[0], end[0] + 1);
  }

  private async rowSelectionToIds(
    tableId: string,
    viewId: string,
    ranges: [number, number][],
    type: RangeType | undefined
  ): Promise<string[]> {
    if (type === RangeType.Columns) {
      const result = await this.recordService.getDocIdsByQuery(tableId, {
        viewId,
        skip: 0,
        take: -1,
      });
      return result.ids;
    }

    if (type === RangeType.Rows) {
      let recordIds: string[] = [];
      for (const [start, end] of ranges) {
        const result = await this.recordService.getDocIdsByQuery(tableId, {
          viewId,
          skip: start,
          take: end + 1 - start,
        });
        recordIds = recordIds.concat(result.ids);
      }

      return ranges.reduce<string[]>((acc, range) => {
        return acc.concat(recordIds.slice(range[0], range[1] + 1));
      }, []);
    }

    const [start, end] = ranges;
    const result = await this.recordService.getDocIdsByQuery(tableId, {
      viewId,
      skip: start[1],
      take: end[1] + 1 - start[1],
    });

    return result.ids;
  }

  private async columnsSelectionCtx(tableId: string, viewId: string, ranges: [number, number][]) {
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

  private async rowsSelectionCtx(tableId: string, viewId: string, ranges: [number, number][]) {
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

  private async defaultSelectionCtx(tableId: string, viewId: string, ranges: [number, number][]) {
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
    ranges: [number, number][],
    type?: RangeType
  ) {
    switch (type) {
      case RangeType.Columns: {
        return await this.columnsSelectionCtx(tableId, viewId, ranges);
      }
      case RangeType.Rows: {
        return await this.rowsSelectionCtx(tableId, viewId, ranges);
      }
      default:
        return await this.defaultSelectionCtx(tableId, viewId, ranges);
    }
  }

  private async expandRows({
    tableId,
    numRowsToExpand,
  }: {
    tableId: string;
    numRowsToExpand: number;
  }) {
    if (numRowsToExpand === 0) {
      return [];
    }
    const records = Array.from({ length: numRowsToExpand }, () => ({ fields: {} }));
    const createdRecords = await this.recordOpenApiService.createRecords(tableId, records);
    return createdRecords.records.map(({ id, fields }) => ({ id, fields }));
  }

  private async expandColumns({
    tableId,
    header,
    numColsToExpand,
  }: {
    tableId: string;
    header: IFieldVo[];
    numColsToExpand: number;
  }) {
    const colLen = header.length;
    const res: IFieldVo[] = [];
    for (let i = colLen - numColsToExpand; i < colLen; i++) {
      const field: IFieldRo = header[i]
        ? omit(header[i], 'id')
        : {
            type: FieldType.SingleLineText,
          };
      const fieldVo = await this.fieldSupplementService.prepareCreateField(field);
      const fieldInstance = createFieldInstanceByVo(fieldVo);
      const newField = await this.fieldCreatingService.createField(tableId, fieldInstance);
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
        const tokensAndNames = recordData[index]
          .split(',')
          .map(AttachmentFieldDto.getTokenAndNameByString);
        return acc.concat(map(tokensAndNames, 'token').filter(isString));
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
    const updateRecordsRo: IUpdateRecordsRo = {
      fieldKeyType: FieldKeyType.Id,
      typecast: true,
      records: [],
    };
    fields.forEach((field, col) => {
      if (field.isComputed) {
        return;
      }
      records.forEach((record, row) => {
        const stringValue = tableData?.[row]?.[col] ?? null;
        const recordField = updateRecordsRo.records[row]?.fields || {};

        if (stringValue === null) {
          recordField[field.id] = null;
        } else {
          switch (field.type) {
            case FieldType.Attachment:
              {
                recordField[field.id] = (field as AttachmentFieldCore).convertStringToCellValue(
                  stringValue,
                  attachments
                );
              }
              break;
            case FieldType.SingleSelect:
            case FieldType.MultipleSelect:
              recordField[field.id] = (field as SelectFieldCore).convertStringToCellValue(
                stringValue,
                true
              );
              break;
            default:
              recordField[field.id] = (field as FieldCore).convertStringToCellValue(stringValue);
          }
        }

        updateRecordsRo.records[row] = {
          id: record.id,
          fields: recordField,
        };
      });
    });
    return updateRecordsRo;
  }

  async copy(tableId: string, viewId: string, query: ICopyRo) {
    const { ranges, type } = query;
    const rangesArray = JSON.parse(ranges) as [number, number][];
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

  async paste(tableId: string, viewId: string, pasteRo: PasteRo) {
    const { cell, content, header = [] } = pasteRo;
    const [col, row] = cell;
    const tableData = this.parseCopyContent(content);
    const tableColCount = tableData[0].length;
    const tableRowCount = tableData.length;

    const rowCountInView = await this.recordService.getRowCount(tableId, viewId);

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

    const updateRange: PasteVo['ranges'] = [cell, cell];

    await this.prismaService.$tx(async () => {
      // Expansion col
      const expandColumns = await this.expandColumns({
        tableId,
        header,
        numColsToExpand,
      });

      // Expansion row
      const expandRows = await this.expandRows({ tableId, numRowsToExpand });

      const updateFields = effectFields.concat(expandColumns.map(createFieldInstanceByVo));
      const updateRecords = records.concat(expandRows);

      // Fill cells
      const updateRecordsRo = await this.fillCells({
        tableData,
        fields: updateFields,
        records: updateRecords,
      });

      updateRange[1] = [col + updateFields.length - 1, row + updateFields.length - 1];
      await this.recordOpenApiService.updateRecords(tableId, updateRecordsRo);
    });

    return updateRange;
  }

  async clear(tableId: string, viewId: string, clearRo: ClearRo) {
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
