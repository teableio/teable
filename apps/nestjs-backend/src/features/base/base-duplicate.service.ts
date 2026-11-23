import { Injectable, Logger } from '@nestjs/common';
import type { IDateFieldOptions, ILinkFieldOptions } from '@teable/core';
import { FieldType, HttpErrorCode } from '@teable/core';
import { PrismaService, ProvisionState } from '@teable/db-main-prisma';
import { BaseDuplicateMode, type IDuplicateBaseRo } from '@teable/openapi';
import { isValidTimeZone, type DuplicateBaseSource } from '@teable/v2-core';
import { Knex } from 'knex';
import { groupBy } from 'lodash';
import { InjectModel } from 'nest-knexjs';
import { ClsService } from 'nestjs-cls';
import { IThresholdConfig, ThresholdConfig } from '../../configs/threshold.config';
import { CustomHttpException } from '../../custom.exception';
import { InjectDbProvider } from '../../db-provider/db.provider';
import { IDbProvider } from '../../db-provider/db.provider.interface';
import { toPostgresFkDeleteAction } from '../../db-provider/postgres-fk-delete-action';
import { DataDbClientManager } from '../../global/data-db-client-manager.service';
import { DATA_KNEX } from '../../global/knex/knex.module';
import { V1Engine } from '../../tracing/decorators/v1-engine';
import type { IClsStore } from '../../types/cls';
import { baseDisplayName } from '../../utils/base-name';
import { AuditScope } from '../audit/audit-scope';
import { createFieldInstanceByRaw } from '../field/model/factory';
import { PersistedComputedBackfillService } from '../record/computed/services/persisted-computed-backfill.service';
import { TableDuplicateService } from '../table/table-duplicate.service';
import { BaseExportService } from './base-export.service';
import type { BaseImportProgressCallback } from './base-import-contract';
import { BaseImportService } from './base-import.service';
import { isCrossSpaceReferenceAllowed } from './cross-space-detection.util';
import { adaptStructureTimeZone, mergeLinkFieldTableMaps } from './utils';
import type { ILinkFieldTableInfo, ILinkFieldTableMap } from './utils';

type DuplicatedBase = Awaited<ReturnType<BaseImportService['createBaseStructure']>>['base'];

const v2DuplicateCopyBatchSize = 500;

type DuplicateStructureConfig = Awaited<ReturnType<BaseExportService['generateBaseStructConfig']>>;

type IDataPrismaExecutor = {
  $executeRawUnsafe(query: string, ...values: unknown[]): Promise<number>;
  $queryRawUnsafe<T = unknown>(query: string, ...values: unknown[]): Promise<T>;
};

type IDataPrismaScopedClient = IDataPrismaExecutor & {
  txClient?: () => IDataPrismaExecutor;
};

const toLinkFieldTableInfo = ({
  dbFieldName,
  options,
  isMultipleCellValue,
}: {
  dbFieldName: string;
  options?: unknown;
  isMultipleCellValue?: boolean | null;
}): ILinkFieldTableInfo => ({
  dbFieldName,
  selfKeyName: (options as ILinkFieldOptions).selfKeyName,
  isMultipleCellValue: !!isMultipleCellValue,
});

@Injectable()
export class BaseDuplicateService {
  private readonly logger = new Logger(BaseDuplicateService.name);

  @ThresholdConfig()
  private readonly thresholdConfig!: IThresholdConfig;

  constructor(
    private readonly prismaService: PrismaService,
    private readonly tableDuplicateService: TableDuplicateService,
    private readonly baseExportService: BaseExportService,
    private readonly baseImportService: BaseImportService,
    @InjectDbProvider() private readonly dbProvider: IDbProvider,
    @InjectModel(DATA_KNEX) private readonly knex: Knex,
    private readonly persistedComputedBackfillService: PersistedComputedBackfillService,
    private readonly cls: ClsService<IClsStore>,
    private readonly dataDbClientManager: DataDbClientManager,
    private readonly audit: AuditScope
  ) {}

  private getDataPrismaExecutor(prisma: IDataPrismaScopedClient): IDataPrismaExecutor {
    return prisma.txClient?.() ?? prisma;
  }

  @V1Engine()
  async duplicateBase(
    duplicateBaseRo: IDuplicateBaseRo,
    allowCrossBase: boolean = true,
    duplicateMode: BaseDuplicateMode = BaseDuplicateMode.Normal
  ) {
    const { fromBaseId, spaceId, withRecords, name, baseId, nodes, timeZone } = duplicateBaseRo;
    const userId = this.cls.get('user.id');
    const prisma = this.prismaService.txClient();

    // For CopyShareBase mode, don't collect parent nodes - the shared node becomes the root
    const skipParentNodes = duplicateMode === BaseDuplicateMode.CopyShareBase;

    let base: DuplicatedBase | undefined;

    try {
      const duplicated = await this.duplicateStructure(
        fromBaseId,
        spaceId,
        name,
        allowCrossBase,
        baseId,
        nodes,
        duplicateMode,
        timeZone
      );

      ({ base } = duplicated);
      // Patch the active audit operation's resourceId to the newly created base id. Outer
      // decorators (BaseDuplicate / TemplateApply / ShareBaseCopy) opened the operation with
      // fromBaseId/targetBaseId placeholders before the new base existed; without this,
      // every inner atomic audit row would point at the source base instead of the copy.
      this.audit.setResourceId(base.id);
      const {
        base: _base,
        tableIdMap,
        fieldIdMap,
        viewIdMap,
        dateTimeZoneConversionsByTableId,
        ...rest
      } = duplicated;

      const crossBaseLinkFieldTableMap = allowCrossBase
        ? await this.getCrossBaseLinkFieldTableMap(tableIdMap, spaceId)
        : await this.getCrossBaseLinkFieldTableMap(tableIdMap);

      const disconnectedLinkFieldTableMap = await this.getDisconnectedLinkFieldTableMap(
        tableIdMap,
        fromBaseId,
        nodes,
        skipParentNodes
      );

      const mergedLinkFieldTableMap = mergeLinkFieldTableMaps(
        crossBaseLinkFieldTableMap,
        disconnectedLinkFieldTableMap
      );

      const disconnectedLinkFieldIds = await this.getDisconnectedLinkFieldIds(
        tableIdMap,
        fromBaseId,
        nodes,
        skipParentNodes
      );

      let recordsLength = 0;
      if (withRecords) {
        await this.assertSameDataDatabaseForRecordCopy(fromBaseId, base.id);
        await prisma.base.update({
          where: { id: base.id },
          data: {
            provisionState: ProvisionState.pending,
            lastModifiedBy: userId,
          },
        });

        recordsLength = await this.duplicateTableData(
          base.id,
          tableIdMap,
          fieldIdMap,
          viewIdMap,
          mergedLinkFieldTableMap,
          undefined,
          dateTimeZoneConversionsByTableId
        );
        await this.duplicateAttachments(base.id, tableIdMap, fieldIdMap);
        await this.duplicateLinkJunction(
          base.id,
          tableIdMap,
          fieldIdMap,
          allowCrossBase,
          disconnectedLinkFieldIds
        );

        // Persist computed/link/lookup/rollup columns for duplicated data so that
        // reads via useQueryModel (tableCache/raw table) return correct values.
        // This mirrors what the computed pipeline does during regular record writes.
        await this.persistedComputedBackfillService.recomputeForTables(Object.values(tableIdMap));

        await prisma.base.update({
          where: { id: base.id },
          data: {
            provisionState: ProvisionState.ready,
            lastModifiedBy: userId,
          },
        });
      }

      return { base, tableIdMap, fieldIdMap, viewIdMap, recordsLength, ...rest };
    } catch (error) {
      if (base?.id) {
        await prisma.base
          .update({
            where: { id: base.id },
            data: {
              provisionState: ProvisionState.error,
              lastModifiedBy: userId,
            },
          })
          .catch(() => undefined);
      }
      throw error;
    }
  }

  private async getDisconnectedLinkFieldIds(
    tableIdMap: Record<string, string>,
    fromBaseId: string,
    nodes?: string[],
    skipParentNodes: boolean = false
  ) {
    const { excludedTableIds } = await this.collectNodesAndResourceIds(
      fromBaseId,
      nodes,
      skipParentNodes
    );
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

  private async assertSameDataDatabaseForRecordCopy(sourceBaseId: string, targetBaseId: string) {
    if (await this.isSameDataDatabaseForRecordCopy(sourceBaseId, targetBaseId)) {
      return;
    }

    throw new CustomHttpException(
      'Duplicating records across different space data databases is not supported yet',
      HttpErrorCode.VALIDATION_ERROR,
      { localization: { i18nKey: 'httpErrors.base.crossDataDbDuplicateUnsupported' } }
    );
  }

  private async isSameDataDatabaseForRecordCopy(sourceBaseId: string, targetBaseId: string) {
    const [source, target] = await Promise.all([
      this.dataDbClientManager.getDataDatabaseForBase(sourceBaseId, { useTransaction: true }),
      this.dataDbClientManager.getDataDatabaseForBase(targetBaseId, { useTransaction: true }),
    ]);

    return source.cacheKey === target.cacheKey;
  }

  private timeZoneIdentity(timeZone: string) {
    try {
      return new Intl.DateTimeFormat('en-US', { timeZone }).resolvedOptions().timeZone;
    } catch {
      // The accepted IANA list can outpace the runtime's ICU data. If identity cannot
      // be resolved, retain the original conversion and PostgreSQL's validation.
      return undefined;
    }
  }

  private dateTimeZoneConversions(
    structure: DuplicateStructureConfig,
    targetTimeZone: string
  ): NonNullable<DuplicateBaseSource['dateTimeZoneConversionsByTableId']> {
    const targetTimeZoneIdentity = this.timeZoneIdentity(targetTimeZone);
    const sourceTimeZoneIdentities = new Map<string, string | undefined>();
    return Object.fromEntries(
      structure.tables.flatMap((table) => {
        if (!table.id) return [];
        const conversions = table.fields.flatMap((field) => {
          if (field.type !== FieldType.Date || field.isLookup || !field.dbFieldName) return [];
          const sourceTimeZone = (field.options as IDateFieldOptions | undefined)?.formatting
            ?.timeZone;
          // Historical fields may have no source zone. Keep their copy semantics without
          // guessing a zone for value relocation; metadata validation remains unchanged.
          if (
            typeof sourceTimeZone !== 'string' ||
            !isValidTimeZone(sourceTimeZone) ||
            sourceTimeZone === targetTimeZone
          ) {
            return [];
          }
          if (targetTimeZoneIdentity) {
            if (!sourceTimeZoneIdentities.has(sourceTimeZone)) {
              sourceTimeZoneIdentities.set(sourceTimeZone, this.timeZoneIdentity(sourceTimeZone));
            }
            if (sourceTimeZoneIdentities.get(sourceTimeZone) === targetTimeZoneIdentity) {
              // Equivalent aliases must keep both instants in a repeated local hour distinct.
              return [];
            }
          }
          return [{ dbFieldName: field.dbFieldName, sourceTimeZone, targetTimeZone }];
        });
        return conversions.length ? [[table.id, conversions]] : [];
      })
    );
  }

  private async duplicateStructure(
    fromBaseId: string,
    spaceId: string,
    baseName?: string,
    allowCrossBase?: boolean,
    baseId?: string,
    nodes?: string[],
    duplicateMode: BaseDuplicateMode = BaseDuplicateMode.Normal,
    timeZone?: string
  ) {
    const prisma = this.prismaService.txClient();
    const baseRaw = await prisma.base.findUniqueOrThrow({
      where: {
        id: fromBaseId,
        deletedTime: null,
      },
    });
    // The copy always gets a name, even when the source was never named.
    baseRaw.name = baseName || `${baseDisplayName(baseRaw.name)} (Copy)`;

    // For CopyShareBase mode, don't collect parent nodes - the shared node becomes the root
    const skipParentNodes = duplicateMode === BaseDuplicateMode.CopyShareBase;

    // Get included table IDs if includeNodes is provided
    const {
      finalIncludeNodes,
      includedTableIds,
      includedFolderIds,
      includedDashboardIds,
      includedWorkflowIds,
      includedAppIds,
      includedRoutineIds,
      excludedTableIds,
    } = await this.collectNodesAndResourceIds(fromBaseId, nodes, skipParentNodes);

    const rootNodeIds = skipParentNodes ? [...(nodes || [])] : undefined;

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

    const rawStructure = await this.baseExportService.generateBaseStructConfig({
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
      includedRoutineIds,
      excludedTableIds,
      rootNodeIds,
      destSpaceId: spaceId,
    });

    const structure = timeZone ? adaptStructureTimeZone(rawStructure, timeZone) : rawStructure;

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
      duplicateMode,
      undefined,
      { useTransaction: true }
    );

    return {
      base: newBase,
      tableIdMap,
      fieldIdMap,
      viewIdMap,
      ...rest,
      dateTimeZoneConversionsByTableId: timeZone
        ? this.dateTimeZoneConversions(rawStructure, timeZone)
        : {},
    };
  }

  private async collectNodesAndResourceIds(
    fromBaseId: string,
    nodes: string[] | undefined,
    skipParentNodes: boolean = false
  ) {
    const prisma = this.prismaService.txClient();
    let includedTableIds: string[] | undefined;
    let includedFolderIds: string[] | undefined;
    let includedDashboardIds: string[] | undefined;
    let includedWorkflowIds: string[] | undefined;
    let includedRoutineIds: string[] | undefined;
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

      // Function to recursively collect descendant nodes (children)
      const collectDescendantNodes = (nodeId: string, collected: Set<string>) => {
        // Find all children of this node and collect them
        for (const node of allNodes) {
          if (node.parentId === nodeId && !collected.has(node.id)) {
            collected.add(node.id);
            collectDescendantNodes(node.id, collected);
          }
        }
      };

      // Collect selected nodes, all their parent nodes (unless skipParentNodes), and all their descendant nodes
      const allIncludedNodeIds = new Set<string>();
      for (const nodeId of nodes) {
        if (skipParentNodes) {
          // Only add the node itself, no parent collection
          allIncludedNodeIds.add(nodeId);
        } else {
          // Collect the node itself and its parents (for folder structure)
          // Note: collectParentNodes already adds the nodeId itself
          collectParentNodes(nodeId, allIncludedNodeIds);
        }
        // Collect all descendants (children, grandchildren, etc.)
        collectDescendantNodes(nodeId, allIncludedNodeIds);
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

      includedRoutineIds = includedNodeDetails
        .filter((node) => node.resourceType === 'routine')
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
      includedRoutineIds,

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
    nodes?: string[],
    skipParentNodes: boolean = false
  ): Promise<ILinkFieldTableMap> {
    const tableId2DbFieldNameMap: ILinkFieldTableMap = {};
    const { excludedTableIds } = await this.collectNodesAndResourceIds(
      fromBaseId,
      nodes,
      skipParentNodes
    );

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

    Object.entries(groupBy(disconnectedLinkFields, 'tableId')).forEach(([tableId, fields]) => {
      const info = fields.map(toLinkFieldTableInfo);
      tableId2DbFieldNameMap[tableId] = info;
      tableId2DbFieldNameMap[tableIdMap[tableId]] = info;
    });

    return tableId2DbFieldNameMap;
  }

  private async getCrossBaseLinkFieldTableMap(
    tableIdMap: Record<string, string>,
    destSpaceId?: string
  ): Promise<ILinkFieldTableMap> {
    // destSpaceId narrows the value downgrade to cross-space links; with the
    // escape hatch on, those keep their link values. The destSpaceId-less
    // branch is the user-chosen "drop cross-base links" duplicate option and
    // must keep downgrading regardless of the flag.
    if (destSpaceId && isCrossSpaceReferenceAllowed()) return {};
    const tableId2DbFieldNameMap: ILinkFieldTableMap = {};
    const prisma = this.prismaService.txClient();
    const allFieldRaws = await prisma.field.findMany({
      where: {
        tableId: { in: Object.keys(tableIdMap) },
        deletedTime: null,
      },
    });

    const linkFields = allFieldRaws
      .filter(({ type, isLookup }) => type === FieldType.Link && !isLookup)
      .map((f) => ({ ...createFieldInstanceByRaw(f), tableId: f.tableId }))
      .filter((f) => (f.options as ILinkFieldOptions).baseId);

    let crossBaseLinkFields = linkFields;
    if (destSpaceId) {
      const foreignBaseIds = Array.from(
        new Set(
          linkFields
            .map((f) => (f.options as ILinkFieldOptions).baseId)
            .filter((x): x is string => Boolean(x))
        )
      );
      const bases = foreignBaseIds.length
        ? await prisma.base.findMany({
            where: { id: { in: foreignBaseIds }, deletedTime: null },
            select: { id: true, spaceId: true },
          })
        : [];
      const crossSpaceBaseIds = new Set(
        bases.filter((b) => b.spaceId !== destSpaceId).map((b) => b.id)
      );
      crossBaseLinkFields = linkFields.filter((f) => {
        const baseId = (f.options as ILinkFieldOptions).baseId;
        return baseId && crossSpaceBaseIds.has(baseId);
      });
    }

    Object.entries(groupBy(crossBaseLinkFields, 'tableId')).forEach(([tableId, fields]) => {
      const info = fields.map(toLinkFieldTableInfo);
      tableId2DbFieldNameMap[tableId] = info;
      tableId2DbFieldNameMap[tableIdMap[tableId]] = info;
    });

    return tableId2DbFieldNameMap;
  }

  private async duplicateTableData(
    targetBaseId: string,
    tableIdMap: Record<string, string>,
    fieldIdMap: Record<string, string>,
    viewIdMap: Record<string, string>,
    crossBaseLinkFieldTableMap: ILinkFieldTableMap,
    onProgress?: BaseImportProgressCallback,
    dateTimeZoneConversionsByTableId: NonNullable<
      DuplicateBaseSource['dateTimeZoneConversionsByTableId']
    > = {}
  ): Promise<number> {
    const prisma = this.getDataPrismaExecutor(
      (await this.dataDbClientManager.dataPrismaForBase(targetBaseId, {
        useTransaction: true,
      })) as IDataPrismaScopedClient
    );
    const metaPrisma = this.prismaService.txClient();
    const tableId2DbTableNameMap: Record<string, string> = {};
    const tableId2NameMap: Record<string, string> = {};
    const allTableId = Object.keys(tableIdMap).concat(Object.values(tableIdMap));
    const tableRaws = await metaPrisma.tableMeta.findMany({
      where: { id: { in: allTableId }, deletedTime: null },
      select: {
        id: true,
        dbTableName: true,
        name: true,
      },
    });
    tableRaws.forEach((tableRaw) => {
      tableId2DbTableNameMap[tableRaw.id] = tableRaw.dbTableName;
      tableId2NameMap[tableRaw.id] = tableRaw.name;
    });

    const oldTableId = Object.keys(tableIdMap);

    const dbTableNames = tableRaws.map((tableRaw) => tableRaw.dbTableName);

    // Query total records count from all source tables before duplicating
    let totalRecordsCount = 0;
    for (const tableId of oldTableId) {
      const sourceDbTableName = tableId2DbTableNameMap[tableId];
      const countQuery = this.knex(sourceDbTableName).count('*', { as: 'count' }).toQuery();
      const countResult = await prisma.$queryRawUnsafe<[{ count: bigint | number }]>(countQuery);
      const tableRecordCount = Number(countResult[0]?.count || 0);
      totalRecordsCount += tableRecordCount;
    }

    onProgress?.({
      phase: 'table_data_start',
      processedRows: 0,
      batchProcessedRows: 0,
      currentBatch: 0,
      totalRows: totalRecordsCount,
    });

    const allForeignKeyInfos = [] as {
      constraint_name: string;
      column_name: string;
      referenced_table_schema: string;
      referenced_table_name: string;
      referenced_column_name: string;
      delete_rule: string;
      dbTableName: string;
    }[];

    // delete foreign keys if(exist) then duplicate table data
    for (const dbTableName of dbTableNames) {
      const foreignKeysInfoSql = this.dbProvider.getForeignKeysInfo(dbTableName);
      const foreignKeysInfo = await prisma.$queryRawUnsafe<
        {
          constraint_name: string;
          column_name: string;
          referenced_table_schema: string;
          referenced_table_name: string;
          referenced_column_name: string;
          delete_rule: string;
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

    const progressState = { processedRows: 0, totalRows: totalRecordsCount };
    for (const tableId of oldTableId) {
      await this.duplicateSingleTableData({
        tableId,
        tableIdMap,
        fieldIdMap,
        viewIdMap,
        crossBaseLinkFieldTableMap,
        tableId2DbTableNameMap,
        tableId2NameMap,
        prisma,
        progressState,
        onProgress,
        dateTimeZoneConversions: dateTimeZoneConversionsByTableId[tableId],
      });
    }

    for (const {
      constraint_name: constraintName,
      column_name: columnName,
      referenced_table_schema: referencedTableSchema,
      referenced_table_name: referencedTableName,
      referenced_column_name: referencedColumnName,
      delete_rule: deleteRule,
      dbTableName,
    } of allForeignKeyInfos) {
      const addForeignKeyQuerySql = this.knex.schema
        .alterTable(dbTableName, (table) => {
          table
            .foreign(columnName, constraintName)
            .references(referencedColumnName)
            .inTable(`${referencedTableSchema}.${referencedTableName}`)
            .onDelete(toPostgresFkDeleteAction(deleteRule));
        })
        .toQuery();

      await prisma.$executeRawUnsafe(addForeignKeyQuerySql);
    }

    onProgress?.({
      phase: 'table_data_done',
      processedRows: progressState.processedRows,
      totalRows: totalRecordsCount,
    });

    return onProgress ? progressState.processedRows : totalRecordsCount;
  }

  private createDuplicateTableProgressOptions(
    onProgress: BaseImportProgressCallback | undefined,
    progressState: { processedRows: number; totalRows: number },
    tableId: string,
    tableName: string
  ) {
    if (!onProgress) {
      return undefined;
    }

    return {
      batchSize: v2DuplicateCopyBatchSize,
      onProgress: (progress: { batchProcessedRows: number; currentBatch: number }) => {
        progressState.processedRows += progress.batchProcessedRows;
        onProgress({
          phase: 'table_data_progress',
          tableId,
          tableName,
          processedRows: progressState.processedRows,
          batchProcessedRows: progress.batchProcessedRows,
          currentBatch: progress.currentBatch,
          totalRows: progressState.totalRows,
        });
      },
    };
  }

  private async duplicateSingleTableData(params: {
    tableId: string;
    tableIdMap: Record<string, string>;
    fieldIdMap: Record<string, string>;
    viewIdMap: Record<string, string>;
    crossBaseLinkFieldTableMap: ILinkFieldTableMap;
    tableId2DbTableNameMap: Record<string, string>;
    tableId2NameMap: Record<string, string>;
    prisma: IDataPrismaExecutor;
    progressState: { processedRows: number; totalRows: number };
    onProgress?: BaseImportProgressCallback;
    dateTimeZoneConversions?: NonNullable<
      DuplicateBaseSource['dateTimeZoneConversionsByTableId']
    >[string];
  }) {
    const {
      tableId,
      tableIdMap,
      fieldIdMap,
      viewIdMap,
      crossBaseLinkFieldTableMap,
      tableId2DbTableNameMap,
      tableId2NameMap,
      prisma,
      progressState,
      onProgress,
      dateTimeZoneConversions,
    } = params;
    const targetTableId = tableIdMap[tableId];
    const sourceDbTableName = tableId2DbTableNameMap[tableId];
    const targetDbTableName = tableId2DbTableNameMap[targetTableId];
    const tableName = tableId2NameMap[tableId] ?? sourceDbTableName;
    const processedRowsBeforeTable = progressState.processedRows;
    const progressOptions = this.createDuplicateTableProgressOptions(
      onProgress,
      progressState,
      targetTableId,
      tableName
    );

    try {
      const tableRows = await this.tableDuplicateService.duplicateTableData(
        sourceDbTableName,
        targetDbTableName,
        viewIdMap,
        fieldIdMap,
        crossBaseLinkFieldTableMap[tableId] || [],
        prisma,
        dateTimeZoneConversions?.length
          ? { ...progressOptions, dateTimeZoneConversions }
          : progressOptions
      );
      if (onProgress && progressState.processedRows === processedRowsBeforeTable && tableRows > 0) {
        progressState.processedRows += tableRows;
        onProgress({
          phase: 'table_data_progress',
          tableId: targetTableId,
          tableName,
          processedRows: progressState.processedRows,
          batchProcessedRows: tableRows,
          currentBatch: 1,
          totalRows: progressState.totalRows,
        });
      }
      onProgress?.({
        phase: 'table_data_done',
        tableId: targetTableId,
        tableName,
        processedRows: progressState.processedRows,
        totalRows: progressState.totalRows,
      });
    } catch (error) {
      this.logger.error(
        `exc duplicate table data error: ${(error as Error)?.message}`,
        (error as Error)?.stack
      );
      throw error;
    }
  }

  private async duplicateAttachments(
    targetBaseId: string,
    tableIdMap: Record<string, string>,
    fieldIdMap: Record<string, string>
  ) {
    const dataPrisma = this.getDataPrismaExecutor(
      (await this.dataDbClientManager.dataPrismaForBase(targetBaseId, {
        useTransaction: true,
      })) as IDataPrismaScopedClient
    );
    for (const [sourceTableId, targetTableId] of Object.entries(tableIdMap)) {
      await this.tableDuplicateService.duplicateAttachments(
        sourceTableId,
        targetTableId,
        fieldIdMap,
        dataPrisma
      );
    }
  }

  private async duplicateLinkJunction(
    targetBaseId: string,
    tableIdMap: Record<string, string>,
    fieldIdMap: Record<string, string>,
    allowCrossBase: boolean = true,
    disconnectedLinkFieldIds?: string[]
  ) {
    const dataPrisma = this.getDataPrismaExecutor(
      (await this.dataDbClientManager.dataPrismaForBase(targetBaseId, {
        useTransaction: true,
      })) as IDataPrismaScopedClient
    );
    await this.tableDuplicateService.duplicateLinkJunction(
      tableIdMap,
      fieldIdMap,
      allowCrossBase,
      dataPrisma,
      disconnectedLinkFieldIds
    );
  }
}
