import { Injectable } from '@nestjs/common';
import type { IRecord } from '@teable-group/core';
import { Relationship, FieldType, evaluate } from '@teable-group/core';
import type { Field } from '@teable-group/db-main-prisma';
import { Prisma } from '@teable-group/db-main-prisma';
import type { Knex } from 'knex';
import knex from 'knex';
import { groupBy } from 'lodash';
import type { IVisualTableDefaultField } from '../field/constant';
import { preservedFieldName } from '../field/constant';
import type { IFieldInstance } from '../field/model/factory';
import { createFieldInstanceByRaw } from '../field/model/factory';

interface ITopoItem {
  id: string;
  dependencies: string[];
}

interface ITopoItemWithRecords extends ITopoItem {
  records: IRecord[];
}

interface ITopoLinkOrder {
  dbTableName: string;
  fieldName: string; // for debug only
  foreignKeyField: string;
  relationship: Relationship;
  linkedTable: string;
}

@Injectable()
export class ReferenceService {
  knex: ReturnType<typeof knex>;

  constructor() {
    this.knex = knex({ client: 'sqlite3' });
  }

  calculate(
    field: IFieldInstance,
    dependenceFieldMap: { [fieldId: string]: IFieldInstance },
    record: IRecord
  ): unknown {
    if (!field.isComputed) {
      return;
    }
    const formula = `{${field.id}}`;

    return evaluate(formula, dependenceFieldMap, record).value;
  }

  private async createAuxiliaryData(prisma: Prisma.TransactionClient, allFieldIds: string[]) {
    const fieldRaws = await prisma.field.findMany({
      where: { id: { in: allFieldIds } },
    });

    const fieldId2TableId = fieldRaws.reduce<{ [fieldId: string]: string }>((pre, f) => {
      pre[f.id] = f.tableId;
      return pre;
    }, {});

    const tableIds = Array.from(new Set(Object.values(fieldId2TableId)));
    const tableMeta = await prisma.tableMeta.findMany({
      where: { id: { in: tableIds } },
      select: { id: true, dbTableName: true },
    });

    const tableId2DbTableName = tableMeta.reduce<{ [tableId: string]: string }>((pre, t) => {
      pre[t.id] = t.dbTableName;
      return pre;
    }, {});

    const fieldMap = fieldRaws.reduce<{ [fieldId: string]: IFieldInstance }>((pre, f) => {
      pre[f.id] = createFieldInstanceByRaw(f);
      return pre;
    }, {});

    const dbTableName2fieldRaws = fieldRaws.reduce<{ [fieldId: string]: Field[] }>((pre, f) => {
      const dbTableName = tableId2DbTableName[f.tableId];
      if (pre[dbTableName]) {
        pre[dbTableName].push(f);
      } else {
        pre[dbTableName] = [f];
      }
      return pre;
    }, {});

    return {
      fieldMap,
      fieldId2TableId,
      dbTableName2fieldRaws,
      tableId2DbTableName,
    };
  }

  collectChanges(
    orders: ITopoItemWithRecords[],
    fieldMap: { [fieldId: string]: IFieldInstance },
    fieldId2TableId: { [fieldId: string]: string }
  ) {
    // detail changes
    const changes: {
      tableId: string;
      recordId: string;
      fieldId: string;
      oldValue: unknown;
      newValue: unknown;
    }[] = [];

    orders.forEach((item) =>
      item.records.forEach((record) => {
        const field = fieldMap[item.id];
        const value = field.isComputed
          ? this.calculate(field, fieldMap, record)
          : record.fields[item.id];

        const oldValue = record.fields[item.id];
        record.fields[item.id] = value;

        if (oldValue !== value) {
          changes.push({
            tableId: fieldId2TableId[item.id],
            fieldId: item.id,
            recordId: record.id,
            oldValue,
            newValue: value,
          });
        }
      })
    );
    return changes;
  }

  async updateNodeValues(prisma: Prisma.TransactionClient, fieldId: string, recordIds: string[]) {
    const undirectedGraph = await this.getDependentNodesCTE(prisma, fieldId);
    const order = this.getTopologicalOrderRecursive(fieldId, undirectedGraph);
    const allFieldIds = this.flatGraph(undirectedGraph);
    const { fieldMap, fieldId2TableId, dbTableName2fieldRaws, tableId2DbTableName } =
      await this.createAuxiliaryData(prisma, allFieldIds);

    const linkOrder = this.getLinkOrderFromOrder({
      tableId2DbTableName,
      order,
      fieldMap,
      fieldId2TableId,
    });

    const affectedRecordItems = await this.getAffectedRecordItems(prisma, recordIds, linkOrder);

    const orderWithRecords = await this.getTopoItemWithRecords(prisma, {
      order,
      fieldMap,
      tableId2DbTableName,
      fieldId2TableId,
      dbTableName2fieldRaws,
      recordItems: affectedRecordItems,
    });

    return this.collectChanges(orderWithRecords, fieldMap, fieldId2TableId);
  }

  private recordRaw2Record(
    fieldRaws: Field[],
    raw: { [dbFieldName: string]: unknown } & IVisualTableDefaultField
  ) {
    const fieldsData = fieldRaws.reduce<{ [fieldId: string]: unknown }>((acc, field) => {
      acc[field.id] = raw[field.dbFieldName];
      return acc;
    }, {});

    return {
      fields: fieldsData,
      id: raw.__id,
      createdTime: raw.__created_time?.getTime(),
      lastModifiedTime: raw.__last_modified_time?.getTime(),
      createdBy: raw.__created_by,
      lastModifiedBy: raw.__last_modified_by,
      recordOrder: {},
    };
  }

  getLinkOrderFromOrder(params: {
    fieldId2TableId: { [fieldId: string]: string };
    tableId2DbTableName: { [tableId: string]: string };
    order: ITopoItem[];
    fieldMap: { [fieldId: string]: IFieldInstance };
  }): ITopoLinkOrder[] {
    const newOrder: ITopoLinkOrder[] = [];
    const { tableId2DbTableName, fieldId2TableId, order, fieldMap } = params;
    for (const item of order) {
      const field = fieldMap[item.id];
      const tableId = fieldId2TableId[field.id];
      const dbTableName = tableId2DbTableName[tableId];
      if (field.type === FieldType.Link) {
        const foreignKeyFieldName = field.options.dbForeignKeyName;
        const linkedTable = tableId2DbTableName[field.options.foreignTableId];

        newOrder.push({
          dbTableName,
          fieldName: field.name,
          foreignKeyField: foreignKeyFieldName,
          linkedTable,
          relationship: field.options.relationship,
        });
      }
    }
    return newOrder;
  }

  async getTopoItemWithRecords(
    prisma: Prisma.TransactionClient,
    params: {
      order: ITopoItem[];
      tableId2DbTableName: { [tableId: string]: string };
      fieldId2TableId: { [fieldId: string]: string };
      fieldMap: { [fieldId: string]: IFieldInstance };
      dbTableName2fieldRaws: { [tableId: string]: Field[] };
      recordItems: { id: string; dbTableName: string }[];
    }
  ): Promise<ITopoItemWithRecords[]> {
    const {
      order,
      fieldMap,
      tableId2DbTableName,
      fieldId2TableId,
      dbTableName2fieldRaws,
      recordItems,
    } = params;
    const recordIdsByTableName = groupBy(recordItems, 'dbTableName');

    let query: Knex.QueryBuilder | undefined;
    for (const dbTableName in recordIdsByTableName) {
      const recordIds = recordIdsByTableName[dbTableName].map((r) => r.id);
      const fieldNames = dbTableName2fieldRaws[dbTableName].map((f) => f.dbFieldName);
      const aliasedFieldNames = [...fieldNames, ...preservedFieldName].map(
        (fieldName) => `${dbTableName}.${fieldName} as '${dbTableName}#${fieldName}'`
      );
      const subQuery = knex(dbTableName).select(aliasedFieldNames).whereIn('id', recordIds);
      query = query ? query.union(subQuery) : subQuery;
    }
    if (!query) {
      throw new Error("recordItems shouldn't be empty");
    }
    const nativeSql = query.toSQL().toNative();
    console.log('getRecordSQL:', nativeSql.sql);
    const result = await prisma.$queryRawUnsafe<{ [fieldName: string]: unknown }[]>(
      nativeSql.sql,
      ...nativeSql.bindings
    );
    const formattedResults = this.formatRecordQueryResult(result, dbTableName2fieldRaws);

    return order.map((order) => {
      const field = fieldMap[order.id];

      // linkField use records from link table as context
      if (field.type === FieldType.Link) {
        const foreignTableName = tableId2DbTableName[field.options.foreignTableId];
        const records = formattedResults[foreignTableName];
        return {
          ...order,
          records,
        };
      }

      const tableId = fieldId2TableId[order.id];
      const dbTableName = tableId2DbTableName[tableId];
      const records = formattedResults[dbTableName];

      return {
        ...order,
        records,
      };
    });
  }

  private formatRecordQueryResult(
    result: { [fieldName: string]: unknown }[],
    dbTableName2fieldRaws: { [tableId: string]: Field[] }
  ): {
    [tableName: string]: IRecord[];
  } {
    const formattedResults: {
      [tableName: string]: { [fieldKey: string]: unknown }[];
    } = {};
    result.forEach((record) => {
      for (const key in record) {
        const value = record[key];
        const recordData: { [k: string]: unknown } = {};
        if (value == null) {
          continue;
        }

        const [tableName, fieldName] = key.split('#');
        recordData[fieldName] = value;

        if (!formattedResults[tableName]) {
          formattedResults[tableName] = [];
        }

        const existingRecord = formattedResults[tableName].find(
          (r) => r.__id === record[`${tableName}__id`]
        );

        if (existingRecord) {
          existingRecord[fieldName] = record[key];
        } else {
          formattedResults[tableName].push({ [fieldName]: record[key] });
        }
      }
    });

    return Object.entries(formattedResults).reduce<{ [tableName: string]: IRecord[] }>((acc, e) => {
      const [dbTableName, records] = e;
      const fieldRaws = dbTableName2fieldRaws[dbTableName];
      acc[dbTableName] = records.map((r) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return this.recordRaw2Record(fieldRaws, r as any);
      });
      return acc;
    }, {});
  }

  getTopologicalOrderRecursive(
    startNodeId: string,
    graph: { toFieldId: string; fromFieldId: string }[]
  ): ITopoItem[] {
    const visitedNodes = new Set<string>();
    const sortedNodes: ITopoItem[] = [];

    function visit(node: string) {
      if (!visitedNodes.has(node)) {
        visitedNodes.add(node);

        const incomingEdges = graph.filter((edge) => edge.toFieldId === node);
        const outgoingEdges = graph.filter((edge) => edge.fromFieldId === node);
        const dependencies: string[] = [];

        for (const edge of incomingEdges) {
          dependencies.push(edge.fromFieldId);
        }

        for (const edge of outgoingEdges) {
          visit(edge.toFieldId);
        }

        sortedNodes.push({ id: node, dependencies });
      }
    }

    visit(startNodeId);

    return sortedNodes.reverse();
  }

  async getDependentNodesCTE(prisma: Prisma.TransactionClient, startFieldId: string) {
    const dependentNodesQuery = Prisma.sql`
      WITH RECURSIVE connected_reference(from_field_id, to_field_id) AS (
        SELECT from_field_id, to_field_id FROM reference WHERE from_field_id = ${startFieldId} OR to_field_id = ${startFieldId}
        UNION
        SELECT deps.from_field_id, deps.to_field_id
        FROM reference deps
        JOIN connected_reference cd
          ON (deps.from_field_id = cd.from_field_id AND deps.to_field_id != cd.to_field_id) 
          OR (deps.from_field_id = cd.to_field_id AND deps.to_field_id != cd.from_field_id) 
          OR (deps.to_field_id = cd.from_field_id AND deps.from_field_id != cd.to_field_id) 
          OR (deps.to_field_id = cd.to_field_id AND deps.from_field_id != cd.from_field_id)
      )
      SELECT DISTINCT from_field_id, to_field_id FROM connected_reference;
    `;
    // eslint-disable-next-line @typescript-eslint/naming-convention
    const result = await prisma.$queryRaw<{ from_field_id: string; to_field_id: string }[]>(
      dependentNodesQuery
    );
    return result.map((row) => ({ fromFieldId: row.from_field_id, toFieldId: row.to_field_id }));
  }

  private getLink2Table(order: ITopoLinkOrder) {
    switch (order.relationship) {
      case Relationship.ManyOne:
        return order.linkedTable;
      case Relationship.OneMany:
        return order.dbTableName;
      case Relationship.ManyMany:
        return '__ManyMany__';
    }
  }

  private getCurrentTable(order: ITopoLinkOrder) {
    switch (order.relationship) {
      case Relationship.ManyOne:
        return order.dbTableName;
      case Relationship.OneMany:
        return order.linkedTable;
      case Relationship.ManyMany:
        return '__ManyMany__';
    }
  }

  async getAffectedRecordItems(
    prisma: Prisma.TransactionClient,
    startIds: string[],
    topoOrder: ITopoLinkOrder[]
  ): Promise<{ id: string; dbTableName: string }[]> {
    // Initialize the base case for the recursive CTE)
    const initTableName = this.getLink2Table(topoOrder[0]);
    let cteQuery = `SELECT __id, '${initTableName}' as dbTableName FROM ${initTableName} WHERE __id IN (${startIds
      .map((id) => `'${id}'`)
      .join(',')})`;

    // Iterate over the nodes in topological order
    for (let i = 0; i < topoOrder.length; i++) {
      const currentOrder = topoOrder[i];
      const dbTableName = this.getCurrentTable(currentOrder);
      const foreignKeyField = currentOrder.foreignKeyField;

      // Append the current node to the recursive CTE
      if (currentOrder.relationship === Relationship.OneMany) {
        cteQuery += `
        UNION ALL
        SELECT ${dbTableName}.__id, '${dbTableName}' as dbTableName
        FROM ${dbTableName}
        JOIN (
            SELECT ${foreignKeyField}
            FROM ${dbTableName}
            WHERE __id IN (SELECT __id FROM affected_records)
        ) AS related_records
        ON ${dbTableName}.${foreignKeyField} = related_records.${foreignKeyField}
        WHERE ${dbTableName}.__id NOT IN (SELECT __id FROM affected_records)`;
      } else {
        cteQuery += `
        UNION ALL
        SELECT ${dbTableName}.__id, '${dbTableName}' as dbTableName
        FROM ${dbTableName}
        JOIN affected_records
        ON ${dbTableName}.${foreignKeyField} = affected_records.__id
        WHERE affected_records.dbTableName = '${currentOrder.linkedTable}'`;
      }
    }

    // Construct the final query using the recursive CTE
    const finalQuery = `
    WITH RECURSIVE affected_records AS (${cteQuery})
    SELECT * FROM affected_records`;

    console.log('nativeSql:', finalQuery);

    const results = await prisma.$queryRawUnsafe<{ __id: string; dbTableName: string }[]>(
      finalQuery
    );

    return results.map((record) => ({ id: record.__id, dbTableName: record.dbTableName }));
  }

  private flatGraph(graph: { toFieldId: string; fromFieldId: string }[]) {
    const allNodes = new Set<string>();
    for (const edge of graph) {
      allNodes.add(edge.fromFieldId);
      allNodes.add(edge.toFieldId);
    }
    return Array.from(allNodes);
  }
}
