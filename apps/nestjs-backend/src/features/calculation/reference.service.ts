import { Injectable } from '@nestjs/common';
import type { IRecord, Relationship } from '@teable/core';
import { extractFieldIdsFromFilter } from '@teable/core';
import { PrismaService } from '@teable/db-main-prisma';
import { Knex } from 'knex';
import { difference, uniq } from 'lodash';
import { InjectModel } from 'nest-knexjs';
import { InjectDbProvider } from '../../db-provider/db.provider';
import { IDbProvider } from '../../db-provider/db.provider.interface';
import type { IFieldInstance, IFieldMap } from '../field/model/factory';
import { createFieldInstanceByRaw } from '../field/model/factory';
import { filterDirectedGraph } from './utils/dfs';

// topo item is for field level reference, all id stands for fieldId;
export interface ITopoItem {
  id: string;
  dependencies: string[];
}

export interface ITopoItemWithRecords extends ITopoItem {
  recordItemMap?: Record<string, IRecordItem>;
}

export interface IGraphItem {
  fromFieldId: string;
  toFieldId: string;
}

export interface IRecordMap {
  [recordId: string]: IRecord;
}

export interface IRecordItem {
  record: IRecord;
  dependencies?: IRecord[];
}

export interface IRecordData {
  id: string;
  fieldId: string;
  oldValue?: unknown;
  newValue: unknown;
}

export interface IRelatedRecordItem {
  toId: string;
  fromId?: string;
}

export interface ITopoLinkOrder {
  fieldId: string;
  relationship: Relationship;
  fkHostTableName: string;
  selfKeyName: string;
  foreignKeyName: string;
}

@Injectable()
export class ReferenceService {
  constructor(
    private readonly prismaService: PrismaService,
    @InjectModel('CUSTOM_KNEX') private readonly knex: Knex,
    @InjectDbProvider() private readonly dbProvider: IDbProvider
  ) {}

  private async getLookupFilterFieldMap(fieldMap: IFieldMap) {
    const fieldIds = Object.keys(fieldMap)
      .map((fieldId) => {
        const lookupOptions = fieldMap[fieldId].lookupOptions;
        if (lookupOptions && lookupOptions.filter) {
          return extractFieldIdsFromFilter(lookupOptions.filter, true);
        }
        return [];
      })
      .flat();

    const fieldRaws = await this.prismaService.txClient().field.findMany({
      where: { id: { in: fieldIds }, deletedTime: null },
    });

    return fieldRaws.reduce<{ [fieldId: string]: IFieldInstance }>((pre, f) => {
      pre[f.id] = createFieldInstanceByRaw(f);
      return pre;
    }, {});
  }

  async createAuxiliaryData(allFieldIds: string[]) {
    const prisma = this.prismaService.txClient();
    const fieldRaws = await prisma.field.findMany({
      where: { id: { in: allFieldIds }, deletedTime: null },
    });

    // if a field that has been looked up  has changed, the link field should be retrieved as context
    const extraLinkFieldIds = difference(
      fieldRaws
        .filter((field) => field.lookupLinkedFieldId)
        .map((field) => field.lookupLinkedFieldId as string),
      allFieldIds
    );

    const extraLinkFieldRaws = await prisma.field.findMany({
      where: { id: { in: extraLinkFieldIds }, deletedTime: null },
    });

    fieldRaws.push(...extraLinkFieldRaws);

    const fieldId2TableId = fieldRaws.reduce<{ [fieldId: string]: string }>((pre, f) => {
      pre[f.id] = f.tableId;
      return pre;
    }, {});

    const tableIds = uniq(Object.values(fieldId2TableId));
    const tableMeta = await prisma.tableMeta.findMany({
      where: { id: { in: tableIds } },
      select: { id: true, dbTableName: true },
    });

    const tableId2DbTableName = tableMeta.reduce<{ [tableId: string]: string }>((pre, t) => {
      pre[t.id] = t.dbTableName;
      return pre;
    }, {});

    const fieldMap = fieldRaws.reduce<IFieldMap>((pre, f) => {
      pre[f.id] = createFieldInstanceByRaw(f);
      return pre;
    }, {});

    const lookupFilterFieldMap = await this.getLookupFilterFieldMap(fieldMap);

    const dbTableName2fields = fieldRaws.reduce<{ [fieldId: string]: IFieldInstance[] }>(
      (pre, f) => {
        const dbTableName = tableId2DbTableName[f.tableId];
        if (pre[dbTableName]) {
          pre[dbTableName].push(fieldMap[f.id]);
        } else {
          pre[dbTableName] = [fieldMap[f.id]];
        }
        return pre;
      },
      {}
    );

    const fieldId2DbTableName = fieldRaws.reduce<{ [fieldId: string]: string }>((pre, f) => {
      pre[f.id] = tableId2DbTableName[f.tableId];
      return pre;
    }, {});

    return {
      fieldMap: { ...fieldMap, ...lookupFilterFieldMap },
      fieldId2TableId,
      fieldId2DbTableName,
      dbTableName2fields,
      tableId2DbTableName,
    };
  }

  private getQueryColumnName(field: IFieldInstance): string {
    return field.dbFieldName;
  }

  recordRaw2Record(fields: IFieldInstance[], raw: { [dbFieldName: string]: unknown }): IRecord {
    const fieldsData = fields.reduce<{ [fieldId: string]: unknown }>((acc, field) => {
      const queryColumnName = this.getQueryColumnName(field);
      const cellValue = field.convertDBValue2CellValue(raw[queryColumnName] as string);
      acc[field.id] = cellValue;
      return acc;
    }, {});

    return {
      fields: fieldsData,
      id: raw.__id as string,
      autoNumber: raw.__auto_number as number,
      createdTime: (raw.__created_time as Date)?.toISOString(),
      lastModifiedTime: (raw.__last_modified_time as Date)?.toISOString(),
      createdBy: raw.__created_by as string,
      lastModifiedBy: raw.__last_modified_by as string,
    };
  }

  async getFieldGraphItems(startFieldIds: string[]): Promise<IGraphItem[]> {
    const getResult = async (startFieldIds: string[]) => {
      const _knex = this.knex;

      const nonRecursiveQuery = _knex
        .select('from_field_id', 'to_field_id')
        .from('reference')
        .whereIn('from_field_id', startFieldIds)
        .orWhereIn('to_field_id', startFieldIds);
      const recursiveQuery = _knex
        .select('deps.from_field_id', 'deps.to_field_id')
        .from('reference as deps')
        .join('connected_reference as cd', function () {
          const sql = '?? = ?? AND ?? != ??';
          const depsFromField = 'deps.from_field_id';
          const depsToField = 'deps.to_field_id';
          const cdFromField = 'cd.from_field_id';
          const cdToField = 'cd.to_field_id';
          this.on(
            _knex.raw(sql, [depsFromField, cdFromField, depsToField, cdToField]).wrap('(', ')')
          );
          this.orOn(
            _knex.raw(sql, [depsFromField, cdToField, depsToField, cdFromField]).wrap('(', ')')
          );
          this.orOn(
            _knex.raw(sql, [depsToField, cdFromField, depsFromField, cdToField]).wrap('(', ')')
          );
          this.orOn(
            _knex.raw(sql, [depsToField, cdToField, depsFromField, cdFromField]).wrap('(', ')')
          );
        });
      const cteQuery = nonRecursiveQuery.union(recursiveQuery);
      const finalQuery = this.knex
        .withRecursive('connected_reference', ['from_field_id', 'to_field_id'], cteQuery)
        .distinct('from_field_id', 'to_field_id')
        .from('connected_reference')
        .toQuery();

      return (
        this.prismaService
          .txClient()
          // eslint-disable-next-line @typescript-eslint/naming-convention
          .$queryRawUnsafe<{ from_field_id: string; to_field_id: string }[]>(finalQuery)
      );
    };

    const queryResult = await getResult(startFieldIds);

    return filterDirectedGraph(
      queryResult.map((row) => ({ fromFieldId: row.from_field_id, toFieldId: row.to_field_id })),
      startFieldIds
    );
  }

  flatGraph(graph: { toFieldId: string; fromFieldId: string }[]) {
    const allNodes = new Set<string>();
    for (const edge of graph) {
      allNodes.add(edge.fromFieldId);
      allNodes.add(edge.toFieldId);
    }
    return Array.from(allNodes);
  }

  /**
   * Given a list of fieldIds, return unique tableIds related by Reference graph.
   * The result includes the tables of the start fields and all connected fields
   * discovered through the reference relationships (transitively), de-duplicated.
   */
  async getRelatedTableIdsByFieldIds(startFieldIds: string[]): Promise<string[]> {
    if (!startFieldIds.length) return [];

    const visitedFieldIds = new Set<string>();
    const queue: string[] = [...startFieldIds];
    const tableIds = new Set<string>();

    // Prime map for initial fields → tableId
    const initialFields = await this.prismaService.txClient().field.findMany({
      where: { id: { in: startFieldIds }, deletedTime: null },
      select: { id: true, tableId: true },
    });
    for (const f of initialFields) {
      tableIds.add(f.tableId);
    }

    while (queue.length) {
      const fid = queue.shift()!;
      if (visitedFieldIds.has(fid)) continue;
      visitedFieldIds.add(fid);

      // 1) Fields (lookup/rollup) whose lookupOptions.lookupFieldId === fid
      const q1 = this.dbProvider.lookupOptionsQuery('lookupFieldId', fid);
      const deps1 = await this.prismaService
        .txClient()
        .$queryRawUnsafe<{ tableId: string; id: string }[]>(q1);
      for (const row of deps1) {
        tableIds.add(row.tableId);
        queue.push(row.id);
      }

      // 2) Fields (lookup/rollup) attached to a link: lookupOptions.linkFieldId === fid
      const q2 = this.dbProvider.lookupOptionsQuery('linkFieldId', fid);
      const deps2 = await this.prismaService
        .txClient()
        .$queryRawUnsafe<{ tableId: string; id: string }[]>(q2);
      for (const row of deps2) {
        tableIds.add(row.tableId);
        queue.push(row.id);
      }
    }

    return Array.from(tableIds);
  }
}
