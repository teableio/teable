/* eslint-disable sonarjs/cognitive-complexity */
import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { FormulaFieldCore, TableDomain } from '@teable/core';
import { FieldType, IdPrefix, RecordOpBuilder, Tables } from '@teable/core';
import { PrismaService } from '@teable/db-main-prisma';
import type { Knex } from 'knex';
import { RawOpType } from '../../../../share-db/interface';
import { Timing } from '../../../../utils/timing';
import { BatchService } from '../../../calculation/batch.service';
import { AUTO_NUMBER_FIELD_NAME } from '../../../field/constant';
import type { IFieldInstance } from '../../../field/model/factory';
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
    @InjectRecordQueryBuilder() private readonly recordQueryBuilder: IRecordQueryBuilder,
    private readonly recordComputedUpdateService: RecordComputedUpdateService,
    private readonly batchService: BatchService,
    private readonly prismaService: PrismaService
  ) {}

  /**
   * For each table, query only the impacted records and dependent fields.
   * Builds a RecordQueryBuilder with projection and converts DB values to cell values.
   */
  @Timing()
  async evaluate(
    impact: IComputedImpactByTable,
    opts: {
      excludeFieldIds?: Set<string>;
      preferAutoNumberPaging?: boolean;
      tableDomains: ReadonlyMap<string, TableDomain>;
    }
  ): Promise<number> {
    const excludeFieldIds = opts.excludeFieldIds ?? new Set<string>();
    const globalPreferAutoNumberPaging = opts.preferAutoNumberPaging === true;
    const entries = Object.entries(impact).filter(([, group]) => group.fieldIds.size);
    const projectionByTable = entries.reduce<Record<string, string[]>>((acc, [tableId, group]) => {
      acc[tableId] = Array.from(group.fieldIds);
      return acc;
    }, {});

    let totalOps = 0;
    const tableDomainCache = opts.tableDomains;
    if (!tableDomainCache.size) {
      throw new Error('ComputedEvaluatorService.evaluate requires table domains');
    }

    const layers = await this.buildFieldLayers(entries);
    if (!layers.length) {
      return totalOps;
    }

    for (const layer of layers) {
      for (const [tableId, layerFieldIds] of layer) {
        const group = impact[tableId];
        if (!group) continue;
        const requestedFieldIds = Array.from(layerFieldIds);
        if (!requestedFieldIds.length) continue;

        const preferAutoNumberPaging =
          globalPreferAutoNumberPaging || group.preferAutoNumberPaging === true;
        const tableDomain = tableDomainCache.get(tableId);
        if (!tableDomain) {
          throw new Error(`Missing table domain for table ${tableId}`);
        }

        const fieldInstances = this.getFieldInstancesFromDomain(tableDomain, requestedFieldIds);
        if (!fieldInstances.length) continue;

        const validFieldIdSet = new Set(fieldInstances.map((f) => f.id));
        const impactedFieldIds = new Set(
          requestedFieldIds.filter((fid) => validFieldIdSet.has(fid))
        );
        if (!impactedFieldIds.size) continue;

        const recordIds = Array.from(group.recordIds);
        const dbTableName = tableDomain.dbTableName;
        const builderRestrictRecordIds =
          !preferAutoNumberPaging && recordIds.length > 0 && recordIds.length <= recordIdBatchSize
            ? recordIds
            : undefined;

        const tablesOverride = this.buildTablesOverride(tableId, tableDomainCache);
        const { qb, alias } = await this.recordQueryBuilder.createRecordQueryBuilder(dbTableName, {
          tableId,
          projection: Array.from(validFieldIdSet),
          rawProjection: true,
          preferRawFieldReferences: true,
          preferStoredLookupFields: this.shouldPreferStoredLookupFields(fieldInstances),
          projectionByTable,
          restrictRecordIds: builderRestrictRecordIds,
          tables: tablesOverride,
        });

        const idCol = alias ? `${alias}.__id` : '__id';
        const orderCol = alias ? `${alias}.${AUTO_NUMBER_FIELD_NAME}` : AUTO_NUMBER_FIELD_NAME;
        const baseQb = qb.clone();

        const paginationContext = this.createPaginationContext({
          tableId,
          recordIds,
          preferAutoNumberPaging,
          baseQueryBuilder: baseQb,
          idColumn: idCol,
          orderColumn: orderCol,
          fieldInstances,
          dbTableName,
        });

        const strategy = this.selectPaginationStrategy(paginationContext);
        await strategy.run(paginationContext, async (rows) => {
          if (!rows.length) return;
          const evaluatedRows = this.buildEvaluatedRows(rows, fieldInstances);
          totalOps += this.publishBatch(
            tableId,
            impactedFieldIds,
            validFieldIdSet,
            excludeFieldIds,
            evaluatedRows
          );
        });
      }
    }

    return totalOps;
  }

  private async buildFieldLayers(
    entries: Array<[string, IComputedImpactByTable[string]]>
  ): Promise<Array<Map<string, Set<string>>>> {
    const fieldIds = entries.flatMap(([, group]) => Array.from(group.fieldIds));
    const uniqueFieldIds = Array.from(new Set(fieldIds.filter(Boolean)));
    if (!uniqueFieldIds.length) {
      return [];
    }

    const fieldIdToTableId = new Map<string, string>();
    for (const [tableId, group] of entries) {
      for (const fieldId of group.fieldIds) {
        fieldIdToTableId.set(fieldId, tableId);
      }
    }

    const edges = await this.loadFieldDependencyEdges(uniqueFieldIds);
    if (!edges.length) {
      return this.buildDefaultLayers(entries);
    }

    const levels = this.topoSortFieldLevels(uniqueFieldIds, edges);
    if (!levels) {
      return this.buildDefaultLayers(entries);
    }

    const layered = new Map<number, Map<string, Set<string>>>();
    for (const fieldId of uniqueFieldIds) {
      const level = levels.get(fieldId) ?? 0;
      const tableId = fieldIdToTableId.get(fieldId);
      if (!tableId) continue;
      let tableMap = layered.get(level);
      if (!tableMap) {
        tableMap = new Map<string, Set<string>>();
        layered.set(level, tableMap);
      }
      const fieldSet = tableMap.get(tableId) ?? new Set<string>();
      fieldSet.add(fieldId);
      tableMap.set(tableId, fieldSet);
    }

    const orderedLevels = Array.from(layered.keys()).sort((a, b) => a - b);
    return orderedLevels.map((level) => layered.get(level)!);
  }

  private buildDefaultLayers(
    entries: Array<[string, IComputedImpactByTable[string]]>
  ): Array<Map<string, Set<string>>> {
    const layer = new Map<string, Set<string>>();
    for (const [tableId, group] of entries) {
      if (!group.fieldIds.size) continue;
      layer.set(tableId, new Set(group.fieldIds));
    }
    return layer.size ? [layer] : [];
  }

  private async loadFieldDependencyEdges(
    fieldIds: string[]
  ): Promise<Array<{ fromFieldId: string; toFieldId: string }>> {
    const sql = Prisma.sql`
      SELECT DISTINCT
        r.from_field_id AS "fromFieldId",
        r.to_field_id AS "toFieldId"
      FROM reference r
      WHERE r.from_field_id IN (${Prisma.join(fieldIds)})
        AND r.to_field_id IN (${Prisma.join(fieldIds)})
    `;
    return this.prismaService
      .txClient()
      .$queryRaw<Array<{ fromFieldId: string; toFieldId: string }>>(sql);
  }

  private topoSortFieldLevels(
    fieldIds: string[],
    edges: Array<{ fromFieldId: string; toFieldId: string }>
  ): Map<string, number> | null {
    const orderIndex = new Map(fieldIds.map((fieldId, index) => [fieldId, index]));
    const fieldSet = new Set(fieldIds);
    const adjacency = new Map<string, Set<string>>();
    const indegree = new Map<string, number>();
    const levels = new Map<string, number>();

    for (const fieldId of fieldIds) {
      indegree.set(fieldId, 0);
      levels.set(fieldId, 0);
    }

    for (const edge of edges) {
      const { fromFieldId, toFieldId } = edge;
      if (!fieldSet.has(fromFieldId) || !fieldSet.has(toFieldId) || fromFieldId === toFieldId) {
        continue;
      }
      const targets = adjacency.get(fromFieldId) ?? new Set<string>();
      if (!targets.has(toFieldId)) {
        targets.add(toFieldId);
        adjacency.set(fromFieldId, targets);
        indegree.set(toFieldId, (indegree.get(toFieldId) ?? 0) + 1);
      }
    }

    const queue = fieldIds
      .filter((fieldId) => (indegree.get(fieldId) ?? 0) === 0)
      .sort((a, b) => (orderIndex.get(a) ?? 0) - (orderIndex.get(b) ?? 0));
    const result: string[] = [];

    while (queue.length) {
      const current = queue.shift()!;
      result.push(current);
      const targets = adjacency.get(current);
      if (!targets) continue;
      for (const next of targets) {
        const nextLevel = (levels.get(current) ?? 0) + 1;
        if ((levels.get(next) ?? 0) < nextLevel) {
          levels.set(next, nextLevel);
        }
        const nextDegree = (indegree.get(next) ?? 0) - 1;
        indegree.set(next, nextDegree);
        if (nextDegree === 0) {
          queue.push(next);
          queue.sort((a, b) => (orderIndex.get(a) ?? 0) - (orderIndex.get(b) ?? 0));
        }
      }
    }

    return result.length === fieldIds.length ? levels : null;
  }

  private getFieldInstancesFromDomain(
    tableDomain: TableDomain,
    fieldIds: string[]
  ): IFieldInstance[] {
    if (!fieldIds.length) {
      return [];
    }
    const requested = new Set(fieldIds);
    return tableDomain.fieldList
      .filter((field) => requested.has(field.id))
      .map((field) => field as unknown as IFieldInstance);
  }

  private shouldPreferStoredLookupFields(fieldInstances: IFieldInstance[]): boolean {
    if (!fieldInstances.length) {
      return false;
    }
    return !fieldInstances.some(
      (field) =>
        (field as unknown as { isLookup?: boolean }).isLookup === true ||
        field.type === FieldType.Rollup ||
        field.type === FieldType.ConditionalRollup
    );
  }

  private buildTablesOverride(
    tableId: string,
    tableDomains?: ReadonlyMap<string, TableDomain>
  ): Tables | undefined {
    if (!tableDomains?.size) {
      return undefined;
    }
    if (!tableDomains.has(tableId)) {
      return undefined;
    }
    const materialized =
      tableDomains instanceof Map
        ? (tableDomains as Map<string, TableDomain>)
        : new Map(tableDomains as Iterable<[string, TableDomain]>);
    return new Tables(tableId, materialized);
  }

  private buildEvaluatedRows(
    rows: Array<IComputedRowResult>,
    fieldInstances: IFieldInstance[]
  ): Array<{
    recordId: string;
    version: number;
    prevVersion?: number;
    fields: Record<string, unknown>;
  }> {
    return rows.map((row) => {
      const recordId = row.__id;
      const version = row.__version as number;
      const prevVersion = row.__prev_version as number | undefined;

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

      return { recordId, version, prevVersion, fields: fieldsMap };
    });
  }

  private publishBatch(
    tableId: string,
    impactedFieldIds: Set<string>,
    validFieldIds: Set<string>,
    excludeFieldIds: Set<string>,
    evaluatedRows: Array<{
      recordId: string;
      version: number;
      prevVersion?: number;
      fields: Record<string, unknown>;
    }>
  ): number {
    if (!evaluatedRows.length) return 0;

    const targetFieldIds = Array.from(impactedFieldIds).filter(
      (fid) => validFieldIds.has(fid) && !excludeFieldIds.has(fid)
    );
    if (!targetFieldIds.length) return 0;

    const opDataList = evaluatedRows
      .map(({ recordId, version, prevVersion, fields }) => {
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

        const opVersion = prevVersion ?? version;

        return { docId: recordId, version: opVersion, data: ops, count: ops.length } as const;
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
    dbTableName: string;
  }): IPaginationContext {
    const {
      tableId,
      recordIds,
      preferAutoNumberPaging,
      baseQueryBuilder,
      idColumn,
      orderColumn,
      fieldInstances,
      dbTableName,
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
      updateRecords: (qb, options) =>
        this.recordComputedUpdateService.updateFromSelect(tableId, qb, fieldInstances, {
          ...options,
          dbTableName,
        }),
    };
  }
}
