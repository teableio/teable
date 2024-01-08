import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import type { IFieldRo, ILinkFieldOptions, ITinyRecord, IUpdateFieldRo } from '@teable-group/core';
import { FieldType, Relationship } from '@teable-group/core';
import { PrismaService } from '@teable-group/db-main-prisma';
import type {
  IGraphEdge,
  IGraphNode,
  IGraphCombo,
  IGraphVo,
  IPlanFieldVo,
  IPlanFieldUpdateVo,
} from '@teable-group/openapi';
import { Knex } from 'knex';
import { groupBy, keyBy, uniq } from 'lodash';
import { InjectModel } from 'nest-knexjs';
import { Timing } from '../../utils/timing';
import { FieldCalculationService } from '../calculation/field-calculation.service';
import type { IGraphItem, IRecordItem } from '../calculation/reference.service';
import { ReferenceService } from '../calculation/reference.service';
import { pruneGraph, topoOrderWithStart } from '../calculation/utils/dfs';
import { FieldConvertingService } from '../field/field-calculate/field-converting.service';
import { FieldSupplementService } from '../field/field-calculate/field-supplement.service';
import { FieldService } from '../field/field.service';
import {
  createFieldInstanceByVo,
  type IFieldInstance,
  type IFieldMap,
} from '../field/model/factory';
import type { FormulaFieldDto } from '../field/model/field-dto/formula-field.dto';
import { RecordService } from '../record/record.service';

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

// eslint-disable-next-line @typescript-eslint/naming-convention
const ASYNC_THRESHOLD = 2000;

@Injectable()
export class GraphService {
  private logger = new Logger(GraphService.name);

  constructor(
    private readonly prismaService: PrismaService,
    private readonly recordService: RecordService,
    private readonly fieldService: FieldService,
    private readonly referenceService: ReferenceService,
    private readonly fieldSupplementService: FieldSupplementService,
    private readonly fieldCalculationService: FieldCalculationService,
    private readonly fieldConvertingService: FieldConvertingService,
    @InjectModel('CUSTOM_KNEX') private readonly knex: Knex
  ) {}

  private async getCellInfo(tableId: string, cell: [number, number], viewId?: string) {
    const [colIndex, rowIndex] = cell;
    if (!viewId) {
      const viewRaw = await this.prismaService.view.findFirstOrThrow({
        where: { tableId, deletedTime: null },
        orderBy: { order: 'asc' },
      });
      viewId = viewRaw.id;
    }
    const recordId = await this.recordService.getRecordIdByIndex(tableId, viewId, rowIndex);
    const fieldId = await this.fieldService.getFieldIdByIndex(tableId, viewId, colIndex);
    const cellValue = await this.recordService.getCellValue(tableId, recordId, fieldId);
    return { recordId, fieldId, cellValue };
  }

  private getLookupEdge(
    field: IFieldInstance,
    fieldMap: IFieldMap,
    record: IRecordItem
  ): IGraphEdge[] | undefined {
    if (record.dependencies) {
      let dependentField: IFieldInstance;
      if (field.lookupOptions) {
        dependentField = fieldMap[field.lookupOptions.lookupFieldId];
      } else if (field.type === FieldType.Link) {
        dependentField = fieldMap[field.options.lookupFieldId];
      } else {
        console.error('unsupported dependencies');
        return;
      }

      const depends = Array.isArray(record.dependencies)
        ? record.dependencies
        : [record.dependencies];
      return depends.map((dep) => {
        return {
          source: `${dependentField.id}_${dep.id}`,
          target: `${field.id}_${record.record.id}`,
          label: field.type,
        };
      });
    }
  }

  private getFormulaEdge(
    field: FormulaFieldDto,
    fieldMap: IFieldMap,
    record: IRecordItem
  ): IGraphEdge[] | undefined {
    const refIds = field.getReferenceFieldIds();
    return refIds.map((fieldId) => {
      const dependentField = fieldMap[fieldId];
      return {
        source: `${dependentField.id}_${record.record.id}`,
        target: `${field.id}_${record.record.id}`,
        label: field.type,
      };
    });
  }

  private getCellNodesAndCombos(
    fieldMap: IFieldMap,
    tableMap: { [dbTableName: string]: { dbTableName: string; name: string } },
    selectedCell: { recordId: string; fieldId: string },
    dbTableName2recordMap: { [dbTableName: string]: Record<string, ITinyRecord> }
  ) {
    const nodes: IGraphNode[] = [];
    const combos: IGraphCombo[] = [];
    Object.entries(dbTableName2recordMap).forEach(([dbTableName, recordMap]) => {
      combos.push({
        id: dbTableName,
        label: tableMap[dbTableName].name,
      });
      Object.values(recordMap).forEach((record) => {
        Object.entries(record.fields).forEach(([fieldId, cellValue]) => {
          const field = fieldMap[fieldId];
          nodes.push({
            id: `${field.id}_${record.id}`,
            label: field.cellValue2String(cellValue),
            comboId: dbTableName,
            fieldName: field.name,
            fieldType: field.type,
            isLookup: field.isLookup,
            isSelected: field.id === selectedCell.fieldId && record.id === selectedCell.recordId,
          });
        });
      });
    });
    return {
      nodes,
      combos,
    };
  }

  private async getTableMap(tableId2DbTableName: { [tableId: string]: string }) {
    const tableIds = Object.keys(tableId2DbTableName);
    const tableRaw = await this.prismaService.tableMeta.findMany({
      where: { id: { in: tableIds } },
      select: { dbTableName: true, name: true },
    });
    return keyBy(tableRaw, 'dbTableName');
  }

  async getGraph(tableId: string, cell: [number, number], viewId?: string): Promise<IGraphVo> {
    const { recordId, fieldId, cellValue } = await this.getCellInfo(tableId, cell, viewId);
    const prepared = await this.referenceService.prepareCalculation([
      { id: recordId, fieldId: fieldId, newValue: cellValue },
    ]);
    if (!prepared) {
      return;
    }
    const { orderWithRecordsByFieldId, fieldMap, dbTableName2recordMap, tableId2DbTableName } =
      prepared;
    const tableMap = await this.getTableMap(tableId2DbTableName);
    const orderWithRecords = orderWithRecordsByFieldId[fieldId];
    const { nodes, combos } = this.getCellNodesAndCombos(
      fieldMap,
      tableMap,
      { recordId, fieldId },
      dbTableName2recordMap
    );
    const edges = orderWithRecords.reduce<IGraphEdge[]>((pre, order) => {
      const field = fieldMap[order.id];
      Object.values(order.recordItemMap || {}).forEach((record) => {
        if (field.lookupOptions || field.type === FieldType.Link) {
          const lookupEdge = this.getLookupEdge(field, fieldMap, record);
          lookupEdge && pre.push(...lookupEdge);
          return;
        }

        if (field.type === FieldType.Formula) {
          const formulaEdge = this.getFormulaEdge(field, fieldMap, record);
          formulaEdge && pre.push(...formulaEdge);
        }
      });

      return pre;
    }, []);

    return {
      nodes,
      edges,
      combos,
    };
  }

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
    const updateCellCount = await this.affectedRecordCount(
      field.id,
      [field.id],
      { [field.id]: field },
      { [field.id]: tableMap[tableId].dbTableName }
    );

    return {
      isAsync: updateCellCount > ASYNC_THRESHOLD,
      graph: {
        nodes,
        edges,
        combos,
      },
      updateCellCount,
    };
  }

  private async getField(tableId: string, fieldId: string, fieldRo: IUpdateFieldRo) {
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

  async planFieldUpdate(
    tableId: string,
    fieldId: string,
    fieldRo: IUpdateFieldRo
  ): Promise<IPlanFieldUpdateVo> {
    const { oldField, newField } = await this.getField(tableId, fieldId, fieldRo);

    const majorChange = this.fieldConvertingService.majorKeysChanged(oldField, newField);
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

    const updateCellCount = await this.affectedRecordCount(
      fieldId,
      topoFieldIds,
      fieldMap,
      fieldId2DbTableName
    );

    return {
      isAsync: updateCellCount > ASYNC_THRESHOLD,
      graph,
      updateCellCount,
    };
  }

  private async affectedRecordCount(
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
            ? this.knex.count(foreignKeyName).from(fkHostTableName)
            : this.knex.countDistinct(selfKeyName).from(fkHostTableName);

        return query.toQuery();
      } else {
        const dbTableName = fieldId2DbTableName[fieldId];
        return this.knex.count('*').from(dbTableName).toQuery();
      }
    });

    let total = 0;
    for (const query of queries) {
      const [{ count }] = await this.prismaService.$queryRawUnsafe<{ count: bigint }[]>(query);
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

    const updateCellCount = await this.affectedRecordCount(
      fieldId,
      topoFieldIds,
      fieldMap,
      fieldId2DbTableName
    );

    return {
      isAsync: updateCellCount > ASYNC_THRESHOLD,
      graph,
      updateCellCount,
    };
  }
}
