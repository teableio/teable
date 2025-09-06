/* eslint-disable sonarjs/no-duplicate-string */
/* eslint-disable @typescript-eslint/naming-convention */
import { Injectable } from '@nestjs/common';
import type { ILinkFieldOptions } from '@teable/core';
import { FieldType } from '@teable/core';
import { PrismaService } from '@teable/db-main-prisma';
import { Knex } from 'knex';
import { InjectModel } from 'nest-knexjs';

export interface ICellBasicContext {
  recordId: string;
  fieldId: string;
}

export interface IComputedImpactByTable {
  [tableId: string]: {
    fieldIds: Set<string>;
    recordIds: Set<string>;
  };
}

@Injectable()
export class ComputedDependencyCollectorService {
  constructor(
    private readonly prismaService: PrismaService,
    @InjectModel('CUSTOM_KNEX') private readonly knex: Knex
  ) {}

  // Minimal link options needed for join table lookups
  private parseLinkOptions(
    raw: unknown
  ): Pick<
    ILinkFieldOptions,
    'foreignTableId' | 'fkHostTableName' | 'selfKeyName' | 'foreignKeyName'
  > | null {
    let value: unknown = raw;
    if (typeof value === 'string') {
      try {
        value = JSON.parse(value);
      } catch {
        return null;
      }
    }
    if (!value || typeof value !== 'object') return null;
    const obj = value as Record<string, unknown>;
    const foreignTableId = obj['foreignTableId'];
    const fkHostTableName = obj['fkHostTableName'];
    const selfKeyName = obj['selfKeyName'];
    const foreignKeyName = obj['foreignKeyName'];
    if (
      typeof foreignTableId === 'string' &&
      typeof fkHostTableName === 'string' &&
      typeof selfKeyName === 'string' &&
      typeof foreignKeyName === 'string'
    ) {
      return { foreignTableId, fkHostTableName, selfKeyName, foreignKeyName };
    }
    return null;
  }

  /**
   * Same as collectDependentFieldIds but groups by table id directly in SQL.
   * Returns a map: tableId -> Set<fieldId>
   */
  private async collectDependentFieldsByTable(
    startFieldIds: string[]
  ): Promise<Record<string, Set<string>>> {
    if (!startFieldIds.length) return {};

    const nonRecursive = this.knex
      .select('from_field_id', 'to_field_id')
      .from('reference')
      .whereIn('from_field_id', startFieldIds);

    const recursive = this.knex
      .select('r.from_field_id', 'r.to_field_id')
      .from({ r: 'reference' })
      .join({ d: 'dep_graph' }, 'r.from_field_id', 'd.to_field_id');

    const finalQuery = this.knex
      .withRecursive('dep_graph', ['from_field_id', 'to_field_id'], nonRecursive.union(recursive))
      .distinct({ to_field_id: 'dep_graph.to_field_id', table_id: 'f.table_id' })
      .from('dep_graph')
      .join({ f: 'field' }, 'f.id', 'dep_graph.to_field_id')
      .whereNull('f.deleted_time')
      .toQuery();

    const rows = await this.prismaService
      .txClient()
      .$queryRawUnsafe<{ to_field_id: string; table_id: string }[]>(finalQuery);

    const result: Record<string, Set<string>> = {};
    for (const r of rows) {
      if (!r.table_id || !r.to_field_id) continue;
      (result[r.table_id] ||= new Set<string>()).add(r.to_field_id);
    }
    return result;
  }

  /**
   * Given a table (targetTableId) and the changed table (changedTableId),
   * return recordIds in targetTableId that link to any of changedRecordIds via any link field.
   */
  private async getLinkedRecordIds(
    targetTableId: string,
    changedTableId: string,
    changedRecordIds: string[]
  ): Promise<string[]> {
    if (!changedRecordIds.length) return [];

    // Fetch link fields on targetTableId that point to changedTableId
    const linkFields = await this.prismaService.txClient().field.findMany({
      where: {
        tableId: targetTableId,
        type: FieldType.Link,
        isLookup: null,
        deletedTime: null,
      },
      select: { id: true, options: true },
    });
    // Build a UNION query across all matching link junction tables
    const selects = [] as Knex.QueryBuilder[];
    for (const lf of linkFields) {
      const opts = this.parseLinkOptions(lf.options);
      if (!opts || opts.foreignTableId !== changedTableId) continue;
      const { fkHostTableName, selfKeyName, foreignKeyName } = opts;
      selects.push(
        this.knex(fkHostTableName)
          .select({ id: selfKeyName })
          .whereIn(foreignKeyName, changedRecordIds)
          .whereNotNull(selfKeyName)
          .whereNotNull(foreignKeyName)
      );
    }

    if (!selects.length) return [];

    const unionQuery = this.knex.queryBuilder().union(selects);
    const finalQuery = this.knex.select('id').from(unionQuery.as('u')).distinct('id').toQuery();
    const rows = await this.prismaService.txClient().$queryRawUnsafe<{ id: string }[]>(finalQuery);
    return rows.map((r) => r.id).filter(Boolean);
  }

  /**
   * Collect impacted computed fields grouped by table, and the associated recordIds to re-evaluate.
   * - Same-table computed fields: impacted recordIds are the updated records themselves.
   * - Cross-table computed fields (via link/lookup/rollup): impacted records are those linking to
   *   the changed records through any link field on the target table that points to the changed table.
   */
  async collect(tableId: string, ctxs: ICellBasicContext[]): Promise<IComputedImpactByTable> {
    if (!ctxs.length) return {};

    const changedFieldIds = Array.from(new Set(ctxs.map((c) => c.fieldId)));
    const changedRecordIds = Array.from(new Set(ctxs.map((c) => c.recordId)));

    // 1) Transitive dependents grouped by table (SQL CTE + join field)
    const depByTable = await this.collectDependentFieldsByTable(changedFieldIds);
    const impact: IComputedImpactByTable = Object.entries(depByTable).reduce((acc, [tid, fset]) => {
      acc[tid] = { fieldIds: new Set(fset), recordIds: new Set<string>() };
      return acc;
    }, {} as IComputedImpactByTable);
    if (!Object.keys(impact).length) return {};

    // 3) Compute impacted recordIds per table
    const tasks: Promise<void>[] = [];
    for (const [tid, group] of Object.entries(impact)) {
      if (tid === tableId) {
        changedRecordIds.forEach((id) => group.recordIds.add(id));
        continue;
      }
      tasks.push(
        this.getLinkedRecordIds(tid, tableId, changedRecordIds).then((linked) => {
          linked.forEach((id) => group.recordIds.add(id));
        })
      );
    }
    if (tasks.length) await Promise.all(tasks);

    return impact;
  }
}
