import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import type { IFieldRo, ILinkFieldOptions, IConvertFieldRo } from '@teable/core';
import { FieldType, Relationship } from '@teable/core';
import { PrismaService } from '@teable/db-main-prisma';
import type {
  IGraphEdge,
  IGraphNode,
  IGraphCombo,
  IPlanFieldVo,
  IPlanFieldConvertVo,
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

    return {
      graph: {
        nodes,
        edges,
        combos,
      },
      updateCellCount,
      estimateTime: this.getEstimateTime(updateCellCount),
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

    const context = await this.fieldCalculationService.getTopoOrdersContext(
      [fieldId],
      newDirectedGraph
    );
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

    return {
      graph,
      updateCellCount,
      estimateTime: this.getEstimateTime(updateCellCount),
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
    const context = await this.fieldCalculationService.getTopoOrdersContext([fieldId]);

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

    return {
      graph,
      updateCellCount,
      estimateTime: this.getEstimateTime(updateCellCount),
    };
  }
}
