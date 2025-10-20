/* eslint-disable sonarjs/cognitive-complexity */
import { Injectable } from '@nestjs/common';
import type { FormulaFieldCore } from '@teable/core';
import { FieldType, IdPrefix, RecordOpBuilder } from '@teable/core';
import { PrismaService } from '@teable/db-main-prisma';
import type { Knex } from 'knex';
import { RawOpType } from '../../../../share-db/interface';
import { Timing } from '../../../../utils/timing';
import { BatchService } from '../../../calculation/batch.service';
import { AUTO_NUMBER_FIELD_NAME } from '../../../field/constant';
import { createFieldInstanceByRaw, type IFieldInstance } from '../../../field/model/factory';
import { InjectRecordQueryBuilder, type IRecordQueryBuilder } from '../../query-builder';
import { IComputedImpactByTable } from './computed-dependency-collector.service';
import {
  AutoNumberCursorStrategy,
  RecordIdBatchStrategy,
  type IComputedRowResult,
  type IPaginationContext,
  type IRecordPaginationStrategy,
} from './computed-pagination.strategy';
import { RecordComputedUpdateService } from './record-computed-update.service';

const recordIdBatchSize = 10_000;
const cursorBatchSize = 10_000;

@Injectable()
export class ComputedEvaluatorService {
  private readonly paginationStrategies: IRecordPaginationStrategy[] = [
    new RecordIdBatchStrategy(),
    new AutoNumberCursorStrategy(),
  ];

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
    opts?: {
      versionBaseline?: 'previous' | 'current';
      excludeFieldIds?: Set<string>;
      preferAutoNumberPaging?: boolean;
    }
  ): Promise<number> {
    const excludeFieldIds = opts?.excludeFieldIds ?? new Set<string>();
    const globalPreferAutoNumberPaging = opts?.preferAutoNumberPaging === true;
    const entries = Object.entries(impact).filter(([, group]) => group.fieldIds.size);

    let totalOps = 0;

    for (const [tableId, group] of entries) {
      const requestedFieldIds = Array.from(group.fieldIds);
      const preferAutoNumberPaging =
        globalPreferAutoNumberPaging || group.preferAutoNumberPaging === true;
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
        preferRawFieldReferences: true,
      });

      const idCol = alias ? `${alias}.__id` : '__id';
      const orderCol = alias ? `${alias}.${AUTO_NUMBER_FIELD_NAME}` : AUTO_NUMBER_FIELD_NAME;
      const baseQb = qb.clone();

      const recordIds = Array.from(group.recordIds);
      const paginationContext = this.createPaginationContext({
        tableId,
        recordIds,
        preferAutoNumberPaging,
        baseQueryBuilder: baseQb,
        idColumn: idCol,
        orderColumn: orderCol,
        fieldInstances,
      });

      const strategy = this.selectPaginationStrategy(paginationContext);
      await strategy.run(paginationContext, async (rows) => {
        if (!rows.length) return;
        const evaluatedRows = this.buildEvaluatedRows(rows, fieldInstances, opts);
        totalOps += this.publishBatch(
          tableId,
          impactedFieldIds,
          validFieldIdSet,
          excludeFieldIds,
          evaluatedRows
        );
      });
    }

    return totalOps;
  }

  private buildEvaluatedRows(
    rows: Array<IComputedRowResult>,
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

  private selectPaginationStrategy(context: IPaginationContext): IRecordPaginationStrategy {
    return (
      this.paginationStrategies.find((strategy) => strategy.canHandle(context)) ??
      this.paginationStrategies[this.paginationStrategies.length - 1]
    );
  }

  private createPaginationContext(params: {
    tableId: string;
    recordIds: string[];
    preferAutoNumberPaging: boolean;
    baseQueryBuilder: Knex.QueryBuilder;
    idColumn: string;
    orderColumn: string;
    fieldInstances: IFieldInstance[];
  }): IPaginationContext {
    const {
      tableId,
      recordIds,
      preferAutoNumberPaging,
      baseQueryBuilder,
      idColumn,
      orderColumn,
      fieldInstances,
    } = params;

    return {
      tableId,
      recordIds,
      preferAutoNumberPaging,
      recordIdBatchSize,
      cursorBatchSize,
      baseQueryBuilder,
      idColumn,
      orderColumn,
      updateRecords: (qb) =>
        this.recordComputedUpdateService.updateFromSelect(tableId, qb, fieldInstances),
    };
  }
}
