/* eslint-disable sonarjs/cognitive-complexity */
import { Injectable } from '@nestjs/common';
import type { FormulaFieldCore } from '@teable/core';
import { FieldType, IdPrefix, RecordOpBuilder } from '@teable/core';
import { PrismaService } from '@teable/db-main-prisma';
import { RawOpType } from '../../../../share-db/interface';
import { Timing } from '../../../../utils/timing';
import { BatchService } from '../../../calculation/batch.service';
import { AUTO_NUMBER_FIELD_NAME } from '../../../field/constant';
import { createFieldInstanceByRaw, type IFieldInstance } from '../../../field/model/factory';
import { InjectRecordQueryBuilder, type IRecordQueryBuilder } from '../../query-builder';
import { IComputedImpactByTable } from './computed-dependency-collector.service';
import { RecordComputedUpdateService } from './record-computed-update.service';

const recordIdBatchSize = 10_000;
const cursorBatchSize = 10_000;

type IRowResult = {
  __id: string;
  __version: number;
  ['__prev_version']?: number;
  ['__auto_number']?: number;
} & Record<string, unknown>;

@Injectable()
export class ComputedEvaluatorService {
  constructor(
    private readonly prismaService: PrismaService,
    @InjectRecordQueryBuilder() private readonly recordQueryBuilder: IRecordQueryBuilder,
    private readonly recordComputedUpdateService: RecordComputedUpdateService,
    private readonly batchService: BatchService
  ) {}

  private async getDbTableName(tableId: string): Promise<string> {
    const { dbTableName } = await this.prismaService.txClient().tableMeta.findUniqueOrThrow({
      where: { id: tableId },
      select: { dbTableName: true },
    });
    return dbTableName;
  }

  private async getFieldInstances(tableId: string, fieldIds: string[]): Promise<IFieldInstance[]> {
    if (!fieldIds.length) return [];
    const rows = await this.prismaService.txClient().field.findMany({
      where: { id: { in: fieldIds }, tableId, deletedTime: null },
    });
    return rows.map((r) => createFieldInstanceByRaw(r));
  }

  /**
   * For each table, query only the impacted records and dependent fields.
   * Builds a RecordQueryBuilder with projection and converts DB values to cell values.
   */
  @Timing()
  async evaluate(
    impact: IComputedImpactByTable,
    opts?: { versionBaseline?: 'previous' | 'current'; excludeFieldIds?: Set<string> }
  ): Promise<number> {
    const excludeFieldIds = opts?.excludeFieldIds ?? new Set<string>();
    const entries = Object.entries(impact).filter(([, group]) => group.fieldIds.size);

    let totalOps = 0;

    for (const [tableId, group] of entries) {
      const requestedFieldIds = Array.from(group.fieldIds);
      const fieldInstances = await this.getFieldInstances(tableId, requestedFieldIds);
      if (!fieldInstances.length) continue;

      const validFieldIdSet = new Set(fieldInstances.map((f) => f.id));
      const impactedFieldIds = new Set(requestedFieldIds.filter((fid) => validFieldIdSet.has(fid)));
      if (!impactedFieldIds.size) continue;

      const dbTableName = await this.getDbTableName(tableId);
      const { qb, alias } = await this.recordQueryBuilder.createRecordQueryBuilder(dbTableName, {
        tableIdOrDbTableName: tableId,
        projection: Array.from(validFieldIdSet),
        rawProjection: true,
      });

      const idCol = alias ? `${alias}.__id` : '__id';
      const orderCol = alias ? `${alias}.${AUTO_NUMBER_FIELD_NAME}` : AUTO_NUMBER_FIELD_NAME;
      const baseQb = qb.clone();

      if (group.recordIds.size) {
        const recordIds = Array.from(group.recordIds);
        for (const chunk of this.chunk(recordIds, recordIdBatchSize)) {
          if (!chunk.length) continue;
          const batchQb = baseQb.clone().whereIn(idCol, chunk);
          const rows = await this.recordComputedUpdateService.updateFromSelect(
            tableId,
            batchQb,
            fieldInstances
          );
          if (!rows.length) continue;
          const evaluatedRows = this.buildEvaluatedRows(rows, fieldInstances, opts);
          totalOps += this.publishBatch(
            tableId,
            impactedFieldIds,
            validFieldIdSet,
            excludeFieldIds,
            evaluatedRows
          );
        }
        continue;
      }

      let cursor: number | null = null;
      // Cursor-based batching for full-table recompute scenarios
      // eslint-disable-next-line no-constant-condition
      while (true) {
        const pagedQb = baseQb.clone().orderBy(orderCol, 'asc').limit(cursorBatchSize);
        if (cursor != null) pagedQb.where(orderCol, '>', cursor);

        const rows = await this.recordComputedUpdateService.updateFromSelect(
          tableId,
          pagedQb,
          fieldInstances
        );
        if (!rows.length) break;

        const sortedRows = rows.slice().sort((a, b) => {
          const left = (a[AUTO_NUMBER_FIELD_NAME] as number) ?? 0;
          const right = (b[AUTO_NUMBER_FIELD_NAME] as number) ?? 0;
          if (left === right) return 0;
          return left > right ? 1 : -1;
        });

        const evaluatedRows = this.buildEvaluatedRows(sortedRows, fieldInstances, opts);
        totalOps += this.publishBatch(
          tableId,
          impactedFieldIds,
          validFieldIdSet,
          excludeFieldIds,
          evaluatedRows
        );

        const lastRow = sortedRows[sortedRows.length - 1];
        const lastCursor = lastRow[AUTO_NUMBER_FIELD_NAME] as number | undefined;
        if (lastCursor != null) cursor = lastCursor;
        if (sortedRows.length < cursorBatchSize) break;
      }
    }

    return totalOps;
  }

  private chunk<T>(arr: T[], size: number): T[][] {
    if (size <= 0) return [arr];
    const result: T[][] = [];
    for (let i = 0; i < arr.length; i += size) {
      result.push(arr.slice(i, i + size));
    }
    return result;
  }

  private buildEvaluatedRows(
    rows: Array<IRowResult>,
    fieldInstances: IFieldInstance[],
    opts?: { versionBaseline?: 'previous' | 'current' }
  ): Array<{ recordId: string; version: number; fields: Record<string, unknown> }> {
    return rows.map((row) => {
      const recordId = row.__id;
      const version =
        opts?.versionBaseline === 'current'
          ? (row.__version as number)
          : (row.__prev_version as number | undefined) ?? (row.__version as number) - 1;

      const fieldsMap: Record<string, unknown> = {};
      for (const field of fieldInstances) {
        let columnName = field.dbFieldName;
        if (field.type === FieldType.Formula) {
          const f: FormulaFieldCore = field;
          if (f.getIsPersistedAsGeneratedColumn()) {
            const gen = f.getGeneratedColumnName?.();
            if (gen) columnName = gen;
          }
        }
        const raw = row[columnName as keyof typeof row] as unknown;
        const cellValue = field.convertDBValue2CellValue(raw as never);
        if (cellValue != null) fieldsMap[field.id] = cellValue;
      }

      return { recordId, version, fields: fieldsMap };
    });
  }

  private publishBatch(
    tableId: string,
    impactedFieldIds: Set<string>,
    validFieldIds: Set<string>,
    excludeFieldIds: Set<string>,
    evaluatedRows: Array<{ recordId: string; version: number; fields: Record<string, unknown> }>
  ): number {
    if (!evaluatedRows.length) return 0;

    const targetFieldIds = Array.from(impactedFieldIds).filter(
      (fid) => validFieldIds.has(fid) && !excludeFieldIds.has(fid)
    );
    if (!targetFieldIds.length) return 0;

    const opDataList = evaluatedRows
      .map(({ recordId, version, fields }) => {
        const ops = targetFieldIds
          .map((fid) => {
            const hasValue = Object.prototype.hasOwnProperty.call(fields, fid);
            const newCellValue = hasValue ? fields[fid] : null;
            return RecordOpBuilder.editor.setRecord.build({
              fieldId: fid,
              newCellValue,
              oldCellValue: null,
            });
          })
          .filter(Boolean);

        if (!ops.length) return null;

        return { docId: recordId, version, data: ops, count: ops.length } as const;
      })
      .filter(Boolean) as { docId: string; version: number; data: unknown; count: number }[];

    if (!opDataList.length) return 0;

    this.batchService.saveRawOps(
      tableId,
      RawOpType.Edit,
      IdPrefix.Record,
      opDataList.map(({ docId, version, data }) => ({ docId, version, data }))
    );

    return opDataList.reduce((sum, current) => sum + current.count, 0);
  }
}
