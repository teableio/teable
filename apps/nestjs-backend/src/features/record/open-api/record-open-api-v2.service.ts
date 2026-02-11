/* eslint-disable @typescript-eslint/naming-convention */
/* eslint-disable sonarjs/cognitive-complexity */
import { Injectable, HttpException, HttpStatus, Inject, forwardRef } from '@nestjs/common';
import { trace } from '@opentelemetry/api';
import { FieldKeyType, generateOperationId, parseClipboardText } from '@teable/core';
import type { IFilterSet } from '@teable/core';
import type {
  IUpdateRecordRo,
  IFormSubmitRo,
  IRecord,
  ICreateRecordsRo,
  ICreateRecordsVo,
  IPasteRo,
  IPasteVo,
  IRangesRo,
  IRecordsVo,
  IRecordInsertOrderRo,
  IUpdateRecordsRo,
} from '@teable/openapi';
import { RangeType } from '@teable/openapi';
import {
  executeCreateRecordsEndpoint,
  executeSubmitRecordEndpoint,
  executeDeleteRecordsEndpoint,
  executeDeleteByRangeEndpoint,
  executePasteEndpoint,
  executeClearEndpoint,
  executeUpdateRecordEndpoint,
  executeDuplicateRecordEndpoint,
  executeReorderRecordsEndpoint,
} from '@teable/v2-contract-http-implementation/handlers';
import { v2CoreTokens } from '@teable/v2-core';
import type {
  ICommandBus,
  RecordFilter,
  RecordFilterGroup,
  RecordFilterNode,
  RecordFilterOperator,
  RecordFilterValue,
} from '@teable/v2-core';
import { ClsService } from 'nestjs-cls';
import { CustomHttpException, getDefaultCodeByStatus } from '../../../custom.exception';
import { EventEmitterService } from '../../../event-emitter/event-emitter.service';
import { Events } from '../../../event-emitter/events';
import type { IClsStore } from '../../../types/cls';
import { AggregationService } from '../../aggregation/aggregation.service';
import { FieldService } from '../../field/field.service';
import { SelectionService } from '../../selection/selection.service';
import { TableService } from '../../table/table.service';
import { TableDomainQueryService } from '../../table-domain';
import { V2ContainerService } from '../../v2/v2-container.service';
import { V2ExecutionContextFactory } from '../../v2/v2-execution-context.factory';
import { RecordService } from '../record.service';
import { RecordOpenApiService } from './record-open-api.service';

const internalServerError = 'Internal server error';
const v1SymbolOperatorMap: Record<string, string> = {
  '=': 'is',
  '!=': 'isNot',
  '>': 'isGreater',
  '>=': 'isGreaterEqual',
  '<': 'isLess',
  '<=': 'isLessEqual',
  LIKE: 'contains',
  'NOT LIKE': 'doesNotContain',
  IN: 'isAnyOf',
  'NOT IN': 'isNoneOf',
  HAS: 'hasAllOf',
  'IS NULL': 'isEmpty',
  'IS NOT NULL': 'isNotEmpty',
  'IS WITH IN': 'isWithIn',
};

@Injectable()
export class RecordOpenApiV2Service {
  constructor(
    private readonly v2ContainerService: V2ContainerService,
    private readonly v2ContextFactory: V2ExecutionContextFactory,
    private readonly recordService: RecordService,
    private readonly recordOpenApiService: RecordOpenApiService,
    private readonly tableService: TableService,
    private readonly cls: ClsService<IClsStore>,
    private readonly fieldService: FieldService,
    private readonly aggregationService: AggregationService,
    private readonly eventEmitterService: EventEmitterService,
    private readonly tableDomainQueryService: TableDomainQueryService,
    @Inject(forwardRef(() => SelectionService))
    private readonly selectionService: SelectionService
  ) {}

  private throwV2Error(
    error: {
      code: string;
      message: string;
      tags?: ReadonlyArray<string>;
      details?: Readonly<Record<string, unknown>>;
    },
    status: number
  ): never {
    throw new CustomHttpException(error.message, getDefaultCodeByStatus(status), {
      domainCode: error.code,
      domainTags: error.tags,
      details: error.details,
    });
  }

  async updateRecord(
    tableId: string,
    recordId: string,
    updateRecordRo: IUpdateRecordRo,
    windowId?: string,
    isAiInternal?: string
  ): Promise<IRecord> {
    const order = updateRecordRo.order;
    const hasOrder = Boolean(order);
    const fields = updateRecordRo.record.fields ?? {};
    const hasFields = Object.keys(fields).length > 0;

    const container = await this.v2ContainerService.getContainer();
    const commandBus = container.resolve<ICommandBus>(v2CoreTokens.commandBus);
    const context = await this.v2ContextFactory.createContext();

    if (hasFields) {
      // Convert v1 input format to v2 format
      // v1: { record: { fields: { fieldKey: value } } }
      // v2: { tableId, recordId, fields: { fieldId: value } }
      // v1 stores select field values by name, v2 stores by id
      // Preserve v1's default typecast behavior (false) to ensure proper validation
      const v2Input = {
        tableId,
        recordId,
        fields,
        typecast: updateRecordRo.typecast ?? false,
        fieldKeyType: updateRecordRo.fieldKeyType,
      };

      const result = await executeUpdateRecordEndpoint(context, v2Input, commandBus);
      if (!(result.status === 200 && result.body.ok)) {
        if (!result.body.ok) {
          this.throwV2Error(result.body.error, result.status);
        }
        throw new HttpException(internalServerError, HttpStatus.INTERNAL_SERVER_ERROR);
      }
    }

    if (hasOrder && order) {
      const reorderResult = await executeReorderRecordsEndpoint(
        context,
        {
          tableId,
          recordIds: [recordId],
          order: {
            viewId: order.viewId,
            anchorId: order.anchorId,
            position: order.position,
          },
        },
        commandBus
      );
      if (!(reorderResult.status === 200 && reorderResult.body.ok)) {
        if (!reorderResult.body.ok) {
          this.throwV2Error(reorderResult.body.error, reorderResult.status);
        }
        throw new HttpException(internalServerError, HttpStatus.INTERNAL_SERVER_ERROR);
      }
    }

    if (hasFields || hasOrder) {
      const snapshots = await this.recordService.getSnapshotBulkWithPermission(
        tableId,
        [recordId],
        undefined,
        updateRecordRo.fieldKeyType || FieldKeyType.Name,
        undefined,
        true
      );

      if (snapshots.length === 1) {
        return snapshots[0].data as IRecord;
      }

      throw new HttpException(internalServerError, HttpStatus.INTERNAL_SERVER_ERROR);
    }
    throw new HttpException(internalServerError, HttpStatus.INTERNAL_SERVER_ERROR);
  }

  async updateRecords(
    tableId: string,
    updateRecordsRo: IUpdateRecordsRo,
    windowId?: string,
    isAiInternal?: string
  ): Promise<IRecord[]> {
    const order = updateRecordsRo.order;
    const records = updateRecordsRo.records ?? [];
    const recordIds = records.map((record) => record.id);
    const hasOrder = Boolean(order);
    const hasFields = records.some(
      (record) => record.fields && Object.keys(record.fields).length > 0
    );

    if (!hasOrder || hasFields) {
      return (
        await this.recordOpenApiService.updateRecords(
          tableId,
          updateRecordsRo,
          windowId,
          isAiInternal
        )
      ).records;
    }

    const container = await this.v2ContainerService.getContainer();
    const commandBus = container.resolve<ICommandBus>(v2CoreTokens.commandBus);
    const context = await this.v2ContextFactory.createContext();

    if (hasOrder && order) {
      const reorderResult = await executeReorderRecordsEndpoint(
        context,
        {
          tableId,
          recordIds,
          order: {
            viewId: order.viewId,
            anchorId: order.anchorId,
            position: order.position,
          },
        },
        commandBus
      );
      if (!(reorderResult.status === 200 && reorderResult.body.ok)) {
        if (!reorderResult.body.ok) {
          this.throwV2Error(reorderResult.body.error, reorderResult.status);
        }
        throw new HttpException(internalServerError, HttpStatus.INTERNAL_SERVER_ERROR);
      }
    }

    if (recordIds.length === 0) {
      return [];
    }

    const snapshots = await this.recordService.getSnapshotBulkWithPermission(
      tableId,
      recordIds,
      undefined,
      updateRecordsRo.fieldKeyType || FieldKeyType.Name,
      undefined,
      true
    );

    if (snapshots.length !== recordIds.length) {
      throw new HttpException(internalServerError, HttpStatus.INTERNAL_SERVER_ERROR);
    }

    const snapshotMap = new Map(snapshots.map((snapshot) => [snapshot.data.id, snapshot.data]));
    const resultRecords = recordIds
      .map((recordId) => snapshotMap.get(recordId))
      .filter((record): record is IRecord => Boolean(record));

    if (resultRecords.length !== recordIds.length) {
      throw new HttpException(internalServerError, HttpStatus.INTERNAL_SERVER_ERROR);
    }

    return resultRecords;
  }

  async createRecords(
    tableId: string,
    createRecordsRo: ICreateRecordsRo,
    isAiInternal?: string
  ): Promise<ICreateRecordsVo> {
    const container = await this.v2ContainerService.getContainer();
    const commandBus = container.resolve<ICommandBus>(v2CoreTokens.commandBus);
    const context = await this.v2ContextFactory.createContext();

    // Preserve v1's default typecast behavior (false) to ensure proper validation
    const records = createRecordsRo.records;

    const result = await executeCreateRecordsEndpoint(
      context,
      {
        tableId,
        records,
        typecast: createRecordsRo.typecast ?? false,
        fieldKeyType: createRecordsRo.fieldKeyType,
        order: createRecordsRo.order,
      },
      commandBus
    );

    if (result.status === 201 && result.body.ok) {
      const recordIds = result.body.data.records.map((record) => record.id);
      if (recordIds.length === 0) {
        return { records: [] };
      }

      const snapshots = await this.recordService.getSnapshotBulkWithPermission(
        tableId,
        recordIds,
        undefined,
        createRecordsRo.fieldKeyType || FieldKeyType.Name,
        undefined,
        true
      );

      if (snapshots.length !== recordIds.length) {
        throw new HttpException(internalServerError, HttpStatus.INTERNAL_SERVER_ERROR);
      }

      const snapshotMap = new Map(snapshots.map((snapshot) => [snapshot.data.id, snapshot.data]));
      const resultRecords = recordIds
        .map((recordId) => snapshotMap.get(recordId))
        .filter((record): record is IRecord => Boolean(record));

      if (resultRecords.length !== recordIds.length) {
        throw new HttpException(internalServerError, HttpStatus.INTERNAL_SERVER_ERROR);
      }

      return { records: resultRecords };
    }

    if (!result.body.ok) {
      this.throwV2Error(result.body.error, result.status);
    }

    throw new HttpException(internalServerError, HttpStatus.INTERNAL_SERVER_ERROR);
  }

  async formSubmit(tableId: string, formSubmitRo: IFormSubmitRo): Promise<IRecord> {
    const container = await this.v2ContainerService.getContainer();
    const commandBus = container.resolve<ICommandBus>(v2CoreTokens.commandBus);
    const context = await this.v2ContextFactory.createContext();

    const result = await executeSubmitRecordEndpoint(
      context,
      {
        tableId,
        formId: formSubmitRo.viewId,
        fields: formSubmitRo.fields,
        typecast: formSubmitRo.typecast ?? false,
      },
      commandBus
    );

    if (result.status === 201 && result.body.ok) {
      const recordId = result.body.data.record.id;
      const snapshots = await this.recordService.getSnapshotBulkWithPermission(
        tableId,
        [recordId],
        undefined,
        FieldKeyType.Id,
        undefined,
        true
      );

      if (snapshots.length !== 1) {
        throw new HttpException(internalServerError, HttpStatus.INTERNAL_SERVER_ERROR);
      }

      return snapshots[0].data as IRecord;
    }

    if (!result.body.ok) {
      this.throwV2Error(result.body.error, result.status);
    }

    throw new HttpException(internalServerError, HttpStatus.INTERNAL_SERVER_ERROR);
  }

  async paste(
    tableId: string,
    pasteRo: IPasteRo,
    options?: { updateFilter?: IFilterSet | null; windowId?: string }
  ): Promise<IPasteVo> {
    const container = await this.v2ContainerService.getContainer();
    const commandBus = container.resolve<ICommandBus>(v2CoreTokens.commandBus);
    const context = await this.v2ContextFactory.createContext();
    const userId = this.cls.get('user.id');
    const windowId = options?.windowId;
    const tracer = trace.getTracer('default');

    // Convert v1 input format to v2 format
    // v1 ranges format depends on type:
    // - default (cell range): [[startCol, startRow], [endCol, endRow]]
    // - columns: [[startCol, endCol]] - single element array
    // - rows: [[startRow, endRow]] - single element array
    // v2 now supports type parameter directly and handles the conversion internally
    const { ranges, content, viewId, header, type, projection, filter, orderBy } = pasteRo;

    let fallbackRanges: IPasteVo['ranges'] | null = null;
    let v2Input: unknown;
    let finalContent: unknown[][] = [];
    let startCol = 0;
    let startRow = 0;
    let truncatedRows = 0;

    await tracer.startActiveSpan('teable.paste.v2.prepare', async (span) => {
      try {
        // Parse content if it's a string (tab-separated values)
        let parsedContent: unknown[][] =
          typeof content === 'string' ? this.parseCopyContent(content) : content;

        // Get permissions to check for field|create and record|create
        const permissions = this.cls.get('permissions') ?? [];
        const hasFieldCreatePermission = permissions.includes('field|create');
        const hasRecordCreatePermission = permissions.includes('record|create');

        // Get table size to calculate expansion needs
        const resolvedViewId = await this.resolveViewId(tableId, viewId);
        const queryRo = { viewId: resolvedViewId, filter, projection, orderBy };

        const fields = await this.fieldService.getFieldInstances(tableId, {
          viewId: resolvedViewId,
          filterHidden: true,
          projection,
        });
        const { rowCount: rowCountInView } = await this.aggregationService.performRowCount(
          tableId,
          queryRo
        );

        const tableSize: [number, number] = [fields.length, rowCountInView];

        // Calculate start cell based on range type
        if (type === 'columns') {
          startCol = ranges[0]![0];
          startRow = 0;
        } else if (type === 'rows') {
          startCol = 0;
          startRow = ranges[0]![0];
        } else {
          startCol = ranges[0]![0];
          startRow = ranges[0]![1];
        }

        // Expand paste content to fill selection (matches V1 behavior)
        parsedContent = this.expandPasteContent(
          parsedContent,
          type,
          ranges,
          tableSize[0],
          tableSize[1],
          startCol,
          startRow
        );

        const contentCols = parsedContent[0]?.length ?? 0;
        const contentRows = parsedContent.length;

        // Calculate expansion needs
        const numColsToExpand = Math.max(0, startCol + contentCols - tableSize[0]);
        const numRowsToExpand = Math.max(0, startRow + contentRows - tableSize[1]);

        // Apply permission-based limits (like V1's calculateExpansion)
        const effectiveColsToExpand = hasFieldCreatePermission ? numColsToExpand : 0;
        const effectiveRowsToExpand = hasRecordCreatePermission ? numRowsToExpand : 0;

        // When paste needs to create new fields, fall back to V1's paste implementation.
        // V2's paste doesn't support field creation, and mixing V2 record operations with
        // V1 field operations causes database lock conflicts during undo.
        if (effectiveColsToExpand > 0) {
          fallbackRanges = await this.selectionService.paste(tableId, pasteRo, {
            windowId,
          });
          return;
        }

        // Truncate content if expansion is not allowed
        finalContent = parsedContent;
        const maxCols = tableSize[0] - startCol + effectiveColsToExpand;
        const maxRows = tableSize[1] - startRow + effectiveRowsToExpand;

        // Track if we need to adjust ranges due to truncation
        let truncatedCols = contentCols;
        truncatedRows = contentRows;

        if (contentCols > maxCols || contentRows > maxRows) {
          truncatedRows = Math.min(contentRows, maxRows);
          truncatedCols = Math.min(contentCols, maxCols);
          finalContent = parsedContent
            .slice(0, truncatedRows)
            .map((row) => row.slice(0, truncatedCols));
        }

        // Adjust ranges to match truncated content (prevents V2 core from re-expanding)
        let adjustedRanges = ranges;
        if (type === undefined && finalContent.length > 0 && finalContent[0]?.length > 0) {
          // For cell type, adjust end position to match truncated content
          const adjustedEndCol = startCol + truncatedCols - 1;
          const adjustedEndRow = startRow + truncatedRows - 1;
          adjustedRanges = [
            [startCol, startRow],
            [adjustedEndCol, adjustedEndRow],
          ];
        }

        // Convert header to sourceFields format if provided
        const sourceFields = header?.map((field) => ({
          name: field.name,
          type: field.type,
          cellValueType: field.cellValueType,
          isComputed: field.isComputed,
          isLookup: field.isLookup,
          isMultipleCellValue: field.isMultipleCellValue,
          options: field.options,
        }));

        const normalizedFilter = this.mapV1FilterToV2(filter);
        const normalizedUpdateFilter = options?.updateFilter
          ? this.mapV1FilterToV2(options.updateFilter)
          : undefined;
        v2Input = {
          tableId,
          viewId: resolvedViewId,
          ranges: adjustedRanges,
          content: finalContent,
          typecast: true,
          sourceFields,
          type, // Pass type to v2 for internal handling
          projection,
          filter: normalizedFilter,
          updateFilter: normalizedUpdateFilter,
          sort: orderBy,
        };
      } finally {
        span.end();
      }
    });

    if (fallbackRanges) {
      return { ranges: fallbackRanges };
    }

    if (!v2Input) {
      throw new HttpException(internalServerError, HttpStatus.INTERNAL_SERVER_ERROR);
    }

    const result = await executePasteEndpoint(context, v2Input, commandBus);

    if (result.status === 200 && result.body.ok) {
      // V2 returns { updatedCount, createdCount, createdRecordIds }
      // V1 expects { ranges: [[startCol, startRow], [endCol, endRow]] }
      // Use truncatedRows (content size) for range calculation, not operation count,
      // because some rows may be skipped due to permission filters
      const finalCols = finalContent[0]?.length ?? 1;

      // Note: Record creation undo/redo is handled by V2's RecordsBatchCreated projection handler
      // Field creation case is handled by V1 fallback above

      // Best-effort: normalize v1 range formats (cell/rows/columns) into a cell range.
      // v1 "ranges" uses `cellSchema` for all modes:
      // - default: [col, row]
      // - columns: [startCol, endCol]
      // - rows: [startRow, endRow]
      if (type === 'columns') {
        const endCol = startCol + finalCols - 1;
        return {
          ranges: [
            [startCol, 0],
            [endCol, Math.max(truncatedRows - 1, 0)],
          ],
        };
      }

      if (type === 'rows') {
        const endRow = ranges[0]![1];
        return {
          ranges: [
            [0, startRow],
            [Math.max(finalCols - 1, 0), endRow],
          ],
        };
      }

      const endRow = startRow + Math.max(truncatedRows - 1, 0);
      const endCol = startCol + finalCols - 1;
      return {
        ranges: [
          [startCol, startRow],
          [endCol, Math.max(endRow, startRow)],
        ],
      };
    }

    if (!result.body.ok) {
      this.throwV2Error(result.body.error, result.status);
    }

    throw new HttpException(internalServerError, HttpStatus.INTERNAL_SERVER_ERROR);
  }

  /**
   * Expand paste content to fill target selection (matches V1 behavior).
   * If the selection is a multiple of the content size, the content is tiled.
   */
  private expandPasteContent(
    content: unknown[][],
    type: 'columns' | 'rows' | undefined,
    ranges: [number, number][],
    totalCols: number,
    totalRows: number,
    startCol: number,
    startRow: number
  ): unknown[][] {
    if (content.length === 0 || content[0]?.length === 0) {
      return content;
    }

    const contentRows = content.length;
    const contentCols = content[0]!.length;

    // Calculate target range size
    let targetRows: number;
    let targetCols: number;

    if (type === 'columns') {
      const endCol = ranges[0]![1];
      targetCols = endCol - startCol + 1;
      targetRows = totalRows;
    } else if (type === 'rows') {
      const endRow = ranges[0]![1];
      targetRows = endRow - startRow + 1;
      targetCols = totalCols;
    } else {
      // Cell range: [[startCol, startRow], [endCol, endRow]]
      const endCol = ranges[1]?.[0] ?? startCol;
      const endRow = ranges[1]?.[1] ?? startRow;
      targetCols = endCol - startCol + 1;
      targetRows = endRow - startRow + 1;
    }

    // If target equals content size, no expansion needed
    if (targetRows === contentRows && targetCols === contentCols) {
      return content;
    }

    // Only expand if target is an exact multiple of content dimensions
    if (targetRows % contentRows !== 0 || targetCols % contentCols !== 0) {
      return content;
    }

    // Tile content to fill the target range
    return Array.from({ length: targetRows }, (_, rowIdx) =>
      Array.from(
        { length: targetCols },
        (_, colIdx) => content[rowIdx % contentRows]![colIdx % contentCols]
      )
    );
  }

  async clear(tableId: string, rangesRo: IRangesRo): Promise<null> {
    const container = await this.v2ContainerService.getContainer();
    const commandBus = container.resolve<ICommandBus>(v2CoreTokens.commandBus);
    const context = await this.v2ContextFactory.createContext();

    // Convert v1 input format to v2 format
    const { ranges, viewId, type, filter, projection, orderBy, groupBy } = rangesRo;

    const resolvedViewId = await this.resolveViewId(tableId, viewId);
    const normalizedFilter = this.mapV1FilterToV2(filter);
    const v2Input = {
      tableId,
      viewId: resolvedViewId,
      ranges,
      type,
      projection,
      filter: normalizedFilter,
      sort: orderBy,
      groupBy: groupBy?.map((item) => ({
        fieldId: item.fieldId,
        order: item.order,
      })),
    };

    const result = await executeClearEndpoint(context, v2Input, commandBus);

    if (result.status === 200 && result.body.ok) {
      // V1 clear returns null
      return null;
    }

    if (!result.body.ok) {
      this.throwV2Error(result.body.error, result.status);
    }

    throw new HttpException(internalServerError, HttpStatus.INTERNAL_SERVER_ERROR);
  }

  /**
   * Get record IDs from ranges for undo/redo support and permission checks.
   * This method queries the record IDs that will be affected by a range-based operation.
   */
  async getRecordIdsFromRanges(tableId: string, rangesRo: IRangesRo): Promise<string[]> {
    const { ranges, type, viewId, filter, orderBy, search, groupBy, collapsedGroupIds } = rangesRo;

    const baseQuery = {
      viewId,
      filter,
      orderBy,
      search,
      groupBy,
      collapsedGroupIds,
      fieldKeyType: FieldKeyType.Id,
    };

    if (type === RangeType.Columns) {
      // For columns selection, get all record IDs
      const result = await this.recordService.getDocIdsByQuery(
        tableId,
        { ...baseQuery, skip: 0, take: -1 },
        true
      );
      return result.ids;
    }

    if (type === RangeType.Rows) {
      // For rows selection, iterate through each range [start, end]
      let recordIds: string[] = [];
      for (const [start, end] of ranges) {
        const result = await this.recordService.getDocIdsByQuery(
          tableId,
          { ...baseQuery, skip: start, take: end - start + 1 },
          true
        );
        recordIds = recordIds.concat(result.ids);
      }
      return recordIds;
    }

    // Default: cell range - ranges is [[startCol, startRow], [endCol, endRow]]
    const [start, end] = ranges;
    const result = await this.recordService.getDocIdsByQuery(
      tableId,
      { ...baseQuery, skip: start[1], take: end[1] - start[1] + 1 },
      true
    );
    return result.ids;
  }

  async deleteByRange(
    tableId: string,
    rangesRo: IRangesRo,
    _windowId?: string
  ): Promise<{ ids: string[] }> {
    const container = await this.v2ContainerService.getContainer();
    const commandBus = container.resolve<ICommandBus>(v2CoreTokens.commandBus);
    const context = await this.v2ContextFactory.createContext();

    // Resolve viewId (required for v2 deleteByRange)
    const viewId = await this.resolveViewId(tableId, rangesRo.viewId);

    // Build v2 deleteByRange input
    const v2Input = {
      tableId,
      viewId,
      ranges: rangesRo.ranges,
      type: rangesRo.type,
      filter: this.mapV1FilterToV2(rangesRo.filter),
      sort: rangesRo.orderBy?.map((item) => ({
        fieldId: item.fieldId,
        order: item.order,
      })),
      search: rangesRo.search,
      groupBy: rangesRo.groupBy?.map((item) => ({
        fieldId: item.fieldId,
        order: item.order,
      })),
    };

    const result = await executeDeleteByRangeEndpoint(context, v2Input, commandBus);

    if (result.status === 200 && result.body.ok) {
      // V2's DeleteByRangeHandler captures snapshots and emits RecordsDeleted event.
      // Undo/redo is handled by V2RecordsDeletedUndoRedoProjection in v2-undo-redo.service.ts
      return { ids: [...result.body.data.deletedRecordIds] };
    }

    if (!result.body.ok) {
      this.throwV2Error(result.body.error, result.status);
    }

    throw new HttpException(internalServerError, HttpStatus.INTERNAL_SERVER_ERROR);
  }

  async deleteRecords(
    tableId: string,
    recordIds: string[],
    windowId?: string
  ): Promise<IRecordsVo> {
    const container = await this.v2ContainerService.getContainer();
    const commandBus = container.resolve<ICommandBus>(v2CoreTokens.commandBus);
    const context = await this.v2ContextFactory.createContext();
    const userId = this.cls.get('user.id');

    // Query records before deletion to return them in V1 format
    const recordSnapshots = await this.recordService.getSnapshotBulkWithPermission(
      tableId,
      recordIds,
      undefined,
      FieldKeyType.Id,
      undefined,
      true
    );

    // Get record orders for undo/redo support (only if windowId is provided)
    let orders: Record<string, number>[] | undefined;
    if (windowId) {
      const table = await this.tableDomainQueryService.getTableDomainById(tableId);
      orders = await this.recordService.getRecordIndexes(table, recordIds);
    }

    const v2Input = {
      tableId,
      recordIds,
    };

    const result = await executeDeleteRecordsEndpoint(context, v2Input, commandBus);

    if (result.status === 200 && result.body.ok) {
      // TODO: Migrate to pure V2 undo/redo - see v2-undo-redo.service.ts for details.
      //
      // Currently emitting V1 event because V2's RecordsDeleted projection cannot
      // handle undo/redo correctly:
      // 1. V2's stored query returns incomplete field data (primary field value missing)
      // 2. V2 doesn't track record order in views (required for restoring position)
      // 3. V1's getSnapshotBulkWithPermission + getRecordIndexes provides complete data
      //
      // When V2 stored query is fixed and order tracking is added, this should be
      // replaced by proper V2 projection handling in V2RecordsDeletedUndoRedoProjection.
      const records = recordSnapshots.map((snapshot, index) => ({
        ...(snapshot.data as IRecord),
        order: orders?.[index],
      }));

      this.eventEmitterService.emitAsync(Events.OPERATION_RECORDS_DELETE, {
        operationId: generateOperationId(),
        windowId,
        tableId,
        userId,
        records,
      });

      // Return records that were deleted (V1 format)
      return {
        records: recordSnapshots.map((snapshot) => snapshot.data as IRecord),
      };
    }

    if (!result.body.ok) {
      this.throwV2Error(result.body.error, result.status);
    }

    throw new HttpException(internalServerError, HttpStatus.INTERNAL_SERVER_ERROR);
  }

  /**
   * Parse tab-separated content string into 2D array
   */
  private parseCopyContent(content: string): unknown[][] {
    return parseClipboardText(content);
  }

  private async resolveViewId(tableId: string, viewId?: string | null): Promise<string> {
    if (viewId) {
      return viewId;
    }
    const defaultView = await this.tableService.getDefaultViewId(tableId);
    return defaultView.id;
  }

  private mapV1FilterToV2(filter: unknown): RecordFilter | undefined | null {
    if (filter === undefined) return undefined;
    if (filter === null) return null;
    if (this.isV2FilterNode(filter)) return filter as RecordFilter;
    if (this.isV1FilterGroup(filter)) return this.mapV1FilterGroup(filter);
    if (this.isV1FilterItem(filter)) return this.mapV1FilterItem(filter);
    return undefined;
  }

  private isV2FilterNode(value: unknown): value is RecordFilterNode {
    if (!value || typeof value !== 'object') return false;
    const record = value as Record<string, unknown>;
    if (Array.isArray(record.items)) return true;
    if (record.not && typeof record.not === 'object') return true;
    if (typeof record.fieldId === 'string' && typeof record.operator === 'string') return true;
    return false;
  }

  private isV1FilterGroup(
    value: unknown
  ): value is { conjunction: 'and' | 'or'; filterSet: unknown[] } {
    if (!value || typeof value !== 'object') return false;
    const record = value as Record<string, unknown>;
    return Array.isArray(record.filterSet);
  }

  private isV1FilterItem(
    value: unknown
  ): value is { fieldId: string; operator: string; value?: unknown; isSymbol?: boolean } {
    if (!value || typeof value !== 'object') return false;
    const record = value as Record<string, unknown>;
    return typeof record.fieldId === 'string' && typeof record.operator === 'string';
  }

  private mapV1FilterGroup(filter: {
    conjunction: 'and' | 'or';
    filterSet: unknown[];
  }): RecordFilterGroup | null {
    const items = filter.filterSet
      .map((entry) => this.mapV1FilterEntry(entry))
      .filter((entry): entry is RecordFilterNode => Boolean(entry));
    if (items.length === 0) return null;
    return {
      conjunction: filter.conjunction === 'or' ? 'or' : 'and',
      items,
    };
  }

  private mapV1FilterEntry(entry: unknown): RecordFilterNode | null {
    if (entry === null || entry === undefined) return null;
    if (this.isV2FilterNode(entry)) return entry as RecordFilterNode;
    if (this.isV1FilterGroup(entry)) return this.mapV1FilterGroup(entry);
    if (this.isV1FilterItem(entry)) return this.mapV1FilterItem(entry);
    return null;
  }

  private mapV1FilterItem(filter: {
    fieldId: string;
    operator: string;
    value?: unknown;
    isSymbol?: boolean;
  }): RecordFilterNode {
    const operator = this.normalizeV1Operator(
      filter.operator,
      filter.isSymbol
    ) as RecordFilterOperator;
    return {
      fieldId: filter.fieldId,
      operator,
      value: ('value' in filter ? filter.value ?? null : null) as RecordFilterValue,
    };
  }

  private normalizeV1Operator(operator: string, isSymbol?: boolean): string {
    const mapped = v1SymbolOperatorMap[operator];
    if (mapped) return mapped;
    if (isSymbol) return operator;
    return operator;
  }

  async duplicateRecord(
    tableId: string,
    recordId: string,
    order?: IRecordInsertOrderRo
  ): Promise<IRecord> {
    const container = await this.v2ContainerService.getContainer();
    const commandBus = container.resolve<ICommandBus>(v2CoreTokens.commandBus);
    const context = await this.v2ContextFactory.createContext();

    const result = await executeDuplicateRecordEndpoint(
      context,
      {
        tableId,
        recordId,
        order,
      },
      commandBus
    );

    if (result.status === 201 && result.body.ok) {
      const duplicatedRecordId = result.body.data.record.id;

      // Use V1 to get the full record with proper field key mapping
      const snapshots = await this.recordService.getSnapshotBulkWithPermission(
        tableId,
        [duplicatedRecordId],
        undefined,
        FieldKeyType.Name,
        undefined,
        true
      );

      if (snapshots.length !== 1 || !snapshots[0]) {
        throw new HttpException(internalServerError, HttpStatus.INTERNAL_SERVER_ERROR);
      }

      return snapshots[0].data as IRecord;
    }

    if (!result.body.ok) {
      this.throwV2Error(result.body.error, result.status);
    }

    throw new HttpException(internalServerError, HttpStatus.INTERNAL_SERVER_ERROR);
  }
}
