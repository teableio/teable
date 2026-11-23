import { Injectable, Logger } from '@nestjs/common';
import type { IFieldRo, ILinkFieldOptions, IConvertFieldRo } from '@teable/core';
import { FieldType, Relationship, isLinkLookupOptions } from '@teable/core';
import { PrismaService } from '@teable/db-main-prisma';
import type {
  IGraphEdge,
  IGraphNode,
  IGraphCombo,
  IPlanFieldVo,
  IPlanFieldConvertVo,
  IPlanFieldDeleteVo,
} from '@teable/openapi';
import { Knex } from 'knex';
import { groupBy, keyBy } from 'lodash';
import { InjectModel } from 'nest-knexjs';
import { IThresholdConfig, ThresholdConfig } from '../../configs/threshold.config';
import { DatabaseRouter } from '../../global/database-router.service';
import { DATA_KNEX } from '../../global/knex/knex.module';
import { V1EngineService } from '../../tracing/decorators/v1-engine';
import { majorFieldKeysChanged } from '../../utils/major-field-keys-changed';
import { Timing } from '../../utils/timing';
import { FieldCalculationService } from '../calculation/field-calculation.service';
import { ReferenceService } from '../calculation/reference.service';
import type { IGraphItem } from '../calculation/utils/dfs';
import { pruneGraph, topoOrderWithStart } from '../calculation/utils/dfs';
import { FieldConvertingLinkService } from '../field/field-calculate/field-converting-link.service';
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
  isConditionalLookup?: boolean | null;
}

interface ITinyTable {
  id: string;
  name: string;
  dbTableName: string;
}

interface IAffectedCountQuery {
  fieldId: string;
  fieldName: string;
  query: string;
}

@Injectable()
@V1EngineService(['planFieldCreate', 'planFieldConvert', 'planDeleteField', 'planField'])
export class GraphService {
  private readonly logger = new Logger(GraphService.name);

  constructor(
    private readonly prismaService: PrismaService,
    private readonly databaseRouter: DatabaseRouter,
    private readonly fieldService: FieldService,
    private readonly referenceService: ReferenceService,
    private readonly fieldSupplementService: FieldSupplementService,
    private readonly fieldCalculationService: FieldCalculationService,
    private readonly fieldConvertingLinkService: FieldConvertingLinkService,
    @InjectModel(DATA_KNEX) private readonly knex: Knex,
    @ThresholdConfig() private readonly thresholdConfig: IThresholdConfig
  ) {}

  private getFieldNodesAndCombos(
    fieldId: string,
    fieldRawsMap: Record<string, ITinyField[]>,
    tableRaws: ITinyTable[],
    allowedNodeIds?: Set<string>
  ) {
    const nodes: IGraphNode[] = [];
    const combos: IGraphCombo[] = [];
    tableRaws.forEach(({ id: tableId, name: tableName }) => {
      combos.push({
        id: tableId,
        label: tableName,
      });
      fieldRawsMap[tableId].forEach((field) => {
        if (!allowedNodeIds || allowedNodeIds.has(field.id)) {
          nodes.push({
            id: field.id,
            label: field.name,
            comboId: tableId,
            fieldType: field.type,
            isLookup: field.isLookup,
            isConditionalLookup: field.isConditionalLookup,
            isSelected: field.id === fieldId,
          });
        }
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
    const allFieldIds = [
      ...new Set(directedGraph.flatMap((item) => [item.fromFieldId, item.toFieldId])),
    ];
    const fieldRaws = await this.prismaService.field.findMany({
      where: { id: { in: allFieldIds } },
      select: {
        id: true,
        name: true,
        type: true,
        isLookup: true,
        isConditionalLookup: true,
        tableId: true,
      },
    });

    fieldRaws.push({
      id: field.id,
      name: field.name,
      type: field.type,
      isLookup: field.isLookup || null,
      isConditionalLookup: field.isConditionalLookup || null,
      tableId,
    });

    const tableRaws = await this.prismaService.tableMeta.findMany({
      where: { id: { in: [...new Set(fieldRaws.map((item) => item.tableId))] } },
      select: { id: true, name: true, dbTableName: true },
    });

    const tableMap = keyBy(tableRaws, 'id');
    const fieldMap = keyBy(fieldRaws, 'id');

    const fieldRawsMap = groupBy(fieldRaws, 'tableId');

    // Normalize edges for display: dedupe and hide link -> lookup edge
    const seen = new Set<string>();
    const filteredGraph = directedGraph.filter(({ fromFieldId, toFieldId }) => {
      // Hide the link -> lookup edge for readability in graph
      const lookupOptions = field.lookupOptions;
      if (
        toFieldId === field.id &&
        lookupOptions &&
        isLinkLookupOptions(lookupOptions) &&
        fromFieldId === lookupOptions.linkFieldId
      ) {
        return false;
      }
      const key = `${fromFieldId}->${toFieldId}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    const edges = filteredGraph.map<IGraphEdge>((node) => {
      const f = fieldMap[node.toFieldId];
      return {
        source: node.fromFieldId,
        target: node.toFieldId,
        label: f.isLookup ? 'lookup' : f.type,
      };
    }, []);

    // Only include nodes that appear in edges, plus the host field
    const nodeIds = new Set<string>([field.id]);
    for (const e of filteredGraph) {
      nodeIds.add(e.fromFieldId);
      nodeIds.add(e.toFieldId);
    }
    const { nodes, combos } = this.getFieldNodesAndCombos(
      field.id,
      fieldRawsMap,
      tableRaws,
      nodeIds
    );
    const updateCellCount = await this.affectedCellCount(
      field.id,
      [field.id],
      { [field.id]: field },
      { [field.id]: tableMap[tableId].dbTableName },
      { [field.id]: tableId }
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
          ...suplimentLookupRefernce.map((f) => ({ fromFieldId: field.id, toFieldId: f.id })),
          { fromFieldId: field.id, toFieldId: field.options.symmetricFieldId }
        );
      }
    }

    const context = await this.fieldCalculationService.getTopoOrdersContext(
      oldRefernce,
      directedGraph
    );
    return {
      ...context,
      allFieldIds: [
        ...new Set([...context.allFieldIds, ...lookupGraph.map((item) => item.toFieldId)]),
      ],
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

    // 1) Dedupe edges and hide link -> lookup edge for display
    const edgeSeen = new Set<string>();
    const filtered = directedGraph.filter(({ fromFieldId, toFieldId }) => {
      const to = fieldMap[toFieldId];
      const lookupOptions = to?.lookupOptions;
      if (
        lookupOptions &&
        isLinkLookupOptions(lookupOptions) &&
        fromFieldId === lookupOptions.linkFieldId
      ) {
        // Hide the link field as a dependency in the display graph
        return false;
      }
      const key = `${fromFieldId}->${toFieldId}`;
      if (edgeSeen.has(key)) return false;
      edgeSeen.add(key);
      return true;
    });

    const edges = filtered.map<IGraphEdge>((node) => {
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

    // Nodes: from filtered edges plus ensure host field is present
    const nodeIdSet = new Set<string>([fieldId]);
    for (const e of filtered) {
      nodeIdSet.add(e.fromFieldId);
      nodeIdSet.add(e.toFieldId);
    }
    const nodes = Array.from(nodeIdSet).map<IGraphNode>((id) => {
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
      fieldId2DbTableName,
      fieldId2TableId
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
    fieldId2DbTableName: Record<string, string>,
    fieldId2TableId: Record<string, string>
  ): Promise<number> {
    const queries = fieldIds
      .map((fieldId) =>
        this.buildAffectedCountQuery(hostFieldId, fieldId, fieldMap, fieldId2DbTableName)
      )
      .filter((query): query is IAffectedCountQuery => query != null);

    let total = 0;
    for (const { fieldId, fieldName, query } of queries) {
      try {
        const tableId = fieldId2TableId[fieldId];
        if (!tableId) {
          this.logger.warn(
            `Skip affected cell count for field=${fieldId} name="${fieldName}" because table id is missing`
          );
          continue;
        }
        const [{ count }] = await this.databaseRouter.queryDataPrismaForTable<{ count: bigint }[]>(
          tableId,
          query
        );
        total += Number(count);
      } catch (error) {
        if (this.shouldSkipAffectedCountError(error)) {
          this.logger.warn(
            `Skip affected cell count for field=${fieldId} name="${fieldName}" due to broken storage: ${
              error.meta?.message || error.message
            }`
          );
          continue;
        }
        throw error;
      }
    }
    return total;
  }

  private buildAffectedCountQuery(
    hostFieldId: string,
    fieldId: string,
    fieldMap: IFieldMap,
    fieldId2DbTableName: Record<string, string>
  ): IAffectedCountQuery | null {
    const field = fieldMap[fieldId];

    if (!field) {
      this.logger.warn(`Skip affected cell count for missing field metadata: ${fieldId}`);
      return null;
    }

    const lookupOptions = field.lookupOptions;

    if (field.id !== hostFieldId) {
      if (field.type === FieldType.Link) {
        return this.buildLinkAffectedCountQuery(
          field.id,
          field.name,
          field.options as ILinkFieldOptions
        );
      }

      if (lookupOptions && isLinkLookupOptions(lookupOptions)) {
        return this.buildLinkAffectedCountQuery(field.id, field.name, lookupOptions);
      }
    }

    const dbTableName = fieldId2DbTableName[fieldId];
    if (!dbTableName) {
      this.logger.warn(
        `Skip affected cell count for field=${fieldId} name="${field.name}" because db table name is missing`
      );
      return null;
    }

    return {
      fieldId,
      fieldName: field.name,
      query: this.knex.count('*', { as: 'count' }).from(dbTableName).toQuery(),
    };
  }

  private buildLinkAffectedCountQuery(
    fieldId: string,
    fieldName: string,
    options: Pick<
      ILinkFieldOptions,
      'relationship' | 'fkHostTableName' | 'selfKeyName' | 'foreignKeyName'
    >
  ): IAffectedCountQuery | null {
    const { relationship, fkHostTableName, selfKeyName, foreignKeyName } = options;

    if (!fkHostTableName || !foreignKeyName) {
      this.logger.warn(
        `Skip affected cell count for field=${fieldId} name="${fieldName}" because link storage metadata is incomplete`
      );
      return null;
    }

    if (
      relationship !== Relationship.OneOne &&
      relationship !== Relationship.ManyOne &&
      !selfKeyName
    ) {
      this.logger.warn(
        `Skip affected cell count for field=${fieldId} name="${fieldName}" because link key metadata is incomplete`
      );
      return null;
    }

    const query =
      relationship === Relationship.OneOne || relationship === Relationship.ManyOne
        ? this.knex.count(foreignKeyName, { as: 'count' }).from(fkHostTableName)
        : this.knex.countDistinct(selfKeyName as string, { as: 'count' }).from(fkHostTableName);

    return {
      fieldId,
      fieldName,
      query: query.toQuery(),
    };
  }

  private shouldSkipAffectedCountError(error: unknown): error is {
    meta?: { code?: string; message?: string };
    message?: string;
  } {
    const prismaError = error as { code?: string; meta?: { code?: string } } | undefined;
    if (prismaError?.code !== 'P2010') {
      return false;
    }

    const storageErrorCode = prismaError.meta?.code;
    return storageErrorCode === '42703' || storageErrorCode === '42P01';
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
      fieldId2DbTableName,
      fieldId2TableId
    );

    return {
      graph,
      updateCellCount,
      estimateTime: this.getEstimateTime(updateCellCount),
    };
  }
}
