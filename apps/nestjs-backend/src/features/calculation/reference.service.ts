import { Injectable } from '@nestjs/common';
import type { IRecord, LinkFieldCore } from '@teable-group/core';
import { CellValueType, Relationship, FieldType, evaluate } from '@teable-group/core';
import { Prisma } from '@teable-group/db-main-prisma';
import { instanceToPlain } from 'class-transformer';
import knex from 'knex';
import { groupBy, intersectionBy, uniqBy } from 'lodash';
import type { IVisualTableDefaultField } from '../field/constant';
import { preservedFieldName } from '../field/constant';
import type { IFieldInstance } from '../field/model/factory';
import { createFieldInstanceByRaw } from '../field/model/factory';
import type { LinkFieldDto } from '../field/model/field-dto/link-field.dto';

interface ITopoItem {
  id: string;
  dependencies: string[];
}

interface IRecordItem {
  record: IRecord;
  calculated?: { [fieldId: string]: boolean };
  dependencies?: IRecord | IRecord[];
}

export interface ICellChange {
  tableId: string;
  recordId: string;
  fieldId: string;
  oldValue: unknown;
  newValue: unknown;
}

export interface ITopoItemWithRecords extends ITopoItem {
  recordItems: IRecordItem[];
}

interface ITopoLinkOrder {
  dbTableName: string;
  fieldId: string;
  foreignKeyField: string;
  relationship: Relationship;
  linkedTable: string;
}

interface IRecordRefItem {
  id: string;
  dbTableName: string;
  fieldId?: string;
  selectIn?: string;
  relationTo?: string;
}

@Injectable()
export class ReferenceService {
  private readonly knex = knex({ client: 'sqlite3' });

  async calculate(
    prisma: Prisma.TransactionClient,
    tableId: string,
    recordData: { id: string; fieldId: string; newValue: unknown }[]
  ): Promise<ICellChange[]> {
    // console.log('calculate', tableId, recordData);
    const fieldIds = recordData.map((ctx) => ctx.fieldId);
    const undirectedGraph = await this.getDependentNodesCTE(prisma, fieldIds);
    if (!undirectedGraph.length) {
      return [];
    }
    const allFieldIds = this.flatGraph(undirectedGraph);
    const { fieldMap, fieldId2TableId, dbTableName2fields, tableId2DbTableName } =
      await this.createAuxiliaryData(prisma, allFieldIds);

    const topoOrdersByFieldId = uniqBy(recordData, 'fieldId').reduce<{
      [fieldId: string]: ITopoItem[];
    }>((pre, { fieldId }) => {
      pre[fieldId] = this.getTopologicalOrder(fieldId, undirectedGraph);
      return pre;
    }, {});

    // console.log('topoOrdersByFieldId:', topoOrdersByFieldId);
    const originRecordItems = recordData.map((record) => ({
      dbTableName: tableId2DbTableName[tableId],
      fieldId: record.fieldId,
      newValue: record.newValue,
      id: record.id,
    }));

    let affectedRecordItems: IRecordRefItem[] = [];
    for (const fieldId in topoOrdersByFieldId) {
      const topoOrders = topoOrdersByFieldId[fieldId];
      const linkOrders = this.getLinkOrderFromTopoOrders({
        tableId2DbTableName,
        topoOrders,
        fieldMap,
        fieldId2TableId,
      });
      // only affected records included
      const items = await this.getAffectedRecordItems(prisma, originRecordItems, linkOrders);
      affectedRecordItems = affectedRecordItems.concat(items);
    }
    // console.log('affectedRecordItems', affectedRecordItems);

    // extra dependent records for link field
    const dependentRecordItems = await this.getDependentRecordItems(prisma, affectedRecordItems);
    // console.log('dependentRecordItems', dependentRecordItems);

    // record data source
    const dbTableName2records = await this.getRecordsBatch(prisma, {
      originRecordItems,
      affectedRecordItems,
      dependentRecordItems,
      dbTableName2fields,
    });
    // console.log('dbTableName2records', dbTableName2records);

    const changes = Object.values(topoOrdersByFieldId).reduce<ICellChange[]>((pre, topoOrders) => {
      const orderWithRecords = this.createTopoItemWithRecords({
        topoOrders,
        fieldMap,
        tableId2DbTableName,
        fieldId2TableId,
        dbTableName2records,
        affectedRecordItems,
        dependentRecordItems,
      });
      // console.log('collectChanges:', orderWithRecords, fieldId2TableId);

      return pre.concat(this.collectChanges(orderWithRecords, fieldMap, fieldId2TableId));
    }, []);
    // console.log('changes:', changes);

    return this.mergeDuplicateChange(changes);
  }

  private calculateFormula(
    field: IFieldInstance,
    fieldMap: { [fieldId: string]: IFieldInstance },
    recordItem: IRecordItem
  ) {
    const record = recordItem.record;
    // TODO: lookup and rollup field have the same logical
    if (field.type === FieldType.Link) {
      if (!recordItem.dependencies) {
        throw new Error(`Dependency should not be undefined when contains a ${field.type} field`);
      }
      const lookupField = fieldMap[field.options.lookupFieldId];

      return this.calculateRollup(field, lookupField, record, recordItem.dependencies);
    }

    if (field.type === FieldType.Formula) {
      const typedValue = evaluate(field.options.expression, fieldMap, record);
      if (typedValue.isMultiple) {
        return field.cellValue2String(typedValue.toPlain());
      }
      return typedValue.toPlain();
    }

    throw new Error('Unsupported field type');
  }

  private calculateRollup(
    field: LinkFieldDto,
    lookupField: IFieldInstance,
    record: IRecord,
    dependencies: IRecord | IRecord[]
  ): unknown {
    const fieldRaw = instanceToPlain(lookupField, { excludePrefixes: ['_'] });

    // TODO: array value flatten
    const lookupValues = Array.isArray(dependencies)
      ? dependencies.map((depRecord) => depRecord.fields[lookupField.id])
      : dependencies.fields[lookupField.id];

    const virtualField = createFieldInstanceByRaw({
      ...fieldRaw,
      id: 'values',
      cellValueType: CellValueType.String,
      isMultipleCellValue: field.options.relationship === Relationship.OneMany,
      options: JSON.stringify(fieldRaw.options),
      defaultValue: JSON.stringify(fieldRaw.defaultValue),
      columnMeta: JSON.stringify(fieldRaw.columnMeta),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);
    // console.log('virtualField:', virtualField);
    // console.log('lookupValues:', lookupValues);

    const result = evaluate(
      field.expression,
      { values: virtualField },
      { ...record, fields: { ...record.fields, values: lookupValues } }
    );
    // console.log('calculateRollup:result', result);
    const plain = result.toPlain();
    // console.log('calculateRollup:plain', plain);

    // console.log('calculateRollup:currentValue', record.fields[field.id]);
    if (field.type === FieldType.Link) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return field.updateCellTitle(record.fields[field.id] as any, plain);
    }
    return plain;
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

    return {
      fieldMap,
      fieldId2TableId,
      dbTableName2fields,
      tableId2DbTableName,
    };
  }

  private collectChanges(
    orders: ITopoItemWithRecords[],
    fieldMap: { [fieldId: string]: IFieldInstance },
    fieldId2TableId: { [fieldId: string]: string }
  ) {
    // detail changes
    // console.log('collectChanges:', orders, fieldMap);
    const changes: ICellChange[] = [];

    orders.forEach((item) => {
      item.recordItems.forEach((recordItem) => {
        const field = fieldMap[item.id];
        // console.log('collectChanges:recordItems:', field, recordItem.record);
        if (!field.isComputed) {
          return;
        }
        const record = recordItem.record;
        const value = this.calculateFormula(field, fieldMap, recordItem);
        // console.log(`calculated: ${field.id}.${record.id}`, value);
        const oldValue = record.fields[field.id];
        record.fields[field.id] = value;
        changes.push({
          tableId: fieldId2TableId[field.id],
          fieldId: field.id,
          recordId: record.id,
          oldValue,
          newValue: value,
        });
      });
    });
    return changes;
  }

  private recordRaw2Record(
    fields: IFieldInstance[],
    raw: { [dbFieldName: string]: unknown } & IVisualTableDefaultField
  ) {
    const fieldsData = fields.reduce<{ [fieldId: string]: unknown }>((acc, field) => {
      acc[field.id] = field.convertDBValue2CellValue(raw[field.dbFieldName] as string);
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

  private getLinkOrderFromTopoOrders(params: {
    fieldId2TableId: { [fieldId: string]: string };
    tableId2DbTableName: { [tableId: string]: string };
    topoOrders: ITopoItem[];
    fieldMap: { [fieldId: string]: IFieldInstance };
  }): ITopoLinkOrder[] {
    const newOrder: ITopoLinkOrder[] = [];
    const { tableId2DbTableName, fieldId2TableId, topoOrders, fieldMap } = params;
    for (const item of topoOrders) {
      const field = fieldMap[item.id];
      const tableId = fieldId2TableId[field.id];
      const dbTableName = tableId2DbTableName[tableId];
      if (field.type === FieldType.Link) {
        const foreignKeyFieldName = field.options.dbForeignKeyName;
        const linkedTable = tableId2DbTableName[field.options.foreignTableId];

        newOrder.push({
          dbTableName,
          fieldId: field.id,
          foreignKeyField: foreignKeyFieldName,
          linkedTable,
          relationship: field.options.relationship,
        });
      }
    }
    return newOrder;
  }

  private async getRecordsBatch(
    prisma: Prisma.TransactionClient,
    params: {
      originRecordItems: { dbTableName: string; id: string; fieldId: string; newValue: unknown }[];
      dbTableName2fields: { [tableId: string]: IFieldInstance[] };
      affectedRecordItems: IRecordRefItem[];
      dependentRecordItems: IRecordRefItem[];
    }
  ) {
    const { originRecordItems, affectedRecordItems, dependentRecordItems, dbTableName2fields } =
      params;
    const recordIdsByTableName = groupBy(
      [...affectedRecordItems, ...dependentRecordItems, ...originRecordItems],
      'dbTableName'
    );

    const results: {
      [tableName: string]: { [fieldName: string]: unknown }[];
    } = {};
    for (const dbTableName in recordIdsByTableName) {
      // deduplication is needed
      const recordIds = Array.from(new Set(recordIdsByTableName[dbTableName].map((r) => r.id)));
      const fieldNames = dbTableName2fields[dbTableName]
        .map((f) => f.dbFieldName)
        .concat([...preservedFieldName]);
      const nativeSql = this.knex(dbTableName)
        .select(fieldNames)
        .whereIn('__id', recordIds)
        .toSQL()
        .toNative();
      const result = await prisma.$queryRawUnsafe<{ [fieldName: string]: unknown }[]>(
        nativeSql.sql,
        ...nativeSql.bindings
      );
      results[dbTableName] = result;
    }

    const formattedResults = this.formatRecordQueryResult(results, dbTableName2fields);

    this.coverRecordData(originRecordItems, formattedResults);

    return formattedResults;
  }

  private getOneManyDependencies(params: {
    field: LinkFieldCore;
    record: IRecord;
    foreignTableRecords: IRecord[];
    dependentRecordItems: IRecordRefItem[];
  }): IRecord[] {
    const { field, dependentRecordItems, record, foreignTableRecords } = params;

    if (field.options.relationship !== Relationship.OneMany) {
      throw new Error("field's relationship should be OneMany");
    }
    return dependentRecordItems
      .filter((item) => item.relationTo === record.id && item.fieldId === field.id)
      .map((item) => {
        const record = foreignTableRecords.find((r) => r.id === item.id);
        if (!record) {
          throw new Error('Can not find link record');
        }
        return record;
      });
  }

  private getMany2OneDependency(params: {
    field: LinkFieldCore;
    record: IRecord;
    foreignTableRecords: IRecord[];
    affectedRecordItems: IRecordRefItem[];
  }): IRecord {
    const { field, record, affectedRecordItems, foreignTableRecords } = params;

    if (field.options.relationship !== Relationship.ManyOne) {
      throw new Error("field's relationship should be ManyOne");
    }

    const linkRecordRef = affectedRecordItems.find((item) => item.id === record.id);
    if (!linkRecordRef) {
      throw new Error('Can not find link record ref');
    }

    const linkRecord = foreignTableRecords.find((r) => r.id === linkRecordRef.relationTo);
    if (!linkRecord) {
      throw new Error('Can not find link record');
    }
    return linkRecord;
  }

  private createTopoItemWithRecords(params: {
    topoOrders: ITopoItem[];
    tableId2DbTableName: { [tableId: string]: string };
    fieldId2TableId: { [fieldId: string]: string };
    fieldMap: { [fieldId: string]: IFieldInstance };
    dbTableName2records: { [tableName: string]: IRecord[] };
    affectedRecordItems: IRecordRefItem[];
    dependentRecordItems: IRecordRefItem[];
  }): ITopoItemWithRecords[] {
    const {
      topoOrders,
      fieldMap,
      tableId2DbTableName,
      fieldId2TableId,
      dbTableName2records,
      affectedRecordItems,
      dependentRecordItems,
    } = params;
    const affectedRecordItemIndexed = groupBy(affectedRecordItems, 'dbTableName');
    const dependentRecordItemIndexed = groupBy(dependentRecordItems, 'dbTableName');
    return topoOrders.map((order) => {
      const field = fieldMap[order.id];

      const tableId = fieldId2TableId[order.id];
      const dbTableName = tableId2DbTableName[tableId];
      const allRecords = dbTableName2records[dbTableName];
      const affectedRecordItems = affectedRecordItemIndexed[dbTableName];
      // only affected record need to be calculated
      const records = intersectionBy(allRecords, affectedRecordItems, 'id');

      // update link field dependency
      if (field.type === FieldType.Link) {
        const foreignTableName = tableId2DbTableName[field.options.foreignTableId];
        const foreignTableRecords = dbTableName2records[foreignTableName];
        const dependentRecordItems = dependentRecordItemIndexed[foreignTableName];
        const dependenciesArr = records.map((record) => {
          if (field.options.relationship === Relationship.OneMany) {
            return this.getOneManyDependencies({
              record,
              field,
              foreignTableRecords,
              dependentRecordItems,
            });
          }
          if (field.options.relationship === Relationship.ManyOne) {
            return this.getMany2OneDependency({
              record,
              field,
              foreignTableRecords,
              affectedRecordItems,
            });
          }
          throw new Error('Unsupported relationship');
        });
        return {
          ...order,
          recordItems: records.map((record, i) => ({ record, dependencies: dependenciesArr[i] })),
        };
      }

      return {
        ...order,
        recordItems: records.map((record) => ({ record })),
      };
    });
  }

  private formatRecordQueryResult(
    formattedResults: {
      [tableName: string]: { [dbFiendName: string]: unknown }[];
    },
    dbTableName2fields: { [tableId: string]: IFieldInstance[] }
  ): {
    [tableName: string]: IRecord[];
  } {
    return Object.entries(formattedResults).reduce<{
      [dbTableName: string]: IRecord[];
    }>((acc, e) => {
      const [dbTableName, recordMap] = e;
      const fields = dbTableName2fields[dbTableName];
      acc[dbTableName] = recordMap.map((r) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return this.recordRaw2Record(fields, r as any);
      });
      return acc;
    }, {});
  }

  // use modified record data to cover the record data from db
  private coverRecordData(
    newRecordData: { id: string; dbTableName: string; fieldId: string; newValue: unknown }[],
    allRecordByDbTableName: { [tableName: string]: IRecord[] }
  ) {
    newRecordData.forEach((cover) => {
      const records = allRecordByDbTableName[cover.dbTableName];
      records.forEach((record) => {
        record.fields[cover.fieldId] = cover.newValue;
      });
    });
  }

  private getTopologicalOrder(
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

  private async getDependentNodesCTE(prisma: Prisma.TransactionClient, startFieldIds: string[]) {
    let result: { fromFieldId: string; toFieldId: string }[] = [];
    const getResult = async (startFieldId: string) => {
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
      return await prisma.$queryRaw<{ from_field_id: string; to_field_id: string }[]>(
        dependentNodesQuery
      );
    };

    for (const fieldId of startFieldIds) {
      const queryResult = await getResult(fieldId);
      result = result.concat(
        queryResult.map((row) => ({ fromFieldId: row.from_field_id, toFieldId: row.to_field_id }))
      );
    }

    return result;
  }

  /**
   * when update multi field in a record, there may be duplicate change.
   * see this case, A and B update at the same time
   * A -> C -> E
   * A -> D -> E
   * B -> D -> E
   * D will be calculated twice
   * E will be calculated twice
   * so we need to merge duplicate change to reduce update times
   */
  mergeDuplicateChange(changes: ICellChange[]) {
    const indexCache: { [key: string]: number } = {};
    const mergedChanges: ICellChange[] = [];

    for (const change of changes) {
      const key = `${change.tableId}#${change.fieldId}#${change.recordId}`;
      if (indexCache[key] !== undefined) {
        mergedChanges[indexCache[key]].newValue = change.newValue;
      } else {
        indexCache[key] = mergedChanges.length;
        mergedChanges.push(change);
      }
    }
    return mergedChanges;
  }

  private async getDependentRecordItems(
    prisma: Prisma.TransactionClient,
    recordItems: IRecordRefItem[]
  ): Promise<IRecordRefItem[]> {
    if (!recordItems.length) {
      return [];
    }

    const queries = recordItems
      .filter((item) => item.selectIn)
      .map((item) => {
        const { id, fieldId, selectIn } = item;
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        const [dbTableName, selectField] = selectIn!.split('.');
        return this.knex
          .select([
            `${dbTableName}.__id as id`,
            `${dbTableName}.${selectField} as relationTo`,
            this.knex.raw(`'${dbTableName}' as dbTableName`),
            this.knex.raw(`'${fieldId}' as fieldId`),
          ])
          .from(dbTableName)
          .where(selectField, id);
      });
    if (!queries.length) {
      return [];
    }

    const [firstQuery, ...restQueries] = queries;
    const nativeSql = firstQuery.union(restQueries).toSQL().toNative();

    return await prisma.$queryRawUnsafe<IRecordRefItem[]>(nativeSql.sql, ...nativeSql.bindings);
  }

  private async getAffectedRecordItems(
    prisma: Prisma.TransactionClient,
    originRecordItems: { dbTableName: string; id: string }[],
    topoOrder: ITopoLinkOrder[]
  ): Promise<IRecordRefItem[]> {
    if (!topoOrder.length) {
      return originRecordItems;
    }
    // Initialize the base case for the recursive CTE)
    const initTableName = topoOrder[0].linkedTable;
    let cteQuery = `
    SELECT __id, '${initTableName}' as dbTableName, null as selectIn, null as relationTo, null as fieldId
    FROM ${initTableName} WHERE __id IN (${originRecordItems.map((r) => `'${r.id}'`).join(',')})`;

    // Iterate over the nodes in topological order
    for (let i = 0; i < topoOrder.length; i++) {
      const currentOrder = topoOrder[i];
      const { fieldId, foreignKeyField, dbTableName, linkedTable } = currentOrder;

      // Append the current node to the recursive CTE
      if (currentOrder.relationship === Relationship.OneMany) {
        cteQuery += `
        UNION
        SELECT ${linkedTable}.${foreignKeyField} as __id, '${dbTableName}' as dbTableName, '${linkedTable}.${foreignKeyField}' as selectIn , null as relationTo, '${fieldId}' as fieldId
        FROM ${linkedTable}
        JOIN affected_records
        ON ${linkedTable}.__id = affected_records.__id
        WHERE affected_records.dbTableName = '${linkedTable}'`;
      } else {
        cteQuery += `
        UNION
        SELECT ${dbTableName}.__id, '${dbTableName}' as dbTableName, null as selectIn, affected_records.__id as relationTo, '${fieldId}' as fieldId
        FROM ${dbTableName}
        JOIN affected_records
        ON ${dbTableName}.${foreignKeyField} = affected_records.__id
        WHERE affected_records.dbTableName = '${linkedTable}'`;
      }
    }

    // Construct the final query using the recursive CTE
    const finalQuery = `
    WITH affected_records AS (${cteQuery})
    SELECT * FROM affected_records`;

    // console.log('getAffectedRecordItems:', finalQuery);

    const results = await prisma.$queryRawUnsafe<
      {
        __id: string;
        dbTableName: string;
        selectIn?: string;
        fieldId?: string;
        relationTo?: string;
      }[]
    >(finalQuery);

    // startIds are always the first records in the result set, so we can just slice them off
    return results.splice(originRecordItems.length).map((record) => ({
      id: record.__id,
      dbTableName: record.dbTableName,
      ...(record.relationTo ? { relationTo: record.relationTo } : {}),
      ...(record.fieldId ? { fieldId: record.fieldId } : {}),
      ...(record.selectIn ? { selectIn: record.selectIn } : {}),
    }));
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
