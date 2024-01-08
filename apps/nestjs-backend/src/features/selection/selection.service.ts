import { BadRequestException, Injectable } from '@nestjs/common';
import type { IFieldRo, IFieldVo, IRecord, IUpdateRecordsRo } from '@teable-group/core';
import {
  FieldKeyType,
  FieldType,
  nullsToUndefined,
  parseClipboardText,
  stringifyClipboardText,
} from '@teable-group/core';
import { PrismaService } from '@teable-group/db-main-prisma';
import type {
  ClearRo,
  ICopyRo,
  IRangesToIdRo,
  IRangesToIdVo,
  PasteRo,
  PasteVo,
} from '@teable-group/openapi';
import { IdReturnType, RangeType } from '@teable-group/openapi';
import { isNumber, isString, map, omit } from 'lodash';
import { ClsService } from 'nestjs-cls';
import type { IClsStore } from '../../types/cls';
import { AggregationService } from '../aggregation/aggregation.service';
import { CollaboratorService } from '../collaborator/collaborator.service';
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
    private readonly recordService: RecordService,
    private readonly fieldService: FieldService,
    private readonly prismaService: PrismaService,
    private readonly recordOpenApiService: RecordOpenApiService,
    private readonly fieldCreatingService: FieldCreatingService,
    private readonly fieldSupplementService: FieldSupplementService,
    private readonly collaboratorService: CollaboratorService,
    private readonly cls: ClsService<IClsStore>,
    private readonly aggregationService: AggregationService
  ) {}

  async getIdsFromRanges(
    tableId: string,
    viewId: string,
    query: IRangesToIdRo & { queryUserId?: string }
  ): Promise<IRangesToIdVo> {
    const ranges = JSON.parse(query.ranges) as [number, number][];
    const { returnType, type, queryUserId } = query;
    if (returnType === IdReturnType.RecordId) {
      return {
        recordIds: await this.rowSelectionToIds(tableId, viewId, ranges, type, queryUserId),
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
        recordIds: await this.rowSelectionToIds(tableId, viewId, ranges, type, queryUserId),
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
    type: RangeType | undefined,
    queryUserId?: string
  ): Promise<string[]> {
    if (type === RangeType.Columns) {
      const result = await this.recordService.getDocIdsByQuery(tableId, {
        viewId,
        queryUserId,
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
          queryUserId,
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
      queryUserId,
      skip: start[1],
      take: end[1] + 1 - start[1],
    });

    return result.ids;
  }

  private fieldsToProjection(fields: IFieldVo[], fieldKeyType: FieldKeyType) {
    return fields.reduce(
      (acc, field) => {
        acc[field[fieldKeyType]] = true;
        return acc;
      },
      {} as Record<string, boolean>
    );
  }

  private async columnsSelectionCtx(
    tableId: string,
    viewId: string,
    ranges: [number, number][],
    queryUserId?: string
  ) {
    const fields = await this.fieldService.getFieldsByQuery(tableId, {
      viewId,
      filterHidden: true,
    });
    const records = await this.recordService.getRecordsFields(tableId, {
      viewId,
      queryUserId,
      skip: 0,
      take: -1,
      fieldKeyType: FieldKeyType.Id,
      projection: this.fieldsToProjection(fields, FieldKeyType.Id),
    });

    return {
      records,
      fields: ranges.reduce((acc, range) => {
        return acc.concat(fields.slice(range[0], range[1] + 1));
      }, [] as IFieldVo[]),
    };
  }

  private async rowsSelectionCtx(
    tableId: string,
    viewId: string,
    ranges: [number, number][],
    queryUserId?: string
  ) {
    const fields = await this.fieldService.getFieldsByQuery(tableId, {
      viewId,
      filterHidden: true,
    });
    let records: Pick<IRecord, 'id' | 'fields'>[] = [];
    for (const [start, end] of ranges) {
      const recordsFields = await this.recordService.getRecordsFields(tableId, {
        viewId,
        queryUserId,
        skip: start,
        take: end + 1 - start,
        fieldKeyType: FieldKeyType.Id,
        projection: this.fieldsToProjection(fields, FieldKeyType.Id),
      });
      records = records.concat(recordsFields);
    }

    return {
      records,
      fields,
    };
  }

  private async defaultSelectionCtx(
    tableId: string,
    viewId: string,
    ranges: [number, number][],
    queryUserId?: string
  ) {
    const [start, end] = ranges;
    const fields = await this.fieldService.getFieldInstances(tableId, {
      viewId,
      filterHidden: true,
    });
    const records = await this.recordService.getRecordsFields(tableId, {
      viewId,
      queryUserId,
      skip: start[1],
      take: end[1] + 1 - start[1],
      fieldKeyType: FieldKeyType.Id,
      projection: this.fieldsToProjection(fields, FieldKeyType.Id),
    });
    return { records, fields: fields.slice(start[0], end[0] + 1) };
  }

  private async getSelectionCtxByRange(
    tableId: string,
    viewId: string,
    ranges: [number, number][],
    type?: RangeType,
    queryUserId?: string
  ) {
    switch (type) {
      case RangeType.Columns: {
        return await this.columnsSelectionCtx(tableId, viewId, ranges, queryUserId);
      }
      case RangeType.Rows: {
        return await this.rowsSelectionCtx(tableId, viewId, ranges, queryUserId);
      }
      default:
        return await this.defaultSelectionCtx(tableId, viewId, ranges, queryUserId);
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
      const fieldVo = await this.fieldSupplementService.prepareCreateField(tableId, field);
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
        },
      })
    );
  }

  private parseCopyContent(content: string): string[][] {
    const { error, data } = parseClipboardText(content);
    if (error) {
      throw new BadRequestException(error);
    }
    return data;
  }

  private stringifyCopyContent(content: string[][]): string {
    return stringifyClipboardText(content);
  }

  private calculateExpansion(
    tableSize: [number, number],
    cell: [number, number],
    tableDataSize: [number, number]
  ): [number, number] {
    const permissions = this.cls.get('permissions');
    const [numCols, numRows] = tableSize;
    const [dataNumCols, dataNumRows] = tableDataSize;

    const endCol = cell[0] + dataNumCols;
    const endRow = cell[1] + dataNumRows;

    const numRowsToExpand = Math.max(0, endRow - numRows);
    const numColsToExpand = Math.max(0, endCol - numCols);

    const hasFieldCreatePermission = permissions.includes('field|create');
    const hasRecordCreatePermission = permissions.includes('record|create');
    return [
      hasFieldCreatePermission ? numColsToExpand : 0,
      hasRecordCreatePermission ? numRowsToExpand : 0,
    ];
  }

  private async fillCells({
    tableId,
    tableData,
    fields,
    records,
  }: {
    tableId: string;
    tableData: string[][];
    fields: IFieldInstance[];
    records: Pick<IRecord, 'id' | 'fields'>[];
  }) {
    const fieldConvertContext = await this.fieldConvertContext(tableId, tableData, fields);

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
                recordField[field.id] = field.convertStringToCellValue(
                  stringValue,
                  fieldConvertContext?.attachments
                );
              }
              break;
            case FieldType.SingleSelect:
            case FieldType.MultipleSelect:
              recordField[field.id] = field.convertStringToCellValue(stringValue, true);
              break;
            case FieldType.User:
              recordField[field.id] = field.convertStringToCellValue(stringValue, {
                userSets: fieldConvertContext?.userSets,
              });
              break;
            default:
              recordField[field.id] = field.convertStringToCellValue(stringValue);
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

  private async fieldConvertContext(
    tableId: string,
    tableData: string[][],
    fields: IFieldInstance[]
  ) {
    const hasFieldType = (type: FieldType) => fields.some((field) => field.type === type);

    const loadAttachments = hasFieldType(FieldType.Attachment)
      ? this.collectionAttachment({ fields, tableData })
      : Promise.resolve(undefined);

    const loadUserSets = hasFieldType(FieldType.User)
      ? this.collaboratorService.getBaseCollabsWithPrimary(tableId)
      : Promise.resolve(undefined);

    const [attachments, userSets] = await Promise.all([loadAttachments, loadUserSets]);

    return {
      attachments: attachments,
      userSets: userSets,
    };
  }

  async copy(tableId: string, viewId: string, query: ICopyRo & { queryUserId?: string }) {
    const { ranges, type, queryUserId } = query;
    const rangesArray = JSON.parse(ranges) as [number, number][];
    const { fields, records } = await this.getSelectionCtxByRange(
      tableId,
      viewId,
      rangesArray,
      type,
      queryUserId
    );
    const fieldInstances = fields.map(createFieldInstanceByVo);
    const rectangleData = records.map((record) =>
      fieldInstances.map((fieldInstance) =>
        fieldInstance.cellValue2String(record.fields[fieldInstance.id] as never)
      )
    );
    return {
      content: this.stringifyCopyContent(rectangleData),
      header: fields,
    };
  }

  // If the pasted selection is twice the size of the content,
  // the content is automatically expanded to the selection size
  private expandPasteContent(pasteData: string[][], range: [[number, number], [number, number]]) {
    const [start, end] = range;
    const [startCol, startRow] = start;
    const [endCol, endRow] = end;

    const rangeRows = endRow - startRow + 1;
    const rangeCols = endCol - startCol + 1;

    const pasteRows = pasteData.length;
    const pasteCols = pasteData[0].length;

    if (rangeRows % pasteRows !== 0 || rangeCols % pasteCols !== 0) {
      return pasteData;
    }

    return Array.from({ length: rangeRows }, (_, i) =>
      Array.from({ length: rangeCols }, (_, j) => pasteData[i % pasteRows][j % pasteCols])
    );
  }

  // Paste does not support non-contiguous selections,
  // the first selection is taken by default.
  private getRangeCell(
    maxRange: [number, number][],
    range: [number, number][],
    type?: RangeType
  ): [[number, number], [number, number]] {
    const [maxStart, maxEnd] = maxRange;
    const [maxStartCol, maxStartRow] = maxStart;
    const [maxEndCol, maxEndRow] = maxEnd;

    if (type === RangeType.Columns) {
      return [
        [range[0][0], maxStartRow],
        [range[0][1], maxEndRow],
      ];
    }

    if (type === RangeType.Rows) {
      return [
        [maxStartCol, range[0][0]],
        [maxEndCol, range[0][1]],
      ];
    }
    return [range[0], range[1]];
  }

  async paste(tableId: string, viewId: string, pasteRo: PasteRo & { queryUserId?: string }) {
    const { range, type, content, header = [], queryUserId } = pasteRo;

    const { rowCount: rowCountInView } = await this.aggregationService.performRowCount({
      tableId,
      withView: { viewId },
      withUserId: queryUserId,
    });
    const fields = await this.fieldService.getFieldInstances(tableId, {
      viewId,
      filterHidden: true,
    });

    const tableSize: [number, number] = [fields.length, rowCountInView];
    const rangeCell = this.getRangeCell(
      [
        [0, 0],
        [tableSize[0] - 1, tableSize[1] - 1],
      ],
      range,
      type
    );

    const tableData = this.expandPasteContent(this.parseCopyContent(content), rangeCell);
    const tableColCount = tableData[0].length;
    const tableRowCount = tableData.length;

    const cell = rangeCell[0];
    const [col, row] = cell;
    const records = await this.recordService.getRecordsFields(tableId, {
      viewId,
      skip: row,
      take: tableData.length,
      fieldKeyType: FieldKeyType.Id,
    });

    const effectFields = fields.slice(col, col + tableColCount);

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
        tableId,
        tableData,
        fields: updateFields,
        records: updateRecords,
      });

      updateRange[1] = [col + updateFields.length - 1, row + updateFields.length - 1];
      await this.recordOpenApiService.updateRecords(tableId, updateRecordsRo);
    });

    return updateRange;
  }

  async clear(tableId: string, viewId: string, clearRo: ClearRo & { queryUserId?: string }) {
    const { ranges, type, queryUserId } = clearRo;
    const { fields, records } = await this.getSelectionCtxByRange(
      tableId,
      viewId,
      ranges,
      type,
      queryUserId
    );
    const fieldInstances = fields.map(createFieldInstanceByVo);
    const updateRecordsRo = await this.fillCells({
      tableId,
      tableData: [],
      fields: fieldInstances,
      records,
    });

    await this.recordOpenApiService.updateRecords(tableId, updateRecordsRo);
  }
}
