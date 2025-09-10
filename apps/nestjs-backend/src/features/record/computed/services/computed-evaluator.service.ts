/* eslint-disable sonarjs/cognitive-complexity */
import { Injectable } from '@nestjs/common';
import type { FormulaFieldCore } from '@teable/core';
import { FieldType } from '@teable/core';
import { PrismaService } from '@teable/db-main-prisma';
import { createFieldInstanceByRaw, type IFieldInstance } from '../../../field/model/factory';
import { InjectRecordQueryBuilder, type IRecordQueryBuilder } from '../../query-builder';
import { RecordComputedUpdateService } from './record-computed-update.service';
import type { IComputedImpactByTable } from './computed-dependency-collector.service';

export interface IEvaluatedComputedValues {
  [tableId: string]: {
    [recordId: string]: { version: number; fields: { [fieldId: string]: unknown } };
  };
}

@Injectable()
export class ComputedEvaluatorService {
  constructor(
    private readonly prismaService: PrismaService,
    @InjectRecordQueryBuilder() private readonly recordQueryBuilder: IRecordQueryBuilder,
    private readonly recordComputedUpdateService: RecordComputedUpdateService
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
  async evaluate(impact: IComputedImpactByTable): Promise<IEvaluatedComputedValues> {
    const entries = Object.entries(impact).filter(
      ([, group]) => group.recordIds.size && group.fieldIds.size
    );

    const tableResults = await Promise.all(
      entries.map(async ([tableId, group]) => {
        const recordIds = Array.from(group.recordIds);
        const requestedFieldIds = Array.from(group.fieldIds);

        // Resolve valid field instances on this table
        const fieldInstances = await this.getFieldInstances(tableId, requestedFieldIds);
        const validFieldIds = fieldInstances.map((f) => f.id);
        if (!validFieldIds.length || !recordIds.length) return [tableId, {}] as const;

        // Build query via record-query-builder with projection (read values via SELECT)
        const dbTableName = await this.getDbTableName(tableId);
        const { qb, alias } = await this.recordQueryBuilder.createRecordQueryBuilder(dbTableName, {
          tableIdOrDbTableName: tableId,
          projection: validFieldIds,
        });

        const idCol = alias ? `${alias}.__id` : '__id';
        // Use single UPDATE ... FROM ... RETURNING to both persist and fetch values
        const rows = await this.recordComputedUpdateService.updateFromSelect(
          tableId,
          qb.whereIn(idCol, recordIds),
          fieldInstances
        );

        // Convert DB row values to cell values keyed by fieldId for ops
        const tableMap: {
          [recordId: string]: { version: number; fields: { [fieldId: string]: unknown } };
        } = {};

        for (const row of rows) {
          const recordId = row.__id;
          // updateFromSelect now bumps __version in DB; use previous version for publishing ops
          const version =
            (row.__prev_version as number | undefined) ?? (row.__version as number) - 1;
          const fieldsMap: Record<string, unknown> = {};
          for (const field of fieldInstances) {
            // For persisted formulas, the returned column is the generated column name
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
          tableMap[recordId] = { version, fields: fieldsMap };
        }

        return [tableId, tableMap] as const;
      })
    );

    return tableResults.reduce<IEvaluatedComputedValues>((acc, [tid, tmap]) => {
      if (Object.keys(tmap).length) acc[tid] = tmap;
      return acc;
    }, {});
  }

  /**
   * Select-only evaluation used to capture "old" values before a mutation.
   * Does NOT write to DB. Mirrors evaluate() but executes a plain SELECT.
   */
  async selectValues(impact: IComputedImpactByTable): Promise<IEvaluatedComputedValues> {
    const entries = Object.entries(impact).filter(
      ([, group]) => group.recordIds.size && group.fieldIds.size
    );

    const tableResults = await Promise.all(
      entries.map(async ([tableId, group]) => {
        const recordIds = Array.from(group.recordIds);
        const requestedFieldIds = Array.from(group.fieldIds);

        // Resolve valid field instances on this table
        const fieldInstances = await this.getFieldInstances(tableId, requestedFieldIds);
        const validFieldIds = fieldInstances.map((f) => f.id);
        if (!validFieldIds.length || !recordIds.length) return [tableId, {}] as const;

        // Build query via record-query-builder with projection (pure SELECT)
        const dbTableName = await this.getDbTableName(tableId);
        const { qb, alias } = await this.recordQueryBuilder.createRecordQueryBuilder(dbTableName, {
          tableIdOrDbTableName: tableId,
          projection: validFieldIds,
        });

        const idCol = alias ? `${alias}.__id` : '__id';
        const rows = await this.prismaService
          .txClient()
          .$queryRawUnsafe<
            Array<{ __id: string; __version: number } & Record<string, unknown>>
          >(qb.whereIn(idCol, recordIds).toQuery());

        // Convert returned DB values to cell values keyed by fieldId for ops
        const tableMap: {
          [recordId: string]: { version: number; fields: { [fieldId: string]: unknown } };
        } = {};

        for (const row of rows) {
          const recordId = row.__id;
          const version = row.__version;
          const fieldsMap: Record<string, unknown> = {};
          for (const field of fieldInstances) {
            const raw = row[field.dbFieldName as keyof typeof row] as unknown;
            const cellValue = field.convertDBValue2CellValue(raw as never);
            if (cellValue != null) fieldsMap[field.id] = cellValue;
          }
          tableMap[recordId] = { version, fields: fieldsMap };
        }

        return [tableId, tableMap] as const;
      })
    );

    return tableResults.reduce<IEvaluatedComputedValues>((acc, [tid, tmap]) => {
      if (Object.keys(tmap).length) acc[tid] = tmap;
      return acc;
    }, {});
  }
}
