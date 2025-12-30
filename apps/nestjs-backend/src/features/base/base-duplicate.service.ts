/* eslint-disable @typescript-eslint/naming-convention */
import { Injectable, Logger } from '@nestjs/common';
import type { ILinkFieldOptions } from '@teable/core';
import { FieldType } from '@teable/core';
import { PrismaService } from '@teable/db-main-prisma';
import {
  BaseDuplicateMode,
  CreateRecordAction,
  type ICreateBaseFromTemplateRo,
  type IDuplicateBaseRo,
} from '@teable/openapi';
import { Knex } from 'knex';
import { groupBy } from 'lodash';
import { InjectModel } from 'nest-knexjs';
import { ClsService } from 'nestjs-cls';
import { InjectDbProvider } from '../../db-provider/db.provider';
import { IDbProvider } from '../../db-provider/db.provider.interface';
import { EventEmitterService } from '../../event-emitter/event-emitter.service';
import { Events } from '../../event-emitter/events';
import type { IClsStore } from '../../types/cls';
import { createFieldInstanceByRaw } from '../field/model/factory';
import { ComputedOrchestratorService } from '../record/computed/services/computed-orchestrator.service';
import { TableDuplicateService } from '../table/table-duplicate.service';
import { BaseExportService } from './base-export.service';
import { BaseImportService } from './base-import.service';
import { mergeLinkFieldTableMaps } from './utils';

@Injectable()
export class BaseDuplicateService {
  private logger = new Logger(BaseDuplicateService.name);

  constructor(
    private readonly prismaService: PrismaService,
    private readonly tableDuplicateService: TableDuplicateService,
    private readonly baseExportService: BaseExportService,
    private readonly baseImportService: BaseImportService,
    @InjectDbProvider() private readonly dbProvider: IDbProvider,
    @InjectModel('CUSTOM_KNEX') private readonly knex: Knex,
    private readonly computedOrchestrator: ComputedOrchestratorService,
    private readonly cls: ClsService<IClsStore>,
    private readonly eventEmitterService: EventEmitterService
  ) {}

  async duplicateBase(
    duplicateBaseRo: IDuplicateBaseRo,
    allowCrossBase: boolean = true,
    duplicateMode: BaseDuplicateMode = BaseDuplicateMode.Normal
  ) {
    const { fromBaseId, spaceId, withRecords, name, baseId, nodes } = duplicateBaseRo;

    const { base, tableIdMap, fieldIdMap, viewIdMap, ...rest } = await this.duplicateStructure(
      fromBaseId,
      spaceId,
      name,
      allowCrossBase,
      baseId,
      nodes,
      duplicateMode
    );

    const crossBaseLinkFieldTableMap = allowCrossBase
      ? ({} as Record<
          string,
          {
            dbFieldName: string;
            selfKeyName: string;
            isMultipleCellValue: boolean;
          }[]
        >)
      : await this.getCrossBaseLinkFieldTableMap(tableIdMap);

    const disconnectedLinkFieldTableMap = await this.getDisconnectedLinkFieldTableMap(
      tableIdMap,
      fromBaseId,
      nodes
    );

    const mergedLinkFieldTableMap = mergeLinkFieldTableMaps(
      crossBaseLinkFieldTableMap,
      disconnectedLinkFieldTableMap
    );

    const disconnectedLinkFieldIds = await this.getDisconnectedLinkFieldIds(
      tableIdMap,
      fromBaseId,
      nodes
    );

    let recordsLength = 0;
    if (withRecords) {
      recordsLength = await this.duplicateTableData(
        tableIdMap,
        fieldIdMap,
        viewIdMap,
        mergedLinkFieldTableMap
      );
      await this.duplicateAttachments(tableIdMap, fieldIdMap);
      await this.duplicateLinkJunction(
        tableIdMap,
        fieldIdMap,
        allowCrossBase,
        disconnectedLinkFieldIds
      );

      // Persist computed/link/lookup/rollup columns for duplicated data so that
      // reads via useQueryModel (tableCache/raw table) return correct values.
      // This mirrors what the computed pipeline does during regular record writes.
      await this.recomputeComputedColumnsForDuplicatedBase(tableIdMap);
    }

    return { base, tableIdMap, fieldIdMap, viewIdMap, recordsLength, ...rest };
  }

  private async getDisconnectedLinkFieldIds(
    tableIdMap: Record<string, string>,
    fromBaseId: string,
    nodes?: string[]
  ) {
    const { excludedTableIds } = await this.collectNodesAndResourceIds(fromBaseId, nodes);
    if (!excludedTableIds?.length) {
      return [];
    }

    const prisma = this.prismaService.txClient();
    const allFieldRaws = await prisma.field.findMany({
      where: {
        tableId: { in: Object.keys(tableIdMap) },
        deletedTime: null,
      },
    });

    const fields = allFieldRaws.map((f) => createFieldInstanceByRaw(f));

    return fields
      .filter(({ type, isLookup }) => type === FieldType.Link && !isLookup)
      .filter((f) => excludedTableIds.includes((f.options as ILinkFieldOptions)?.foreignTableId))
      .map((f) => f.id);
  }

  private async duplicateStructure(
    fromBaseId: string,
    spaceId: string,
    baseName?: string,
    allowCrossBase?: boolean,
    baseId?: string,
    nodes?: string[],
    duplicateMode: BaseDuplicateMode = BaseDuplicateMode.Normal
  ) {
    const prisma = this.prismaService.txClient();
    const baseRaw = await prisma.base.findUniqueOrThrow({
      where: {
        id: fromBaseId,
        deletedTime: null,
      },
    });
    baseRaw.name = baseName || `${baseRaw.name} (Copy)`;

    // Get included table IDs if includeNodes is provided
    const {
      finalIncludeNodes,
      includedTableIds,
      includedFolderIds,
      includedDashboardIds,
      includedWorkflowIds,
      includedAppIds,
      excludedTableIds,
    } = await this.collectNodesAndResourceIds(fromBaseId, nodes);

    const tableRaws = await prisma.tableMeta.findMany({
      where: {
        baseId: fromBaseId,
        deletedTime: null,
        ...(includedTableIds !== undefined ? { id: { in: includedTableIds } } : {}),
      },
      orderBy: {
        order: 'asc',
      },
    });
    const tableIds = tableRaws.map(({ id }) => id);
    const fieldRaws = await prisma.field.findMany({
      where: {
        tableId: {
          in: tableIds,
        },
        deletedTime: null,
      },
    });
    const viewRaws = await prisma.view.findMany({
      where: {
        tableId: {
          in: tableIds,
        },
        deletedTime: null,
      },
      orderBy: {
        order: 'asc',
      },
    });

    const structure = await this.baseExportService.generateBaseStructConfig({
      baseRaw,
      tableRaws,
      fieldRaws,
      viewRaws,
      allowCrossBase,
      includeNodes: finalIncludeNodes,
      includedFolderIds,
      includedDashboardIds,
      includedWorkflowIds,
      includedAppIds,
      excludedTableIds,
    });

    this.logger.log(`base-duplicate-service: Start to getting base structure config successfully`);

    const {
      base: newBase,
      tableIdMap,
      fieldIdMap,
      viewIdMap,
      ...rest
    } = await this.baseImportService.createBaseStructure(
      spaceId,
      structure,
      baseId,
      undefined,
      duplicateMode
    );

    return { base: newBase, tableIdMap, fieldIdMap, viewIdMap, ...rest };
  }

  /**
   * Collect nodes and their resource IDs by type
   * This method processes the selected nodes and collects all their parent nodes
   * Then extracts resource IDs grouped by resource type
   */
  private async collectNodesAndResourceIds(fromBaseId: string, nodes: string[] | undefined) {
    const prisma = this.prismaService.txClient();
    let includedTableIds: string[] | undefined;
    let includedFolderIds: string[] | undefined;
    let includedDashboardIds: string[] | undefined;
    let includedWorkflowIds: string[] | undefined;
    let includedAppIds: string[] | undefined;
    let finalIncludeNodes: string[] | undefined;

    let excludedTableIds: string[] | undefined;
    let excludedFolderIds: string[] | undefined;
    let excludedDashboardIds: string[] | undefined;
    let excludedWorkflowIds: string[] | undefined;
    let excludedAppIds: string[] | undefined;

    if (nodes && nodes.length > 0) {
      // Get all nodes in the base to build parent-child relationships
      const allNodes = await prisma.baseNode.findMany({
        where: {
          baseId: fromBaseId,
        },
        select: {
          id: true,
          parentId: true,
          resourceId: true,
          resourceType: true,
        },
      });

      // Build a map for quick lookup
      const nodeMap = new Map(allNodes.map((node) => [node.id, node]));

      // Function to recursively collect parent nodes
      const collectParentNodes = (nodeId: string, collected: Set<string>) => {
        if (collected.has(nodeId)) return;
        collected.add(nodeId);

        const node = nodeMap.get(nodeId);
        if (node?.parentId) {
          collectParentNodes(node.parentId, collected);
        }
      };

      // Collect selected nodes and all their parent nodes
      const allIncludedNodeIds = new Set<string>();
      for (const nodeId of nodes) {
        collectParentNodes(nodeId, allIncludedNodeIds);
      }

      finalIncludeNodes = Array.from(allIncludedNodeIds);

      // Extract resource IDs by type
      const includedNodeDetails = allNodes.filter((node) => allIncludedNodeIds.has(node.id));

      includedTableIds = includedNodeDetails
        .filter((node) => node.resourceType === 'table')
        .map((node) => node.resourceId);

      includedFolderIds = includedNodeDetails
        .filter((node) => node.resourceType === 'folder')
        .map((node) => node.resourceId);

      includedDashboardIds = includedNodeDetails
        .filter((node) => node.resourceType === 'dashboard')
        .map((node) => node.resourceId);

      includedWorkflowIds = includedNodeDetails
        .filter((node) => node.resourceType === 'workflow')
        .map((node) => node.resourceId);

      includedAppIds = includedNodeDetails
        .filter((node) => node.resourceType === 'app')
        .map((node) => node.resourceId);

      excludedTableIds = allNodes
        .filter((node) => !allIncludedNodeIds.has(node.id))
        .map((node) => node.resourceId);
      excludedFolderIds = allNodes
        .filter((node) => !allIncludedNodeIds.has(node.id))
        .map((node) => node.resourceId);
      excludedDashboardIds = allNodes
        .filter((node) => !allIncludedNodeIds.has(node.id))
        .map((node) => node.resourceId);
      excludedWorkflowIds = allNodes
        .filter((node) => !allIncludedNodeIds.has(node.id))
        .map((node) => node.resourceId);
      excludedAppIds = allNodes
        .filter((node) => !allIncludedNodeIds.has(node.id))
        .map((node) => node.resourceId);
    }

    return {
      finalIncludeNodes,
      includedTableIds,
      includedFolderIds,
      includedDashboardIds,
      includedWorkflowIds,
      includedAppIds,

      excludedTableIds,
      excludedFolderIds,
      excludedDashboardIds,
      excludedWorkflowIds,
      excludedAppIds,
    };
  }

  private async getDisconnectedLinkFieldTableMap(
    tableIdMap: Record<string, string>,
    fromBaseId: string,
    nodes?: string[]
  ) {
    const tableId2DbFieldNameMap: Record<
      string,
      { dbFieldName: string; selfKeyName: string; isMultipleCellValue: boolean }[]
    > = {};
    const { excludedTableIds } = await this.collectNodesAndResourceIds(fromBaseId, nodes);

    if (!nodes?.length || !excludedTableIds?.length) {
      return tableId2DbFieldNameMap;
    }

    const prisma = this.prismaService.txClient();
    const allFieldRaws = await prisma.field.findMany({
      where: {
        tableId: { in: Object.keys(tableIdMap) },
        deletedTime: null,
      },
    });

    const disconnectedLinkFields = allFieldRaws
      .filter(({ type, isLookup }) => type === FieldType.Link && !isLookup)
      .map((f) => ({ ...createFieldInstanceByRaw(f), tableId: f.tableId }))
      .filter((f) => excludedTableIds.includes((f.options as ILinkFieldOptions)?.foreignTableId));

    // relative fields
    // const disconnectedLinkRelativeFields = allFieldRaws
    //   .map((f) => ({ ...createFieldInstanceByRaw(f), tableId: f.tableId }))
    //   .filter(
    //     ({ type, isLookup }) =>
    //       isLookup || type === FieldType.Rollup || type === FieldType.ConditionalRollup
    //   )
    //   .filter(({ lookupOptions }) => {
    //     if (!lookupOptions || !isLinkLookupOptions(lookupOptions)) {
    //       return false;
    //     }
    //     return disconnectedLinkFields.map(({ id }) => id).includes(lookupOptions.linkFieldId);
    //   });

    const groupedDisconnectedLinkFields = groupBy([...disconnectedLinkFields], 'tableId');

    Object.entries(groupedDisconnectedLinkFields).map(([tableId, fields]) => {
      tableId2DbFieldNameMap[tableId] = fields.map(
        ({ dbFieldName, options, isMultipleCellValue }) => {
          return {
            dbFieldName,
            selfKeyName: (options as ILinkFieldOptions).selfKeyName,
            isMultipleCellValue: !!isMultipleCellValue,
          };
        }
      );

      tableId2DbFieldNameMap[tableIdMap[tableId]] = fields.map(
        ({ dbFieldName, options, isMultipleCellValue }) => {
          return {
            dbFieldName,
            selfKeyName: (options as ILinkFieldOptions).selfKeyName,
            isMultipleCellValue: !!isMultipleCellValue,
          };
        }
      );

      return {
        tableId2DbFieldNameMap,
      };
    });

    return tableId2DbFieldNameMap;
  }

  private async getCrossBaseLinkFieldTableMap(tableIdMap: Record<string, string>) {
    const tableId2DbFieldNameMap: Record<
      string,
      { dbFieldName: string; selfKeyName: string; isMultipleCellValue: boolean }[]
    > = {};
    const prisma = this.prismaService.txClient();
    const allFieldRaws = await prisma.field.findMany({
      where: {
        tableId: { in: Object.keys(tableIdMap) },
        deletedTime: null,
      },
    });

    const crossBaseLinkFields = allFieldRaws
      .filter(({ type, isLookup }) => type === FieldType.Link && !isLookup)
      .map((f) => ({ ...createFieldInstanceByRaw(f), tableId: f.tableId }))
      .filter((f) => (f.options as ILinkFieldOptions).baseId);

    const groupedCrossBaseLinkFields = groupBy(crossBaseLinkFields, 'tableId');

    Object.entries(groupedCrossBaseLinkFields).map(([tableId, fields]) => {
      tableId2DbFieldNameMap[tableId] = fields.map(
        ({ dbFieldName, options, isMultipleCellValue }) => {
          return {
            dbFieldName,
            selfKeyName: (options as ILinkFieldOptions).selfKeyName,
            isMultipleCellValue: !!isMultipleCellValue,
          };
        }
      );
      tableId2DbFieldNameMap[tableIdMap[tableId]] = fields.map(
        ({ dbFieldName, options, isMultipleCellValue }) => {
          return {
            dbFieldName,
            selfKeyName: (options as ILinkFieldOptions).selfKeyName,
            isMultipleCellValue: !!isMultipleCellValue,
          };
        }
      );
    });

    return tableId2DbFieldNameMap;
  }

  private async duplicateTableData(
    tableIdMap: Record<string, string>,
    fieldIdMap: Record<string, string>,
    viewIdMap: Record<string, string>,
    crossBaseLinkFieldTableMap: Record<
      string,
      { dbFieldName: string; selfKeyName: string; isMultipleCellValue: boolean }[]
    >
  ): Promise<number> {
    const prisma = this.prismaService.txClient();
    const tableId2DbTableNameMap: Record<string, string> = {};
    const allTableId = Object.keys(tableIdMap).concat(Object.values(tableIdMap));
    const sourceTableRaws = await prisma.tableMeta.findMany({
      where: { id: { in: allTableId }, deletedTime: null },
      select: {
        id: true,
        dbTableName: true,
      },
    });
    const targetTableRaws = await prisma.tableMeta.findMany({
      where: { id: { in: allTableId }, deletedTime: null },
      select: {
        id: true,
        dbTableName: true,
      },
    });
    sourceTableRaws.forEach((tableRaw) => {
      tableId2DbTableNameMap[tableRaw.id] = tableRaw.dbTableName;
    });

    const oldTableId = Object.keys(tableIdMap);

    const dbTableNames = targetTableRaws.map((tableRaw) => tableRaw.dbTableName);

    // Query total records count from all source tables before duplicating
    let totalRecordsCount = 0;
    for (const tableId of oldTableId) {
      const sourceDbTableName = tableId2DbTableNameMap[tableId];
      const countQuery = this.knex(sourceDbTableName).count('*', { as: 'count' }).toQuery();
      const countResult = await prisma.$queryRawUnsafe<[{ count: bigint | number }]>(countQuery);
      totalRecordsCount += Number(countResult[0]?.count || 0);
    }

    const allForeignKeyInfos = [] as {
      constraint_name: string;
      column_name: string;
      referenced_table_schema: string;
      referenced_table_name: string;
      referenced_column_name: string;
      dbTableName: string;
    }[];

    // delete foreign keys if(exist) then duplicate table data
    for (const dbTableName of dbTableNames) {
      const foreignKeysInfoSql = this.dbProvider.getForeignKeysInfo(dbTableName);
      const foreignKeysInfo = await this.prismaService.txClient().$queryRawUnsafe<
        {
          constraint_name: string;
          column_name: string;
          referenced_table_schema: string;
          referenced_table_name: string;
          referenced_column_name: string;
        }[]
      >(foreignKeysInfoSql);
      const newForeignKeyInfos = foreignKeysInfo.map((info) => ({
        ...info,
        dbTableName,
      }));
      allForeignKeyInfos.push(...newForeignKeyInfos);
    }

    for (const { constraint_name, column_name, dbTableName } of allForeignKeyInfos) {
      const dropForeignKeyQuery = this.knex.schema
        .alterTable(dbTableName, (table) => {
          table.dropForeign(column_name, constraint_name);
        })
        .toQuery();

      await prisma.$executeRawUnsafe(dropForeignKeyQuery);
    }

    for (const tableId of oldTableId) {
      const newTableId = tableIdMap[tableId];
      const oldDbTableName = tableId2DbTableNameMap[tableId];
      const newDbTableName = tableId2DbTableNameMap[newTableId];
      try {
        await this.tableDuplicateService.duplicateTableData(
          oldDbTableName,
          newDbTableName,
          viewIdMap,
          fieldIdMap,
          crossBaseLinkFieldTableMap[tableId] || []
        );
      } catch (error) {
        this.logger.error(
          `exc duplicate table data error: ${(error as Error)?.message}`,
          (error as Error)?.stack
        );
        throw error;
      }
    }

    for (const {
      constraint_name: constraintName,
      column_name: columnName,
      referenced_table_schema: referencedTableSchema,
      referenced_table_name: referencedTableName,
      referenced_column_name: referencedColumnName,
      dbTableName,
    } of allForeignKeyInfos) {
      const addForeignKeyQuerySql = this.knex.schema
        .alterTable(dbTableName, (table) => {
          table
            .foreign(columnName, constraintName)
            .references(referencedColumnName)
            .inTable(`${referencedTableSchema}.${referencedTableName}`);
        })
        .toQuery();

      await prisma.$executeRawUnsafe(addForeignKeyQuerySql);
    }

    return totalRecordsCount;
  }

  private async duplicateAttachments(
    tableIdMap: Record<string, string>,
    fieldIdMap: Record<string, string>
  ) {
    for (const [sourceTableId, targetTableId] of Object.entries(tableIdMap)) {
      await this.tableDuplicateService.duplicateAttachments(
        sourceTableId,
        targetTableId,
        fieldIdMap
      );
    }
  }

  private async duplicateLinkJunction(
    tableIdMap: Record<string, string>,
    fieldIdMap: Record<string, string>,
    allowCrossBase: boolean = true,
    disconnectedLinkFieldIds?: string[]
  ) {
    await this.tableDuplicateService.duplicateLinkJunction(
      tableIdMap,
      fieldIdMap,
      allowCrossBase,
      disconnectedLinkFieldIds
    );
  }

  /**
   * After duplicating raw table rows and link junctions, recompute and persist
   * values for computed fields (Lookup/Rollup/Formula when persisted) and Link
   * display columns on all duplicated tables. This ensures immediate consistency
   * when reading via table cache or raw table without CTEs (useQueryModel=true).
   */
  private async recomputeComputedColumnsForDuplicatedBase(tableIdMap: Record<string, string>) {
    const prisma = this.prismaService.txClient();
    const targetTableIds = Object.values(tableIdMap);
    if (!targetTableIds.length) return;

    // Collect candidate fields on the duplicated tables: include link fields and
    // any computed fields so their values are (re)materialized into physical columns.
    const fields = await prisma.field.findMany({
      where: {
        tableId: { in: targetTableIds },
        deletedTime: null,
      },
      select: { id: true, tableId: true, type: true, isLookup: true, isComputed: true },
    });

    // Group by table and select fields that should be persisted via updateFromSelect
    const byTable = new Map<string, string[]>();
    for (const f of fields) {
      // Link fields (non-lookup) have persisted display JSON; include them
      const isLink = f.type === FieldType.Link && !f.isLookup;
      // Computed fields (lookup/rollup/formula-not-generated) are marked isComputed
      const isComputed = !!f.isComputed;
      if (!isLink && !isComputed) continue;
      const list = byTable.get(f.tableId) || [];
      list.push(f.id);
      byTable.set(f.tableId, list);
    }

    if (!byTable.size) return;

    const sources = Array.from(byTable.entries()).map(([tableId, fieldIds]) => ({
      tableId,
      fieldIds,
    }));

    // No-op update; we only want to evaluate and persist computed values.
    await this.computedOrchestrator.computeCellChangesForFieldsAfterCreate(sources, async () => {
      return;
    });
  }

  async emitBaseDuplicateAuditLog(baseId: string, recordsLength?: number) {
    const userId = this.cls.get('user.id');
    const origin = this.cls.get('origin');

    await this.cls.run(async () => {
      this.cls.set('origin', origin!);
      this.cls.set('user.id', userId!);
      await this.eventEmitterService.emitAsync(Events.TABLE_RECORD_CREATE_RELATIVE, {
        action: CreateRecordAction.BaseDuplicate,
        resourceId: baseId,
        recordCount: recordsLength,
      });
    });
  }

  async emitBaseTemplateApplyAuditLog(
    baseId: string,
    templateApplyRo: ICreateBaseFromTemplateRo,
    recordsLength?: number
  ) {
    const userId = this.cls.get('user.id');
    const origin = this.cls.get('origin');

    await this.cls.run(async () => {
      this.cls.set('origin', origin!);
      this.cls.set('user.id', userId!);
      await this.eventEmitterService.emitAsync(Events.TABLE_RECORD_CREATE_RELATIVE, {
        action: CreateRecordAction.TemplateApply,
        resourceId: baseId,
        recordCount: recordsLength,
      });
    });
  }
}
