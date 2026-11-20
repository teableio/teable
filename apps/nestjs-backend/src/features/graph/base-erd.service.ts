import { Injectable } from '@nestjs/common';
import { FieldType, type ILinkFieldOptions } from '@teable/core';
import { PrismaService, type Field, type TableMeta } from '@teable/db-main-prisma';
import type { IBaseErdTableNode, IBaseErdEdge } from '@teable/openapi';
import { groupBy, keyBy } from 'lodash';
import { baseDisplayName } from '../../utils/base-name';

@Injectable()
export class BaseErdService {
  constructor(private readonly prismaService: PrismaService) {}

  async generateBaseErd(baseId: string) {
    const tableRaws = await this.prismaService.tableMeta.findMany({
      where: {
        baseId,
        deletedTime: null,
      },
      select: { id: true, name: true, icon: true },
    });

    const { tableMap, fieldMap, linkFieldRaws, tableNodes } = await this.getBaseErdContext(
      tableRaws.map((table) => table.id)
    );

    const { references, referenceFieldRaws } = await this.getBaseErdReference(
      Object.keys(fieldMap)
    );

    const {
      tableNodes: crossTableNodes,
      tableMap: crossTableTableMap,
      fieldMap: crossTableFieldMap,
      linkFieldRaws: crossBaseLinkFieldRaws,
    } = await this.getBaseErdContext(
      referenceFieldRaws.filter((field) => !tableMap[field.tableId]).map((field) => field.tableId),
      true
    );

    const edges = await this.generateBaseErdEdges({
      linkFieldRaws,
      crossBaseLinkFieldRaws,
      tableMap,
      fieldMap,
      crossBaseTableMap: crossTableTableMap,
      crossBaseFieldMap: crossTableFieldMap,
      references,
    });

    return {
      baseId,
      nodes: [...tableNodes, ...crossTableNodes],
      edges,
    };
  }

  private async getBaseErdContext(tableIds: string[], crossBase?: boolean) {
    if (tableIds.length === 0) {
      return {
        tableRaws: [],
        tableMap: {},
        fieldRaws: [],
        fieldMap: {},
        linkFieldRaws: [],
        tableNodes: [],
      };
    }
    const tableRaws = await this.prismaService.tableMeta.findMany({
      where: {
        id: { in: tableIds },
        deletedTime: null,
      },
      select: {
        id: true,
        name: true,
        icon: true,
        base: crossBase ? { select: { id: true, name: true } } : undefined,
      },
      orderBy: {
        order: 'asc',
      },
    });
    const tableMap = keyBy(tableRaws, 'id');

    const fieldRaws = await this.prismaService.field.findMany({
      where: {
        tableId: { in: Object.keys(tableMap) },
        deletedTime: null,
      },
      select: {
        id: true,
        tableId: true,
        name: true,
        type: true,
        options: true,
        isLookup: true,
        lookupLinkedFieldId: true,
      },
      orderBy: {
        order: 'asc',
      },
    });

    const fieldMap = keyBy(fieldRaws, 'id');

    const linkFieldRaws = fieldRaws
      .filter((field) => field.type === FieldType.Link && !field.isLookup)
      .map((field) => {
        return {
          ...field,
          options: field.options && JSON.parse(field.options as string),
        };
      });

    const tableId2fieldRaws = groupBy(fieldRaws, 'tableId');

    const tableNodes = tableRaws.map<IBaseErdTableNode>((table) => {
      const items = tableId2fieldRaws[table.id] ?? [];
      return {
        id: table.id,
        name: table.name,
        icon: table.icon ?? undefined,
        crossBaseId: crossBase ? table.base.id : undefined,
        crossBaseName: crossBase ? baseDisplayName(table.base.name) : undefined,
        fields: items.map((field) => ({
          id: field.id,
          name: field.name,
          type: field.type as FieldType,
          isLookup: field.isLookup ?? undefined,
        })),
      };
    });

    return {
      tableRaws,
      tableMap,
      fieldRaws,
      fieldMap,
      linkFieldRaws,
      tableNodes,
    };
  }

  private async getBaseErdReference(allFieldIds: string[]) {
    const references = await this.prismaService.txClient().reference.findMany({
      where: {
        OR: [{ fromFieldId: { in: allFieldIds } }, { toFieldId: { in: allFieldIds } }],
      },
      select: {
        fromFieldId: true,
        toFieldId: true,
      },
    });

    const referenceFieldIds = [
      ...new Set(references.flatMap((ref) => [ref.fromFieldId, ref.toFieldId])),
    ];

    const referenceFieldRaws = await this.prismaService.txClient().field.findMany({
      where: {
        id: { in: referenceFieldIds },
      },
      select: {
        id: true,
        tableId: true,
      },
    });

    return {
      references,
      referenceFieldRaws,
    };
  }

  /**
   * if A -> B & B -> A, keep A <-> B
   */
  // eslint-disable-next-line sonarjs/cognitive-complexity
  private async generateBaseErdEdges(params: {
    linkFieldRaws: (Pick<Field, 'id' | 'name' | 'type' | 'tableId'> & {
      options: ILinkFieldOptions;
    })[];
    tableMap: Record<string, Pick<TableMeta, 'id' | 'name' | 'icon'>>;
    fieldMap: Record<
      string,
      Pick<Field, 'id' | 'tableId' | 'name' | 'type' | 'isLookup' | 'lookupLinkedFieldId'>
    >;
    crossBaseLinkFieldRaws: (Pick<Field, 'id' | 'name' | 'type' | 'tableId'> & {
      options: ILinkFieldOptions;
    })[];
    crossBaseTableMap: Record<string, Pick<TableMeta, 'id' | 'name' | 'icon'>>;
    crossBaseFieldMap: Record<
      string,
      Pick<Field, 'id' | 'tableId' | 'name' | 'type' | 'isLookup' | 'lookupLinkedFieldId'>
    >;
    references: { fromFieldId: string; toFieldId: string }[];
  }) {
    const {
      linkFieldRaws,
      tableMap,
      fieldMap,
      crossBaseLinkFieldRaws,
      crossBaseTableMap,
      crossBaseFieldMap,
      references,
    } = params;

    const fieldEdgeMap = new Map<string, boolean>();
    const edges: IBaseErdEdge[] = [];
    for (const field of [...linkFieldRaws, ...crossBaseLinkFieldRaws]) {
      const { options } = field;
      const sourceTable =
        tableMap[options.foreignTableId] ?? crossBaseTableMap[options.foreignTableId];
      const sourceFieldId = options.symmetricFieldId ?? options.lookupFieldId;
      const sourceField = fieldMap[sourceFieldId] ?? crossBaseFieldMap[sourceFieldId];

      const targetTable = tableMap[field.tableId] ?? crossBaseTableMap[field.tableId];
      const targetField = fieldMap[field.id] ?? crossBaseFieldMap[field.id];

      if (!sourceTable || !targetTable || !sourceField || !targetField) {
        continue;
      }

      const edge: IBaseErdEdge = {
        source: {
          tableId: sourceTable.id,
          tableName: sourceTable.name,
          fieldId: sourceField.id,
          fieldName: sourceField.name,
        },
        target: {
          tableId: targetTable.id,
          tableName: targetTable.name,
          fieldId: targetField.id,
          fieldName: targetField.name,
        },
        relationship: options.relationship,
        isOneWay: options.isOneWay ?? false,
        type: field.type as FieldType,
      };
      const key = `${sourceField.id}-${targetField.id}`;
      const reverseKey = `${targetField.id}-${sourceField.id}`;
      if (fieldEdgeMap.has(reverseKey)) {
        fieldEdgeMap.set(key, true);
        continue;
      }
      fieldEdgeMap.set(key, false);
      edges.push(edge);
    }

    for (const { fromFieldId, toFieldId } of references) {
      const fromField = fieldMap[fromFieldId] ?? crossBaseFieldMap[fromFieldId];
      const toField = fieldMap[toFieldId] ?? crossBaseFieldMap[toFieldId];

      if (!fromField || !toField) {
        continue;
      }

      const fromTable = tableMap[fromField.tableId] ?? crossBaseTableMap[fromField.tableId];
      const toTable = tableMap[toField.tableId] ?? crossBaseTableMap[toField.tableId];

      if (!fromTable || !toTable) {
        continue;
      }

      const key = `${fromField.id}-${toField.id}`;
      const reverseKey = `${toField.id}-${fromField.id}`;
      if (fieldEdgeMap.has(key) || fieldEdgeMap.has(reverseKey)) {
        continue;
      }

      if (toField.lookupLinkedFieldId && toField.lookupLinkedFieldId === fromField.id) {
        continue;
      }

      const edge: IBaseErdEdge = {
        source: {
          tableId: fromTable.id,
          tableName: fromTable.name,
          fieldId: fromField.id,
          fieldName: fromField.name,
        },
        target: {
          tableId: toTable.id,
          tableName: toTable.name,
          fieldId: toField.id,
          fieldName: toField.name,
        },
        type: toField.isLookup ? 'lookup' : (toField.type as FieldType),
      };
      edges.push(edge);
      fieldEdgeMap.set(key, true);
    }

    return edges.map((edge) => {
      const key = `${edge.source.fieldId}-${edge.target.fieldId}`;
      const guessOneWay = fieldEdgeMap.get(key) ?? true;
      return {
        ...edge,
        isOneWay: edge.isOneWay ?? guessOneWay,
      };
    });
  }
}
