import { BadRequestException, Injectable } from '@nestjs/common';
import type {
  IDateFieldOptions,
  IFieldOptionsRo,
  IFieldOptionsVo,
  IFieldRo,
  IFieldVo,
  INumberFieldOptionsRo,
  IRecord,
  ISingleLineTextFieldOptions,
  IUserFieldOptions,
} from '@teable/core';
import {
  CellValueType,
  FieldKeyType,
  FieldType,
  datetimeFormattingSchema,
  defaultDatetimeFormatting,
  defaultNumberFormatting,
  defaultUserFieldOptions,
  nullsToUndefined,
  numberFormattingSchema,
  parseClipboardText,
  singleLineTextShowAsSchema,
  singleNumberShowAsSchema,
  stringifyClipboardText,
} from '@teable/core';
import { PrismaService } from '@teable/db-main-prisma';
import type {
  IUpdateRecordsRo,
  IRangesToIdQuery,
  IRangesToIdVo,
  IPasteRo,
  IPasteVo,
  IRangesRo,
  IDeleteVo,
  ITemporaryPasteVo,
} from '@teable/openapi';
import { IdReturnType, RangeType } from '@teable/openapi';
import { isNumber, isString, map, pick } from 'lodash';
import { ClsService } from 'nestjs-cls';
import { ThresholdConfig, IThresholdConfig } from '../../configs/threshold.config';
import { EventEmitterService } from '../../event-emitter/event-emitter.service';
import { Events } from '../../event-emitter/events';
import type { IClsStore } from '../../types/cls';
import { AggregationService } from '../aggregation/aggregation.service';
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
    private readonly aggregationService: AggregationService,
    private readonly recordOpenApiService: RecordOpenApiService,
    private readonly fieldCreatingService: FieldCreatingService,
    private readonly fieldSupplementService: FieldSupplementService,
    private readonly eventEmitterService: EventEmitterService,
    private readonly cls: ClsService<IClsStore>,
    @ThresholdConfig() private readonly thresholdConfig: IThresholdConfig
  ) {}

  async getIdsFromRanges(tableId: string, query: IRangesToIdQuery): Promise<IRangesToIdVo> {
    const { returnType } = query;
    if (returnType === IdReturnType.RecordId) {
      return {
        recordIds: await this.rowSelectionToIds(tableId, query),
      };
    }

    if (returnType === IdReturnType.FieldId) {
      return {
        fieldIds: await this.columnSelectionToIds(tableId, query),
      };
    }

    if (returnType === IdReturnType.All) {
      return {
        fieldIds: await this.columnSelectionToIds(tableId, query),
        recordIds: await this.rowSelectionToIds(tableId, query),
      };
    }

    throw new BadRequestException('Invalid return type');
  }

  private async columnSelectionToIds(tableId: string, query: IRangesToIdQuery): Promise<string[]> {
    const { type, viewId, ranges, excludeFieldIds } = query;
    const result = await this.fieldService.getDocIdsByQuery(tableId, {
      viewId,
      filterHidden: true,
      excludeFieldIds,
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

  private async rowSelectionToIds(tableId: string, query: IRangesToIdQuery): Promise<string[]> {
    const { type, ranges } = query;
    if (type === RangeType.Columns) {
      const result = await this.recordService.getDocIdsByQuery(tableId, {
        ...query,
        skip: 0,
        take: -1,
      });
      return result.ids;
    }

    if (type === RangeType.Rows) {
      let recordIds: string[] = [];
      const total = ranges.reduce((acc, range) => acc + range[1] - range[0] + 1, 0);
      if (total > this.thresholdConfig.maxReadRows) {
        throw new BadRequestException(`Exceed max read rows ${this.thresholdConfig.maxReadRows}`);
      }
      for (const [start, end] of ranges) {
        const result = await this.recordService.getDocIdsByQuery(tableId, {
          ...query,
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
    const total = end[1] - start[1] + 1;
    if (total > this.thresholdConfig.maxReadRows) {
      throw new BadRequestException(`Exceed max read rows ${this.thresholdConfig.maxReadRows}`);
    }
    const result = await this.recordService.getDocIdsByQuery(tableId, {
      ...query,
      skip: start[1],
      take: end[1] + 1 - start[1],
    });

    return result.ids;
  }

  private fieldsToProjection(fields: IFieldVo[], fieldKeyType: FieldKeyType) {
    return fields.map((f) => f[fieldKeyType]);
  }

  private async columnsSelectionCtx(tableId: string, rangesRo: IRangesRo) {
    const { ranges, type, excludeFieldIds, ...queryRo } = rangesRo;

    const fields = await this.fieldService.getFieldsByQuery(tableId, {
      viewId: queryRo.viewId,
      filterHidden: true,
      excludeFieldIds,
    });

    const records = await this.recordService.getRecordsFields(tableId, {
      ...queryRo,
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

  private async rowsSelectionCtx(tableId: string, rangesRo: IRangesRo) {
    const { ranges, type, excludeFieldIds, ...queryRo } = rangesRo;
    const fields = await this.fieldService.getFieldsByQuery(tableId, {
      viewId: queryRo.viewId,
      filterHidden: true,
      excludeFieldIds,
    });
    let records: Pick<IRecord, 'id' | 'fields'>[] = [];
    for (const [start, end] of ranges) {
      const recordsFields = await this.recordService.getRecordsFields(tableId, {
        ...queryRo,
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

  private async defaultSelectionCtx(tableId: string, rangesRo: IRangesRo) {
    const { ranges, type, excludeFieldIds, ...queryRo } = rangesRo;
    const [start, end] = ranges;
    const fields = await this.fieldService.getFieldInstances(tableId, {
      viewId: queryRo.viewId,
      filterHidden: true,
      excludeFieldIds,
    });

    const selectedFields = fields.slice(start[0], end[0] + 1);

    const records = await this.recordService.getRecordsFields(tableId, {
      ...queryRo,
      skip: start[1],
      take: end[1] + 1 - start[1],
      fieldKeyType: FieldKeyType.Id,
      projection: this.fieldsToProjection(selectedFields, FieldKeyType.Id),
    });
    return { records, fields: selectedFields };
  }

  private async parseRange(
    tableId: string,
    rangesRo: IRangesRo
  ): Promise<{ cellCount: number; columnCount: number; rowCount: number }> {
    const { ranges, type, excludeFieldIds, ...queryRo } = rangesRo;
    switch (type) {
      case RangeType.Columns: {
        const { rowCount } = await this.aggregationService.performRowCount(tableId, queryRo);
        const columnCount = ranges.reduce((acc, range) => acc + range[1] - range[0] + 1, 0);
        const cellCount = rowCount * columnCount;

        return { cellCount, columnCount, rowCount };
      }
      case RangeType.Rows: {
        const fields = await this.fieldService.getFieldsByQuery(tableId, {
          viewId: queryRo.viewId,
          filterHidden: true,
          excludeFieldIds,
        });
        const columnCount = fields.length;
        const rowCount = ranges.reduce((acc, range) => acc + range[1] - range[0] + 1, 0);
        const cellCount = rowCount * columnCount;

        return { cellCount, columnCount, rowCount };
      }
      default: {
        const [start, end] = ranges;
        const columnCount = end[0] - start[0] + 1;
        const rowCount = end[1] - start[1] + 1;
        const cellCount = rowCount * columnCount;

        return { cellCount, columnCount, rowCount };
      }
    }
  }

  private async getSelectionCtxByRange(tableId: string, rangesRo: IRangesRo) {
    const { type } = rangesRo;
    switch (type) {
      case RangeType.Columns: {
        return await this.columnsSelectionCtx(tableId, rangesRo);
      }
      case RangeType.Rows: {
        return await this.rowsSelectionCtx(tableId, rangesRo);
      }
      default:
        return await this.defaultSelectionCtx(tableId, rangesRo);
    }
  }

  private optionsRoToVoByCvType(
    cellValueType: CellValueType,
    options: IFieldOptionsVo = {}
  ): { type: FieldType; options: IFieldOptionsRo } {
    switch (cellValueType) {
      case CellValueType.Number: {
        const numberOptions = options as INumberFieldOptionsRo;
        const formattingRes = numberFormattingSchema.safeParse(numberOptions?.formatting);
        const showAsRes = singleNumberShowAsSchema.safeParse(numberOptions?.showAs);
        return {
          type: FieldType.Number,
          options: {
            formatting: formattingRes.success ? formattingRes?.data : defaultNumberFormatting,
            showAs: showAsRes.success ? showAsRes?.data : undefined,
          },
        };
      }
      case CellValueType.DateTime: {
        const dateOptions = options as IDateFieldOptions;
        const formattingRes = datetimeFormattingSchema.safeParse(dateOptions?.formatting);
        return {
          type: FieldType.Date,
          options: {
            formatting: formattingRes.success ? formattingRes?.data : defaultDatetimeFormatting,
          },
        };
      }
      case CellValueType.String: {
        const singleLineTextOptions = options as ISingleLineTextFieldOptions;
        const showAsRes = singleLineTextShowAsSchema.safeParse(singleLineTextOptions.showAs);
        return {
          type: FieldType.SingleLineText,
          options: {
            showAs: showAsRes.success ? showAsRes?.data : undefined,
          },
        };
      }
      case CellValueType.Boolean: {
        return {
          type: FieldType.Checkbox,
          options: {},
        };
      }
      default:
        throw new BadRequestException('Invalid cellValueType');
    }
  }

  private lookupOptionsRoToVo(field: IFieldVo): { type: FieldType; options: IFieldOptionsRo } {
    const { type, isMultipleCellValue, options } = field;
    if (type === FieldType.SingleSelect && isMultipleCellValue) {
      return {
        type: FieldType.MultipleSelect,
        options,
      };
    }
    if (type === FieldType.User && isMultipleCellValue) {
      const userOptions = options as IUserFieldOptions;
      return {
        type,
        options: {
          ...userOptions,
          isMultiple: true,
        },
      };
    }
    return { type, options };
  }

  private fieldVoToRo(field?: IFieldVo): IFieldRo {
    if (!field) {
      return {
        type: FieldType.SingleLineText,
      };
    }
    const { isComputed, isLookup } = field;
    const baseField = pick(field, 'name', 'type', 'options', 'description');

    if (isComputed && !isLookup) {
      if ([FieldType.CreatedBy, FieldType.LastModifiedBy].includes(field.type)) {
        return {
          ...baseField,
          type: FieldType.User,
          options: defaultUserFieldOptions,
        };
      }
      return {
        ...baseField,
        ...this.optionsRoToVoByCvType(field.cellValueType, field.options),
      };
    }

    if (isLookup) {
      return {
        ...baseField,
        ...this.lookupOptionsRoToVo(field),
      };
    }

    return baseField;
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
      const field = this.fieldVoToRo(header[i]);
      const fieldVo = await this.fieldSupplementService.prepareCreateField(tableId, field);
      const fieldInstance = createFieldInstanceByVo(fieldVo);
      // expend columns do not need to calculate
      await this.fieldCreatingService.alterCreateField(tableId, fieldInstance);
      res.push(fieldVo);
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
        if (!recordData[index]) return acc;

        const tokensAndNames = recordData[index]
          .split(',')
          .map(AttachmentFieldDto.getTokenAndNameByString);
        return acc.concat(map(tokensAndNames, 'token').filter(isString));
      }, [] as string[]);
      return acc.concat(tokensInRecord);
    }, [] as string[]);

    const attachments = await this.prismaService.attachments.findMany({
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
    });
    return attachments.map(nullsToUndefined);
  }

  private parseCopyContent(content: string): string[][] {
    return parseClipboardText(content);
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

  private async tableDataToRecords({
    tableId,
    tableData,
    fields,
    headerFields,
  }: {
    tableId: string;
    tableData: string[][];
    fields: IFieldInstance[];
    headerFields: IFieldInstance[] | undefined;
  }) {
    const fieldConvertContext = await this.fieldConvertContext(tableId, tableData, fields);

    const records: { fields: IRecord['fields'] }[] = [];
    fields.forEach((field, col) => {
      if (field.isComputed) {
        return;
      }
      tableData.forEach((cellCols, row) => {
        const stringValue = cellCols?.[col] ?? null;
        const recordField = records[row]?.fields || {};

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
            case FieldType.Date:
              // handle format
              recordField[field.id] = (headerFields?.[col] || field).convertStringToCellValue(
                stringValue
              );
              break;
            default:
              recordField[field.id] = stringValue || null;
          }
        }

        records[row] = {
          fields: recordField,
        };
      });
    });
    return records;
  }

  private fillCells(
    oldRecords: {
      id: string;
      fields: IRecord['fields'];
    }[],
    newRecords?: { fields: IRecord['fields'] }[]
  ): IUpdateRecordsRo {
    return {
      fieldKeyType: FieldKeyType.Id,
      typecast: true,
      records: oldRecords.map(({ id, fields }, index) => {
        const newFields = newRecords?.[index]?.fields;
        const updateFields = newFields ? { ...fields, ...newFields } : {};
        return {
          id,
          fields: updateFields,
        };
      }),
    };
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

    const [attachments] = await Promise.all([loadAttachments]);

    return {
      attachments: attachments,
    };
  }

  async copy(tableId: string, rangesRo: IRangesRo) {
    const { cellCount } = await this.parseRange(tableId, rangesRo);

    if (cellCount > this.thresholdConfig.maxCopyCells) {
      throw new BadRequestException(`Exceed max copy cells ${this.thresholdConfig.maxCopyCells}`);
    }

    const { fields, records } = await this.getSelectionCtxByRange(tableId, rangesRo);
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

  // For pasting to add new lines
  async temporaryPaste(tableId: string, pasteRo: IPasteRo) {
    const { content, header = [], viewId, ranges, excludeFieldIds } = pasteRo;

    const fields = await this.fieldService.getFieldInstances(tableId, {
      viewId,
      filterHidden: true,
      excludeFieldIds: excludeFieldIds,
    });

    const rangeCell = ranges as [[number, number], [number, number]];
    const startColumnIndex = rangeCell[0][0];

    const tableData = this.expandPasteContent(this.parseCopyContent(content), rangeCell);
    const tableColCount = tableData[0].length;
    const effectFields = fields.slice(startColumnIndex, startColumnIndex + tableColCount);
    let result: ITemporaryPasteVo = [];

    await this.prismaService.$tx(async () => {
      const newRecords = await this.tableDataToRecords({
        tableId,
        tableData,
        headerFields: header.map(createFieldInstanceByVo),
        fields: effectFields,
      });

      result = await this.recordOpenApiService.validateFieldsAndTypecast(
        tableId,
        newRecords,
        FieldKeyType.Id,
        true
      );
    });

    return result;
  }

  async paste(
    tableId: string,
    pasteRo: IPasteRo,
    expansionChecker?: (col: number, row: number) => Promise<void>,
    windowId?: string
  ) {
    const { content, header = [], ...rangesRo } = pasteRo;
    const { ranges, type, ...queryRo } = rangesRo;
    const { viewId } = queryRo;
    const { cellCount } = await this.parseRange(tableId, rangesRo);

    if (cellCount > this.thresholdConfig.maxPasteCells) {
      throw new BadRequestException(`Exceed max paste cells ${this.thresholdConfig.maxPasteCells}`);
    }

    const { rowCount: rowCountInView } = await this.aggregationService.performRowCount(
      tableId,
      queryRo
    );
    const fields = await this.fieldService.getFieldInstances(tableId, {
      viewId,
      filterHidden: true,
      excludeFieldIds: rangesRo.excludeFieldIds,
    });

    const tableSize: [number, number] = [fields.length, rowCountInView];
    const rangeCell = this.getRangeCell(
      [
        [0, 0],
        [tableSize[0] - 1, tableSize[1] - 1],
      ],
      ranges,
      type
    );

    const tableData = this.expandPasteContent(this.parseCopyContent(content), rangeCell);
    const tableColCount = tableData[0].length;
    const tableRowCount = tableData.length;

    const cell = rangeCell[0];
    const [col, row] = cell;

    const effectFields = fields.slice(col, col + tableColCount);

    const projection = effectFields.map((f) => f.id);

    const existingRecords = await this.recordService.getRecordsFields(tableId, {
      ...queryRo,
      projection,
      skip: row,
      take: tableData.length,
      fieldKeyType: FieldKeyType.Id,
    });

    const [numColsToExpand, numRowsToExpand] = this.calculateExpansion(tableSize, cell, [
      tableColCount,
      tableRowCount,
    ]);
    await expansionChecker?.(numColsToExpand, numRowsToExpand);

    const updateRange: IPasteVo['ranges'] = [cell, cell];

    const newFields = await this.prismaService.$tx(async () => {
      // Expansion col
      return await this.expandColumns({
        tableId,
        header,
        numColsToExpand,
      });
    });

    const { updateRecords, newRecords } = await this.prismaService.$tx(async () => {
      const updateFields = effectFields.concat(newFields.map(createFieldInstanceByVo));

      // get all effect records, contains update and need create record
      const recordsFromClipboard = await this.tableDataToRecords({
        tableId,
        tableData,
        headerFields: header.map(createFieldInstanceByVo),
        fields: updateFields,
      });

      // Warning: Update before creating
      // Fill cells
      const toUpdateRecords = recordsFromClipboard.slice(0, existingRecords.length);
      const updateRecordsRo = this.fillCells(existingRecords, toUpdateRecords);
      const { cellContexts } = await this.recordOpenApiService.updateRecords(
        tableId,
        updateRecordsRo
      );

      let newRecords: IRecord[] | undefined;
      // create record
      if (numRowsToExpand) {
        const createNewRecords = recordsFromClipboard.slice(existingRecords.length);
        const createRecordsRo = {
          fieldKeyType: FieldKeyType.Id,
          typecast: true,
          records: createNewRecords,
        };
        newRecords = (await this.recordOpenApiService.createRecords(tableId, createRecordsRo))
          .records;
      }

      updateRange[1] = [col + updateFields.length - 1, row + updateFields.length - 1];

      return {
        updateRecords: {
          cellContexts,
          recordIds: existingRecords.map(({ id }) => id),
          fieldIds: updateFields.map(({ id }) => id),
        },
        newRecords,
      };
    });

    if (windowId) {
      this.eventEmitterService.emitAsync(Events.OPERATION_PASTE_SELECTION, {
        windowId,
        userId: this.cls.get('user.id'),
        tableId,
        updateRecords,
        newFields,
        newRecords,
      });
    }

    return updateRange;
  }

  async clear(tableId: string, rangesRo: IRangesRo, windowId?: string) {
    const { fields, records } = await this.getSelectionCtxByRange(tableId, rangesRo);
    const fieldInstances = fields.map(createFieldInstanceByVo);
    const updateRecords = await this.tableDataToRecords({
      tableId,
      tableData: Array.from({ length: records.length }, () => []),
      fields: fieldInstances,
      headerFields: undefined,
    });
    const updateRecordsRo = this.fillCells(records, updateRecords);
    await this.recordOpenApiService.updateRecords(tableId, updateRecordsRo, windowId);
  }

  async delete(tableId: string, rangesRo: IRangesRo, windowId?: string): Promise<IDeleteVo> {
    const { records } = await this.getSelectionCtxByRange(tableId, rangesRo);
    const recordIds = records.map(({ id }) => id);
    await this.recordOpenApiService.deleteRecords(tableId, recordIds, windowId);
    return { ids: recordIds };
  }
}
