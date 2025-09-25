import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import type { IFieldRo, ILinkFieldOptions, IConvertFieldRo } from '@teable/core';
import { FieldType, Relationship } from '@teable/core';
import type { Field, TableMeta } from '@teable/db-main-prisma';
import { PrismaService } from '@teable/db-main-prisma';
import type {
  IGraphEdge,
  IGraphNode,
  IGraphCombo,
  IPlanFieldVo,
  IPlanFieldConvertVo,
  IPlanFieldDeleteVo,
  IBaseErdTableNode,
  IBaseErdEdge,
} from '@teable/openapi';
import { Knex } from 'knex';
import { groupBy, keyBy, uniq } from 'lodash';
import { InjectModel } from 'nest-knexjs';
import { IThresholdConfig, ThresholdConfig } from '../../configs/threshold.config';
import { majorFieldKeysChanged } from '../../utils/major-field-keys-changed';
import { Timing } from '../../utils/timing';
import { FieldCalculationService } from '../calculation/field-calculation.service';
import type { IGraphItem } from '../calculation/reference.service';
import { ReferenceService } from '../calculation/reference.service';
import { pruneGraph, topoOrderWithStart } from '../calculation/utils/dfs';
import { FieldConvertingLinkService } from '../field/field-calculate/field-converting-link.service';
import { FieldConvertingService } from '../field/field-calculate/field-converting.service';
import { FieldSupplementService } from '../field/field-calculate/field-supplement.service';
import { FieldService } from '../field/field.service';
import {
  createFieldInstanceByVo,
  type IFieldInstance,
  type IFieldMap,
} from '../field/model/factory';

interface ITinyField {
  id: string;
  name: string;
  type: string;
  tableId: string;
  isLookup?: boolean | null;
}

interface ITinyTable {
  id: string;
  name: string;
  dbTableName: string;
}

@Injectable()
export class GraphService {
  private logger = new Logger(GraphService.name);

  constructor(
    private readonly prismaService: PrismaService,
    private readonly fieldService: FieldService,
    private readonly referenceService: ReferenceService,
    private readonly fieldSupplementService: FieldSupplementService,
    private readonly fieldCalculationService: FieldCalculationService,
    private readonly fieldConvertingService: FieldConvertingService,
    private readonly fieldConvertingLinkService: FieldConvertingLinkService,
    @InjectModel('CUSTOM_KNEX') private readonly knex: Knex,
    @ThresholdConfig() private readonly thresholdConfig: IThresholdConfig
  ) {}

  private getFieldNodesAndCombos(
    fieldId: string,
    fieldRawsMap: Record<string, ITinyField[]>,
    tableRaws: ITinyTable[]
  ) {
    const nodes: IGraphNode[] = [];
    const combos: IGraphCombo[] = [];
    tableRaws.forEach(({ id: tableId, name: tableName }) => {
      combos.push({
        id: tableId,
        label: tableName,
      });
      fieldRawsMap[tableId].forEach((field) => {
        nodes.push({
          id: field.id,
          label: field.name,
          comboId: tableId,
          fieldType: field.type,
          isLookup: field.isLookup,
          isSelected: field.id === fieldId,
        });
      });
    });
    return {
      nodes,
      combos,
    };
  }

  private getEstimateTime(cellCount: number) {
    return Math.floor(cellCount / this.thresholdConfig.estimateCalcCelPerMs);
  }

  async planFieldCreate(tableId: string, fieldRo: IFieldRo): Promise<IPlanFieldVo> {
    const fieldVo = await this.fieldSupplementService.prepareCreateField(tableId, fieldRo);
    const field = createFieldInstanceByVo(fieldVo);

    const referenceFieldIds = this.fieldSupplementService.getFieldReferenceIds(field);
    const directedGraph = await this.referenceService.getFieldGraphItems(referenceFieldIds);
    const fromGraph = referenceFieldIds.map((fromFieldId) => ({
      fromFieldId,
      toFieldId: field.id,
    }));
    directedGraph.push(...fromGraph);
    const allFieldIds = uniq(
      directedGraph.map((item) => [item.fromFieldId, item.toFieldId]).flat()
    );
    const fieldRaws = await this.prismaService.field.findMany({
      where: { id: { in: allFieldIds } },
      select: { id: true, name: true, type: true, isLookup: true, tableId: true },
    });

    fieldRaws.push({
      id: field.id,
      name: field.name,
      type: field.type,
      isLookup: field.isLookup || null,
      tableId,
    });

    const tableRaws = await this.prismaService.tableMeta.findMany({
      where: { id: { in: uniq(fieldRaws.map((item) => item.tableId)) } },
      select: { id: true, name: true, dbTableName: true },
    });

    const tableMap = keyBy(tableRaws, 'id');
    const fieldMap = keyBy(fieldRaws, 'id');

    const fieldRawsMap = groupBy(fieldRaws, 'tableId');

    const edges = directedGraph.map<IGraphEdge>((node) => {
      const field = fieldMap[node.toFieldId];
      return {
        source: node.fromFieldId,
        target: node.toFieldId,
        label: field.isLookup ? 'lookup' : field.type,
      };
    }, []);

    const { nodes, combos } = this.getFieldNodesAndCombos(field.id, fieldRawsMap, tableRaws);
    const updateCellCount = await this.affectedCellCount(
      field.id,
      [field.id],
      { [field.id]: field },
      { [field.id]: tableMap[tableId].dbTableName }
    );
    const estimateTime = field.isComputed ? this.getEstimateTime(updateCellCount) : 200;
    return {
      graph: {
        nodes,
        edges,
        combos,
      },
      updateCellCount,
      estimateTime,
    };
  }

  private async getField(tableId: string, fieldId: string, fieldRo: IConvertFieldRo) {
    const oldFieldVo = await this.fieldService.getField(tableId, fieldId);
    if (!oldFieldVo) {
      throw new BadRequestException(`Not found fieldId(${fieldId})`);
    }
    const oldField = createFieldInstanceByVo(oldFieldVo);
    const newFieldVo = await this.fieldSupplementService.prepareUpdateField(
      tableId,
      fieldRo,
      oldField
    );
    const newField = createFieldInstanceByVo(newFieldVo);
    return { oldField, newField };
  }

  private async getFullTopoOrdersContext(field: IFieldInstance, directedGraph?: IGraphItem[]) {
    const oldRefernce: string[] = [field.id];
    const lookupGraph: IGraphItem[] = [];
    const selfLookupReference = await this.prismaService.field.findMany({
      where: {
        lookupLinkedFieldId: field.id,
        deletedTime: null,
      },
      select: { id: true },
    });
    oldRefernce.push(...selfLookupReference.map((f) => f.id));
    lookupGraph.push(
      ...selfLookupReference.map((f) => ({ fromFieldId: field.id, toFieldId: f.id }))
    );

    if (field.type === FieldType.Link && !field.isLookup && field.options.symmetricFieldId) {
      const findSymmetricField = await this.prismaService.field.findUnique({
        where: {
          id: field.options.symmetricFieldId,
          deletedTime: null,
        },
        select: { id: true },
      });

      if (findSymmetricField) {
        const suplimentLookupRefernce = await this.prismaService.field.findMany({
          where: {
            lookupLinkedFieldId: field.options.symmetricFieldId,
            deletedTime: null,
          },
          select: { id: true },
        });
        oldRefernce.push(
          ...suplimentLookupRefernce.map((field) => field.id),
          field.options.symmetricFieldId
        );
        lookupGraph.push(
          ...suplimentLookupRefernce.map((f) => ({ fromFieldId: field.id, toFieldId: f.id }))
        );
        lookupGraph.push({ fromFieldId: field.id, toFieldId: field.options.symmetricFieldId });
      }
    }

    const context = await this.fieldCalculationService.getTopoOrdersContext(
      oldRefernce,
      directedGraph
    );
    return {
      ...context,
      allFieldIds: uniq([...context.allFieldIds, ...lookupGraph.map((item) => item.toFieldId)]),
      directedGraph: context.directedGraph.concat(lookupGraph),
      fieldMap: {
        ...context.fieldMap,
      },
    };
  }

  @Timing()
  private async getUpdateCalculationContext(newField: IFieldInstance) {
    const fieldId = newField.id;

    const newReference = this.fieldSupplementService.getFieldReferenceIds(newField);

    const incomingGraph = await this.referenceService.getFieldGraphItems(newReference);

    const oldGraph = await this.referenceService.getFieldGraphItems([fieldId]);

    const tempGraph = [
      ...oldGraph.filter((graph) => graph.toFieldId !== fieldId),
      ...incomingGraph.filter((graph) => graph.toFieldId !== fieldId),
      ...newReference.map((id) => ({ fromFieldId: id, toFieldId: fieldId })),
    ];

    const newDirectedGraph = pruneGraph(fieldId, tempGraph);

    const context = await this.getFullTopoOrdersContext(newField, newDirectedGraph);
    const fieldMap = {
      ...context.fieldMap,
      [newField.id]: newField,
    };

    return {
      ...context,
      fieldMap,
    };
  }

  private async generateGraph(params: {
    fieldId: string;
    directedGraph: IGraphItem[];
    allFieldIds: string[];
    fieldMap: IFieldMap;
    tableId2DbTableName: Record<string, string>;
    fieldId2TableId: Record<string, string>;
  }) {
    const { fieldId, directedGraph, allFieldIds, fieldMap, tableId2DbTableName, fieldId2TableId } =
      params;

    const edges = directedGraph.map<IGraphEdge>((node) => {
      const field = fieldMap[node.toFieldId];
      return {
        source: node.fromFieldId,
        target: node.toFieldId,
        label: field.isLookup ? 'lookup' : field.type,
      };
    }, []);

    const tableIds = Object.keys(tableId2DbTableName);
    const tableRaws = await this.prismaService.tableMeta.findMany({
      where: { id: { in: tableIds } },
      select: { id: true, name: true },
    });

    const combos = tableRaws.map<IGraphCombo>((table) => ({
      id: table.id,
      label: table.name,
    }));

    const nodes = allFieldIds.map<IGraphNode>((id) => {
      const tableId = fieldId2TableId[id];
      const field = fieldMap[id];
      return {
        id: field.id,
        label: field.name,
        comboId: tableId,
        fieldType: field.type,
        isLookup: field.isLookup,
        isSelected: field.id === fieldId,
      };
    });

    return {
      nodes,
      edges,
      combos,
    };
  }

  async planFieldConvert(
    tableId: string,
    fieldId: string,
    fieldRo: IConvertFieldRo
  ): Promise<IPlanFieldConvertVo> {
    const { oldField, newField } = await this.getField(tableId, fieldId, fieldRo);
    const majorChange = majorFieldKeysChanged(oldField, fieldRo);

    if (!majorChange) {
      return { skip: true };
    }

    const context = await this.getUpdateCalculationContext(newField);

    const {
      directedGraph,
      allFieldIds,
      fieldMap,
      fieldId2DbTableName,
      tableId2DbTableName,
      fieldId2TableId,
    } = context;
    const topoFieldIds = topoOrderWithStart(fieldId, directedGraph);

    const graph = await this.generateGraph({
      fieldId,
      directedGraph,
      allFieldIds,
      fieldMap,
      tableId2DbTableName,
      fieldId2TableId,
    });

    const updateCellCount = await this.affectedCellCount(
      fieldId,
      topoFieldIds,
      fieldMap,
      fieldId2DbTableName
    );

    const resetLinkFieldLookupFieldIds =
      await this.fieldConvertingLinkService.planResetLinkFieldLookupFieldId(
        tableId,
        newField,
        'field|update'
      );

    return {
      graph,
      updateCellCount,
      estimateTime: this.getEstimateTime(updateCellCount),
      linkFieldCount: resetLinkFieldLookupFieldIds.length,
    };
  }

  async planDeleteField(tableId: string, fieldId: string): Promise<IPlanFieldDeleteVo> {
    const res = await this.planField(tableId, fieldId);
    const field = await this.fieldService.getField(tableId, fieldId);
    const fieldInstance = createFieldInstanceByVo(field);
    const resetLinkFieldLookupFieldIds =
      await this.fieldConvertingLinkService.planResetLinkFieldLookupFieldId(
        tableId,
        fieldInstance,
        'field|delete'
      );

    return {
      ...res,
      linkFieldCount: resetLinkFieldLookupFieldIds.length,
    };
  }

  private async affectedCellCount(
    hostFieldId: string,
    fieldIds: string[],
    fieldMap: IFieldMap,
    fieldId2DbTableName: Record<string, string>
  ): Promise<number> {
    const queries = fieldIds.map((fieldId) => {
      const field = fieldMap[fieldId];
      if (field.id !== hostFieldId && (field.lookupOptions || field.type === FieldType.Link)) {
        const options = field.lookupOptions || (field.options as ILinkFieldOptions);
        const { relationship, fkHostTableName, selfKeyName, foreignKeyName } = options;
        const query =
          relationship === Relationship.OneOne || relationship === Relationship.ManyOne
            ? this.knex.count(foreignKeyName, { as: 'count' }).from(fkHostTableName)
            : this.knex.countDistinct(selfKeyName, { as: 'count' }).from(fkHostTableName);

        return query.toQuery();
      } else {
        const dbTableName = fieldId2DbTableName[fieldId];
        return this.knex.count('*', { as: 'count' }).from(dbTableName).toQuery();
      }
    });
    // console.log('queries', queries);

    let total = 0;
    for (const query of queries) {
      const [{ count }] = await this.prismaService.$queryRawUnsafe<{ count: bigint }[]>(query);
      // console.log('count', count);
      total += Number(count);
    }
    return total;
  }

  @Timing()
  async planField(tableId: string, fieldId: string): Promise<IPlanFieldVo> {
    const field = await this.fieldService.getField(tableId, fieldId);
    const context = await this.getFullTopoOrdersContext(createFieldInstanceByVo(field));

    const {
      directedGraph,
      allFieldIds,
      fieldMap,
      fieldId2DbTableName,
      tableId2DbTableName,
      fieldId2TableId,
    } = context;

    const graph = await this.generateGraph({
      fieldId,
      directedGraph,
      allFieldIds,
      fieldMap,
      tableId2DbTableName,
      fieldId2TableId,
    });

    const updateCellCount = await this.affectedCellCount(
      fieldId,
      allFieldIds,
      fieldMap,
      fieldId2DbTableName
    );

    return {
      graph,
      updateCellCount,
      estimateTime: this.getEstimateTime(updateCellCount),
    };
  }

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
        crossBaseName: crossBase ? table.base.name : undefined,
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

    const referenceFieldIds = uniq(
      references.map((ref) => [ref.fromFieldId, ref.toFieldId]).flat()
    );

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
    fieldMap: Record<string, Pick<Field, 'id' | 'tableId' | 'name' | 'type' | 'isLookup'>>;
    crossBaseLinkFieldRaws: (Pick<Field, 'id' | 'name' | 'type' | 'tableId'> & {
      options: ILinkFieldOptions;
    })[];
    crossBaseTableMap: Record<string, Pick<TableMeta, 'id' | 'name' | 'icon'>>;
    crossBaseFieldMap: Record<string, Pick<Field, 'id' | 'tableId' | 'name' | 'type' | 'isLookup'>>;
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
      const fromTable = tableMap[fromField.tableId] ?? crossBaseTableMap[fromField.tableId];
      const toField = fieldMap[toFieldId] ?? crossBaseFieldMap[toFieldId];
      const toTable = tableMap[toField.tableId] ?? crossBaseTableMap[toField.tableId];

      const key = `${fromField.id}-${toField.id}`;
      const reverseKey = `${toField.id}-${fromField.id}`;
      if (fieldEdgeMap.has(key) || fieldEdgeMap.has(reverseKey)) {
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
