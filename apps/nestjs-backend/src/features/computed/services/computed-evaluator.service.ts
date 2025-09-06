import { Injectable } from '@nestjs/common';
import type { ISnapshotBase } from '@teable/core';
import { PrismaService } from '@teable/db-main-prisma';
import { RecordService } from '../../record/record.service';
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
    private readonly recordService: RecordService
  ) {}

  private async getProjection(
    tableId: string,
    fieldIds: string[]
  ): Promise<Record<string, boolean>> {
    // Ensure fields exist and are on tableId to avoid projection mismatches
    if (!fieldIds.length) return {};
    const rows = await this.prismaService.txClient().field.findMany({
      where: { id: { in: fieldIds }, tableId, deletedTime: null },
      select: { id: true },
    });
    const valid = new Set(rows.map((r) => r.id));
    return Array.from(valid).reduce<Record<string, boolean>>((acc, id) => {
      acc[id] = true;
      return acc;
    }, {});
  }

  /**
   * For each table, query only the impacted records and the dependent computed fields.
   * Uses RecordService.getSnapshotBulk with projection to get normalized cell values.
   */
  async evaluate(impact: IComputedImpactByTable): Promise<IEvaluatedComputedValues> {
    const entries = Object.entries(impact).filter(
      ([, group]) => group.recordIds.size && group.fieldIds.size
    );

    const tableResults = await Promise.all(
      entries.map(async ([tableId, group]) => {
        const recordIds = Array.from(group.recordIds);
        const fieldIds = Array.from(group.fieldIds);
        const projection = await this.getProjection(tableId, fieldIds);
        if (!Object.keys(projection).length) return [tableId, {}] as const;

        const snapshots = await this.recordService.getSnapshotBulk(tableId, recordIds, projection);
        const tableMap: {
          [recordId: string]: { version: number; fields: { [fieldId: string]: unknown } };
        } = {};
        for (const snap of snapshots) {
          const data = snap.data.fields || {};
          const fieldsMap: Record<string, unknown> = {};
          for (const fid of fieldIds) {
            if (projection[fid]) fieldsMap[fid] = data[fid];
          }
          tableMap[snap.id] = { version: snap.v, fields: fieldsMap };
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
