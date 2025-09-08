import { Injectable } from '@nestjs/common';
import { PrismaService } from '@teable/db-main-prisma';
import { createFieldInstanceByRaw, type IFieldInstance } from '../../field/model/factory';
import { InjectRecordQueryBuilder, type IRecordQueryBuilder } from '../../record/query-builder';
import { RecordComputedUpdateService } from '../../record/record-computed-update.service';
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

        // Build query via record-query-builder with projection
        const dbTableName = await this.getDbTableName(tableId);
        const { qb } = await this.recordQueryBuilder.createRecordQueryBuilder(dbTableName, {
          tableIdOrDbTableName: tableId,
          projection: validFieldIds,
        });

        // Apply updates using UPDATE ... (SELECT ...) form with RETURNING
        const updatedRows = await this.recordComputedUpdateService.updateFromSelect(
          tableId,
          qb.whereIn('__id', recordIds),
          fieldInstances
        );

        // Convert returned DB values to cell values keyed by fieldId for ops
        const tableMap: {
          [recordId: string]: { version: number; fields: { [fieldId: string]: unknown } };
        } = {};

        for (const row of updatedRows) {
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
