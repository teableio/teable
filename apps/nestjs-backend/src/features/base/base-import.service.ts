import type { Readable } from 'stream';
import { Injectable, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import {
  DbFieldType,
  FieldType,
  generateAttachmentId,
  generateBaseId,
  generateBaseNodeFolderId,
  generateBaseNodeId,
  generateDashboardId,
  generateLogId,
  generatePluginInstallId,
  generatePluginPanelId,
  generateRecordId,
  generateShareId,
  generateViewId,
  getUniqName,
  ViewType,
} from '@teable/core';
import { PrismaService, ProvisionState } from '@teable/db-main-prisma';
import { DataPrismaService } from '@teable/db-data-prisma';
import type {
  ICreateBaseVo,
  IBaseJson,
  ImportBaseRo,
  IFieldWithTableIdJson,
  IImportBaseVo,
} from '@teable/openapi';
import {
  UploadType,
  PluginPosition,
  BaseNodeResourceType,
  BaseDuplicateMode,
} from '@teable/openapi';
import { v2PostgresDbTokens } from '@teable/v2-adapter-db-postgres-pg';
import {
  err,
  ok,
  RecordId,
  GetTableByIdQuery,
  ImportDotTeaStructureCommand,
  RestoreRecordsStreamCommand,
  v2CoreTokens,
  type ICommandBus,
  type DomainError,
  type IExecutionContext,
  type IQueryBus,
  type ITableRecordRepository,
  type IUnitOfWork,
  type GetTableByIdResult,
  type ImportDotTeaStructureResult,
  type RecordUpdateResult,
  type Result,
  type RestoreRecordInput,
  type RestoreRecordsStreamResult,
  type UpdateManyStreamBatchInput,
} from '@teable/v2-core';

import * as csvParser from 'csv-parser';
import { Knex } from 'knex';
import { Kysely, sql } from 'kysely';
import { InjectModel } from 'nest-knexjs';
import { ClsService } from 'nestjs-cls';
import streamJson from 'stream-json';
import streamValues from 'stream-json/streamers/StreamValues';
import * as unzipper from 'unzipper';
import { IThresholdConfig, ThresholdConfig } from '../../configs/threshold.config';
import { InjectDbProvider } from '../../db-provider/db.provider';
import { IDbProvider } from '../../db-provider/db.provider.interface';
import type { IClsStore } from '../../types/cls';
import StorageAdapter from '../attachments/plugins/adapter';
import { InjectStorageAdapter } from '../attachments/plugins/storage';
import { FieldDuplicateService } from '../field/field-duplicate/field-duplicate.service';
import { TableService } from '../table/table.service';
import { V2ContainerService } from '../v2/v2-container.service';
import { V2ExecutionContextFactory } from '../v2/v2-execution-context.factory';
import { ViewOpenApiService } from '../view/open-api/view-open-api.service';
import { BaseImportAttachmentsQueueProcessor } from './base-import-processor/base-import-attachments.processor';
import { BaseImportCsvQueueProcessor } from './base-import-processor/base-import-csv.processor';
import { replaceStringByMap } from './utils';

export interface IBaseImportProgress {
  phase: string;
  detail?: string;
  tableId?: string;
  tableName?: string;
  tableIndex?: number;
  totalTables?: number;
  totalRows?: number;
  processedRows?: number;
  batchProcessedRows?: number;
  currentBatch?: number;
}

export type BaseImportProgressCallback = (
  phase: string | IBaseImportProgress,
  detail?: string
) => void;

const tableDataImportBatchSize = 100;
const linkFieldImportBatchSize = 25;

@Injectable()
export class BaseImportService {
  private logger = new Logger(BaseImportService.name);

  constructor(
    private readonly prismaService: PrismaService,
    private readonly dataPrismaService: DataPrismaService,
    private readonly cls: ClsService<IClsStore>,
    private readonly tableService: TableService,
    private readonly fieldDuplicateService: FieldDuplicateService,
    private readonly viewOpenApiService: ViewOpenApiService,
    private readonly baseImportAttachmentsQueueProcessor: BaseImportAttachmentsQueueProcessor,
    private readonly baseImportCsvQueueProcessor: BaseImportCsvQueueProcessor,
    @InjectDbProvider() private readonly dbProvider: IDbProvider,
    @InjectStorageAdapter() private readonly storageAdapter: StorageAdapter,
    @ThresholdConfig() private readonly thresholdConfig: IThresholdConfig,
    private readonly eventEmitter: EventEmitter2,
    private readonly v2ContainerService: V2ContainerService,
    private readonly v2ContextFactory: V2ExecutionContextFactory
  ) {}

  private async getMaxOrder(spaceId: string) {
    const spaceAggregate = await this.prismaService.txClient().base.aggregate({
      where: { spaceId, deletedTime: null },
      _max: { order: true },
    });
    return spaceAggregate._max.order || 0;
  }

  private async createBase(spaceId: string, name: string, icon?: string) {
    const userId = this.cls.get('user.id');
    const order = (await this.getMaxOrder(spaceId)) + 1;

    const base = await this.prismaService.txClient().base.create({
      data: {
        id: generateBaseId(),
        name: name || 'Untitled Base',
        spaceId,
        order,
        icon,
        v2Enabled: true,
        createdBy: userId,
        provisionState: ProvisionState.pending,
      },
      select: {
        id: true,
        name: true,
        icon: true,
        spaceId: true,
      },
    });

    try {
      const sqlList = this.dbProvider.createSchema(base.id);
      if (sqlList) {
        for (const sql of sqlList) {
          // Keep schema creation visible to the subsequent data-plane DDL/insert steps even when
          // import structure creation is wrapped in an outer shared meta transaction.
          await this.dataPrismaService.$executeRawUnsafe(sql);
        }
      }

      await this.prismaService.txClient().base.update({
        where: { id: base.id },
        data: { provisionState: ProvisionState.ready },
      });

      return base;
    } catch (error) {
      await this.prismaService.txClient().base.update({
        where: { id: base.id },
        data: { provisionState: ProvisionState.error },
      });
      throw error;
    }
  }

  private async createBaseV2(
    db: Kysely<unknown>,
    spaceId: string,
    name: string,
    icon?: string
  ): Promise<ICreateBaseVo> {
    const userId = this.cls.get('user.id');
    const base = {
      id: generateBaseId(),
      name: name || 'Untitled Base',
      icon: icon ?? null,
      spaceId,
    };

    await db.transaction().execute(async (trx) => {
      const orderResult = await sql<{ max_order: number | string | null }>`
        select coalesce(max("order"), 0) as max_order
        from "base"
        where "space_id" = ${spaceId}
          and "deleted_time" is null
      `.execute(trx);
      const order = Number(orderResult.rows[0]?.max_order ?? 0) + 1;

      await sql`
        insert into "base" (
          "id",
          "name",
          "space_id",
          "order",
          "icon",
          "v2_enabled",
          "created_by"
        )
        values (
          ${base.id},
          ${base.name},
          ${base.spaceId},
          ${order},
          ${base.icon},
          ${true},
          ${userId}
        )
      `.execute(trx);
    });

    return base;
  }

  async importBase(importBaseRo: ImportBaseRo, onProgress?: BaseImportProgressCallback) {
    const {
      notify: { path },
    } = importBaseRo;

    onProgress?.('parsing_structure');

    // 1. create base structure from json
    const structureStream = await this.storageAdapter.downloadFile(
      StorageAdapter.getBucket(UploadType.Import),
      path
    );

    const { base, tableIdMap, viewIdMap, fieldIdMap, fkMap, structure, ...rest } =
      await this.prismaService.$tx(
        async () => {
          return await this.processStructure(structureStream, importBaseRo, onProgress);
        },
        {
          timeout: this.thresholdConfig.bigTransactionTimeout,
        }
      );

    // Structure created successfully, notify with baseId
    onProgress?.('structure_created', base.id);

    // 2. upload attachments (queued)
    onProgress?.('queuing_attachments');
    this.uploadAttachments(path);

    // 3. create import table data task (queued)
    onProgress?.('queuing_data_import');
    this.appendTableData(
      base.id,
      importBaseRo,
      path,
      tableIdMap,
      fieldIdMap,
      viewIdMap,
      fkMap,
      structure
    );

    return {
      base,
      tableIdMap,
      fieldIdMap,
      viewIdMap,
      ...rest,
    } as {
      base: ICreateBaseVo;
      tableIdMap: Record<string, string>;
      fieldIdMap: Record<string, string>;
      viewIdMap: Record<string, string>;
    } & {
      [key: string]: Record<string, string>;
    };
  }

  async importBaseV2(
    importBaseRo: ImportBaseRo,
    onProgress?: BaseImportProgressCallback
  ): Promise<IImportBaseVo> {
    const {
      spaceId,
      notify: { path },
    } = importBaseRo;

    onProgress?.('importing_v2');
    onProgress?.('parsing_structure');

    const structureStream = await this.storageAdapter.downloadFile(
      StorageAdapter.getBucket(UploadType.Import),
      path
    );
    const structure = await this.readDotTeaStructure(structureStream);
    onProgress?.('creating_base', structure.name);
    const container = await this.v2ContainerService.getContainer();
    const commandBus = container.resolve<ICommandBus>(v2CoreTokens.commandBus);
    const queryBus = container.resolve<IQueryBus>(v2CoreTokens.queryBus);
    const tableRecordRepository = container.resolve<ITableRecordRepository>(
      v2CoreTokens.tableRecordRepository
    );
    const unitOfWork = container.resolve<IUnitOfWork>(v2CoreTokens.unitOfWork);
    const db = container.resolve<Kysely<unknown>>(v2PostgresDbTokens.db);
    const context = await this.v2ContextFactory.createContext();
    const base = await this.createBaseV2(db, spaceId, structure.name, structure.icon || undefined);

    const dotTeaStream = await this.storageAdapter.downloadFile(
      StorageAdapter.getBucket(UploadType.Import),
      path
    );
    const commandResult = ImportDotTeaStructureCommand.createFromStream({
      baseId: base.id,
      dotTeaStream,
      commitInSingleTransaction: false,
      onProgress: (event) => onProgress?.(event),
    });

    if (commandResult.isErr()) {
      throw new Error(commandResult.error.message);
    }

    const result = await commandBus.execute<
      ImportDotTeaStructureCommand,
      ImportDotTeaStructureResult
    >(context, commandResult.value);

    if (result.isErr()) {
      throw new Error(result.error.message);
    }

    const { tableIdMap, fieldIdMap, viewIdMap } = result.value;

    onProgress?.('structure_created', base.id);
    await this.restoreBaseExtrasV2(
      db,
      base.id,
      structure,
      { tableIdMap, fieldIdMap, viewIdMap },
      onProgress
    );
    onProgress?.('queuing_attachments');
    await this.importAttachmentsV2(db, path);
    onProgress?.('importing_table_data');
    await this.importTableDataV2(
      path,
      base.id,
      structure,
      tableIdMap,
      viewIdMap,
      commandBus,
      queryBus,
      context,
      onProgress
    );
    await this.importTableLinkFieldsV2(
      path,
      base.id,
      structure,
      tableIdMap,
      queryBus,
      tableRecordRepository,
      unitOfWork,
      context,
      onProgress
    );

    return {
      base,
      tableIdMap,
      fieldIdMap,
      viewIdMap,
    };
  }

  private async restoreBaseExtrasV2(
    db: Kysely<unknown>,
    baseId: string,
    structure: IBaseJson,
    idMaps: {
      tableIdMap: Record<string, string>;
      fieldIdMap: Record<string, string>;
      viewIdMap: Record<string, string>;
    },
    onProgress?: BaseImportProgressCallback
  ) {
    const { tableIdMap, fieldIdMap, viewIdMap } = idMaps;
    let dashboardIdMap: Record<string, string> = {};
    const hasPlugins = Object.values(structure.plugins).some(
      (plugins) => Array.isArray(plugins) && plugins.length > 0
    );
    if (hasPlugins) {
      onProgress?.('creating_plugins');
      ({ dashboardIdMap } = await this.createPluginsV2(
        db,
        baseId,
        structure.plugins,
        tableIdMap,
        fieldIdMap,
        viewIdMap
      ));
    }

    const hasFolders = Array.isArray(structure.folders) && structure.folders.length > 0;
    const hasNodes = Array.isArray(structure.nodes) && structure.nodes.length > 0;
    if (!hasFolders && !hasNodes) {
      return;
    }

    if (hasFolders) {
      onProgress?.('creating_folders');
    }
    const { folderIdMap } = await this.createFoldersV2(db, baseId, structure.folders);

    if (hasNodes) {
      onProgress?.('restoring_base_nodes');
      await this.createBaseNodesV2(
        db,
        baseId,
        structure.nodes,
        {
          folderIdMap,
          tableIdMap,
          dashboardIdMap,
        },
        { updateExistingNodes: true }
      );
    }
  }

  private async createFoldersV2(
    db: Kysely<unknown>,
    baseId: string,
    folders: IBaseJson['folders']
  ) {
    const folderIdMap: Record<string, string> = {};
    if (!Array.isArray(folders) || folders.length === 0) {
      return { folderIdMap };
    }

    const userId = this.cls.get('user.id');
    for (const folder of folders) {
      const { id, name } = folder;
      const newFolderId = generateBaseNodeFolderId();
      await sql`
        insert into "base_node_folder" ("id", "name", "base_id", "created_by")
        values (${newFolderId}, ${name}, ${baseId}, ${userId})
      `.execute(db);
      folderIdMap[id] = newFolderId;
    }

    return { folderIdMap };
  }

  private async createBaseNodesV2(
    db: Kysely<unknown>,
    baseId: string,
    nodes: IBaseJson['nodes'],
    idMapContext: {
      folderIdMap?: Record<string, string>;
      tableIdMap?: Record<string, string>;
      dashboardIdMap?: Record<string, string>;
      workflowIdMap?: Record<string, string>;
      appIdMap?: Record<string, string>;
    },
    options?: {
      updateExistingNodes?: boolean;
    }
  ) {
    if (!Array.isArray(nodes) || nodes.length === 0) {
      return {} as Record<string, string>;
    }

    const userId = this.cls.get('user.id');
    const {
      folderIdMap = {},
      tableIdMap = {},
      dashboardIdMap = {},
      workflowIdMap = {},
      appIdMap = {},
    } = idMapContext;
    const allNodeIdMap = nodes.reduce(
      (acc, cur) => {
        acc[cur.id] = generateBaseNodeId();
        return acc;
      },
      {} as Record<string, string>
    );
    const allTypeNodeIdMap = this.buildBaseNodeResourceIdMap({
      nodes,
      folderIdMap,
      tableIdMap,
      dashboardIdMap,
      workflowIdMap,
      appIdMap,
    });
    const sortedNodes = this.sortBaseNodesByParent(nodes);
    const createdResourceKeys = new Set<string>();

    for (const node of sortedNodes) {
      const { id, parentId, resourceId, resourceType, order } = node;
      const newId = allNodeIdMap[id];
      const newParentId = parentId && allNodeIdMap[parentId] ? allNodeIdMap[parentId] : null;
      const newResourceId = allTypeNodeIdMap[resourceType]?.[resourceId] ?? null;
      if (!newResourceId) {
        this.logger.error(
          `base-import-service: create base node failed, nodeId: ${id}, resourceId: ${resourceId}, resourceType: ${resourceType}`
        );
        continue;
      }

      const resourceKey = `${baseId}:${resourceType}:${newResourceId}`;
      if (createdResourceKeys.has(resourceKey)) {
        this.logger.warn(
          `base-import-service: skipping duplicate node in batch, baseId: ${baseId}, resourceType: ${resourceType}, resourceId: ${newResourceId}`
        );
        continue;
      }

      const existingNode = await sql<{ id: string }>`
        select "id"
        from "base_node"
        where "base_id" = ${baseId}
          and "resource_type" = ${resourceType}
          and "resource_id" = ${newResourceId}
        limit 1
      `.execute(db);
      const existingNodeId = existingNode.rows[0]?.id;

      if (existingNodeId && options?.updateExistingNodes) {
        await sql`
          update "base_node"
          set "parent_id" = ${newParentId},
              "order" = ${order},
              "last_modified_by" = ${userId},
              "last_modified_time" = now()
          where "id" = ${existingNodeId}
        `.execute(db);
        allNodeIdMap[id] = existingNodeId;
        createdResourceKeys.add(resourceKey);
        continue;
      }

      if (existingNodeId) {
        this.logger.warn(
          `base-import-service: node already exists in database, baseId: ${baseId}, resourceType: ${resourceType}, resourceId: ${newResourceId}`
        );
        createdResourceKeys.add(resourceKey);
        continue;
      }

      await sql`
        insert into "base_node" (
          "id",
          "parent_id",
          "resource_id",
          "resource_type",
          "base_id",
          "created_by",
          "order"
        )
        values (
          ${newId},
          ${newParentId},
          ${newResourceId},
          ${resourceType},
          ${baseId},
          ${userId},
          ${order}
        )
      `.execute(db);
      createdResourceKeys.add(resourceKey);
    }

    return allNodeIdMap;
  }

  private buildBaseNodeResourceIdMap(params: {
    nodes: IBaseJson['nodes'];
    folderIdMap: Record<string, string>;
    tableIdMap: Record<string, string>;
    dashboardIdMap: Record<string, string>;
    workflowIdMap: Record<string, string>;
    appIdMap: Record<string, string>;
  }) {
    const { nodes, folderIdMap, tableIdMap, dashboardIdMap, workflowIdMap, appIdMap } = params;
    return nodes.reduce(
      (acc, cur) => {
        const { resourceType, resourceId } = cur;
        acc[resourceType] = acc[resourceType] ?? {};
        switch (resourceType) {
          case BaseNodeResourceType.Folder:
            acc[resourceType][resourceId] = folderIdMap[resourceId];
            break;
          case BaseNodeResourceType.Table:
            acc[resourceType][resourceId] = tableIdMap[resourceId];
            break;
          case BaseNodeResourceType.Dashboard:
            acc[resourceType][resourceId] = dashboardIdMap[resourceId];
            break;
          case BaseNodeResourceType.Workflow:
            acc[resourceType][resourceId] = workflowIdMap[resourceId];
            break;
          case BaseNodeResourceType.App:
            acc[resourceType][resourceId] = appIdMap[resourceId];
            break;
          default:
            break;
        }
        return acc;
      },
      {} as Record<BaseNodeResourceType, Record<string, string>>
    );
  }

  private sortBaseNodesByParent(nodes: IBaseJson['nodes']) {
    const sortedNodes: IBaseJson['nodes'] = [];
    const nodeMap = new Map(nodes.map((node) => [node.id, node]));
    const visited = new Set<string>();

    const visit = (node: (typeof nodes)[0]) => {
      if (visited.has(node.id)) return;
      if (node.parentId && nodeMap.has(node.parentId)) {
        visit(nodeMap.get(node.parentId)!);
      }
      visited.add(node.id);
      sortedNodes.push(node);
    };

    for (const node of nodes) {
      visit(node);
    }

    return sortedNodes;
  }

  private async createPluginsV2(
    db: Kysely<unknown>,
    baseId: string,
    plugins: IBaseJson['plugins'],
    tableIdMap: Record<string, string>,
    fieldMap: Record<string, string>,
    viewIdMap: Record<string, string>
  ) {
    const { dashboardIdMap } = await this.createDashboardV2(
      db,
      baseId,
      plugins[PluginPosition.Dashboard],
      tableIdMap,
      fieldMap
    );
    await this.createPanelV2(db, baseId, plugins[PluginPosition.Panel], tableIdMap, fieldMap);
    await this.createPluginViewsV2(
      db,
      baseId,
      plugins[PluginPosition.View],
      tableIdMap,
      fieldMap,
      viewIdMap
    );
    return { dashboardIdMap };
  }

  private async createDashboardV2(
    db: Kysely<unknown>,
    baseId: string,
    plugins: IBaseJson['plugins'][PluginPosition.Dashboard],
    tableMap: Record<string, string>,
    fieldMap: Record<string, string>
  ) {
    const dashboardMap: Record<string, string> = {};
    const pluginInstallMap: Record<string, string> = {};
    const userId = this.cls.get('user.id');
    const pluginInstalls = plugins.map(({ pluginInstall }) => pluginInstall).flat();

    for (const plugin of plugins) {
      const { id, name } = plugin;
      const newDashBoardId = generateDashboardId();
      await sql`
        insert into "dashboard" ("id", "base_id", "name", "created_by")
        values (${newDashBoardId}, ${baseId}, ${name}, ${userId})
      `.execute(db);
      dashboardMap[id] = newDashBoardId;
    }

    for (const pluginInstall of pluginInstalls) {
      const { id, pluginId, positionId, position, name, storage } = pluginInstall;
      const newPluginInstallId = generatePluginInstallId();
      const newStorage = replaceStringByMap(storage, { tableMap, fieldMap });
      await sql`
        insert into "plugin_install" (
          "id",
          "created_by",
          "base_id",
          "plugin_id",
          "name",
          "position_id",
          "position",
          "storage"
        )
        values (
          ${newPluginInstallId},
          ${userId},
          ${baseId},
          ${pluginId},
          ${name},
          ${dashboardMap[positionId]},
          ${position},
          ${newStorage}
        )
      `.execute(db);
      pluginInstallMap[id] = newPluginInstallId;
    }

    for (const plugin of plugins) {
      const { id, layout } = plugin;
      const newLayout = replaceStringByMap(layout, { pluginInstallMap });
      await sql`
        update "dashboard"
        set "layout" = ${newLayout},
            "last_modified_by" = ${userId},
            "last_modified_time" = now()
        where "id" = ${dashboardMap[id]}
      `.execute(db);
    }

    return {
      dashboardIdMap: dashboardMap,
    };
  }

  private async createPanelV2(
    db: Kysely<unknown>,
    baseId: string,
    plugins: IBaseJson['plugins'][PluginPosition.Panel],
    tableMap: Record<string, string>,
    fieldMap: Record<string, string>
  ) {
    const panelMap: Record<string, string> = {};
    const pluginInstallMap: Record<string, string> = {};
    const userId = this.cls.get('user.id');
    const pluginInstalls = plugins.map(({ pluginInstall }) => pluginInstall).flat();

    for (const plugin of plugins) {
      const { id, name, tableId } = plugin;
      const newPluginPanelId = generatePluginPanelId();
      await sql`
        insert into "plugin_panel" ("id", "table_id", "name", "created_by")
        values (${newPluginPanelId}, ${tableMap[tableId]}, ${name}, ${userId})
      `.execute(db);
      panelMap[id] = newPluginPanelId;
    }

    for (const pluginInstall of pluginInstalls) {
      const { id, pluginId, positionId, position, name, storage } = pluginInstall;
      const newPluginInstallId = generatePluginInstallId();
      const newStorage = replaceStringByMap(storage, { tableMap, fieldMap });
      await sql`
        insert into "plugin_install" (
          "id",
          "created_by",
          "base_id",
          "plugin_id",
          "name",
          "position_id",
          "position",
          "storage"
        )
        values (
          ${newPluginInstallId},
          ${userId},
          ${baseId},
          ${pluginId},
          ${name},
          ${panelMap[positionId]},
          ${position},
          ${newStorage}
        )
      `.execute(db);
      pluginInstallMap[id] = newPluginInstallId;
    }

    for (const plugin of plugins) {
      const { id, layout } = plugin;
      const newLayout = replaceStringByMap(layout, { pluginInstallMap });
      await sql`
        update "plugin_panel"
        set "layout" = ${newLayout},
            "last_modified_by" = ${userId},
            "last_modified_time" = now()
        where "id" = ${panelMap[id]}
      `.execute(db);
    }

    return { panelMap };
  }

  private async createPluginViewsV2(
    db: Kysely<unknown>,
    baseId: string,
    pluginViews: IBaseJson['plugins'][PluginPosition.View],
    tableIdMap: Record<string, string>,
    fieldIdMap: Record<string, string>,
    viewIdMap: Record<string, string>
  ) {
    const userId = this.cls.get('user.id');

    for (const pluginView of pluginViews) {
      const {
        id,
        name,
        description,
        enableShare,
        shareMeta,
        isLocked,
        tableId,
        pluginInstall,
        order,
      } = pluginView;
      if (viewIdMap[id]) {
        continue;
      }

      const newViewId = generateViewId();
      const pluginInstallId = generatePluginInstallId();
      viewIdMap[id] = newViewId;
      const configProperties = ['columnMeta', 'options', 'sort', 'group', 'filter'] as const;
      const updateConfig = {} as Record<(typeof configProperties)[number], string | null>;
      for (const property of configProperties) {
        updateConfig[property] =
          replaceStringByMap(pluginView[property], {
            tableIdMap,
            fieldIdMap,
            viewIdMap,
          }) ?? null;
      }

      await sql`
        insert into "view" (
          "id",
          "name",
          "description",
          "table_id",
          "type",
          "sort",
          "filter",
          "group",
          "options",
          "order",
          "version",
          "column_meta",
          "is_locked",
          "enable_share",
          "share_meta",
          "created_by"
        )
        values (
          ${newViewId},
          ${name},
          ${description ?? null},
          ${tableIdMap[tableId]},
          ${ViewType.Plugin},
          ${updateConfig.sort},
          ${updateConfig.filter},
          ${updateConfig.group},
          ${updateConfig.options},
          ${order},
          ${1},
          ${updateConfig.columnMeta ?? JSON.stringify({})},
          ${isLocked ?? null},
          ${enableShare ?? null},
          ${shareMeta ? JSON.stringify(shareMeta) : null},
          ${userId}
        )
      `.execute(db);

      const newStorage = replaceStringByMap(pluginInstall.storage, {
        tableIdMap,
        fieldIdMap,
        viewIdMap,
      });
      await sql`
        insert into "plugin_install" (
          "id",
          "created_by",
          "base_id",
          "plugin_id",
          "name",
          "position_id",
          "position",
          "storage"
        )
        values (
          ${pluginInstallId},
          ${userId},
          ${baseId},
          ${pluginInstall.pluginId},
          ${pluginInstall.name},
          ${newViewId},
          ${pluginInstall.position},
          ${newStorage}
        )
      `.execute(db);
    }
  }

  private async importAttachmentsV2(db: Kysely<unknown>, path: string) {
    await this.importAttachmentFilesV2(db, path);
    await this.importAttachmentMetadataV2(db, path);
  }

  private async importAttachmentFilesV2(db: Kysely<unknown>, path: string) {
    const zipStream = await this.storageAdapter.downloadFile(
      StorageAdapter.getBucket(UploadType.Import),
      path
    );
    const parser = unzipper.Parse({ forceStream: true });
    zipStream.pipe(parser);
    const bucket = StorageAdapter.getBucket(UploadType.Table);

    try {
      for await (const entry of parser as AsyncIterable<unzipper.Entry>) {
        const filePath = entry.path;
        const fileSuffix = filePath.split('.').pop() ?? '';

        if (
          !filePath.startsWith('attachments/') ||
          entry.type === 'Directory' ||
          fileSuffix === 'csv'
        ) {
          entry.autodrain();
          continue;
        }

        const token = filePath.replace('attachments/', '').split('.')[0];
        const isThumbnail = token.includes('thumbnail__');
        const finalPath = isThumbnail
          ? `table/${token.split('__')[1].split('.')[0]}`
          : `${StorageAdapter.getDir(UploadType.Table)}/${token}`;
        const finalToken = isThumbnail ? token.split('__')[1].split('.')[0] : token;
        const existing = await sql<{ id: string }>`
          select "id"
          from "attachments"
          where "token" = ${finalToken}
          limit 1
        `.execute(db);

        if (existing.rows[0]) {
          entry.autodrain();
          continue;
        }

        await this.storageAdapter.uploadFileStream(bucket, finalPath, entry, {
          // eslint-disable-next-line @typescript-eslint/naming-convention
          'Content-Type': this.getAttachmentMimeType(fileSuffix),
        });
      }
    } finally {
      zipStream.destroy();
    }
  }

  private async importAttachmentMetadataV2(db: Kysely<unknown>, path: string) {
    const zipStream = await this.storageAdapter.downloadFile(
      StorageAdapter.getBucket(UploadType.Import),
      path
    );
    const parser = unzipper.Parse({ forceStream: true });
    zipStream.pipe(parser);
    const userId = this.cls.get('user.id');

    try {
      for await (const entry of parser as AsyncIterable<unzipper.Entry>) {
        const filePath = entry.path;
        if (
          !filePath.startsWith('attachments/') ||
          entry.type === 'Directory' ||
          !filePath.endsWith('.csv')
        ) {
          entry.autodrain();
          continue;
        }

        const csvStream = entry.pipe(
          csvParser.default({
            mapHeaders: ({ header }) => header.replace(/^\uFEFF/, ''),
            mapValues: ({ value }) => value,
          })
        );

        for await (const row of csvStream as AsyncIterable<Record<string, string>>) {
          const token = row.token;
          if (!token) {
            continue;
          }
          const attachmentId = row.id || generateAttachmentId();

          const existing = await sql<{ id: string }>`
            select "id"
            from "attachments"
            where "id" = ${attachmentId}
               or "token" = ${token}
            limit 1
          `.execute(db);

          if (existing.rows[0]) {
            continue;
          }

          await sql`
            insert into "attachments" (
              "id",
              "token",
              "hash",
              "size",
              "mimetype",
              "path",
              "width",
              "height",
              "thumbnail_path",
              "created_by"
            )
            values (
              ${attachmentId},
              ${token},
              ${row.hash},
              ${Number(row.size || 0)},
              ${row.mimetype},
              ${row.path},
              ${row.width ? Number(row.width) : null},
              ${row.height ? Number(row.height) : null},
              ${row.thumbnailPath || null},
              ${userId}
            )
          `.execute(db);
        }
      }
    } finally {
      zipStream.destroy();
    }
  }

  private getAttachmentMimeType(extension: string): string {
    const ext = extension.toLowerCase().replace(/^\./, '');
    const extensionToMimeType: Record<string, string> = {
      jpg: 'image/jpeg',
      jpeg: 'image/jpeg',
      png: 'image/png',
      gif: 'image/gif',
      bmp: 'image/bmp',
      webp: 'image/webp',
      svg: 'image/svg+xml',
      mp3: 'audio/mpeg',
      wav: 'audio/wav',
      ogg: 'audio/ogg',
      flac: 'audio/x-flac',
      mp4: 'video/mp4',
      avi: 'video/x-msvideo',
      mkv: 'video/x-matroska',
      ogv: 'video/ogg',
      webm: 'video/webm',
      pdf: 'application/pdf',
      doc: 'application/msword',
      docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      xls: 'application/vnd.ms-excel',
      xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      ppt: 'application/vnd.ms-powerpoint',
      pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      txt: 'text/plain',
      csv: 'text/csv',
      zip: 'application/zip',
      rar: 'application/x-rar-compressed',
      json: 'application/json',
      xml: 'application/xml',
      html: 'text/html',
      htm: 'text/html',
      css: 'text/css',
      js: 'text/javascript',
      md: 'text/markdown',
    };

    return extensionToMimeType[ext] || 'application/octet-stream';
  }

  private async importTableDataV2(
    path: string,
    baseId: string,
    structure: IBaseJson,
    tableIdMap: Record<string, string>,
    viewIdMap: Record<string, string>,
    commandBus: ICommandBus,
    queryBus: IQueryBus,
    context: IExecutionContext,
    onProgress?: BaseImportProgressCallback
  ) {
    const dotTeaDataStream = await this.storageAdapter.downloadFile(
      StorageAdapter.getBucket(UploadType.Import),
      path
    );
    const parser = unzipper.Parse({ forceStream: true });
    dotTeaDataStream.pipe(parser);

    const tablesById = new Map(structure.tables.map((table) => [table.id, table]));
    let importedTables = 0;

    for await (const entry of parser as AsyncIterable<unzipper.Entry>) {
      const filePath = entry.path;
      const isTableCsv =
        filePath.startsWith('tables/') &&
        entry.type !== 'Directory' &&
        filePath.endsWith('.csv') &&
        !filePath.includes('junction_');

      if (!isTableCsv) {
        entry.autodrain();
        continue;
      }

      const tableId = filePath.replace('tables/', '').replace(/\.csv$/, '');
      const table = tablesById.get(tableId);
      if (!table) {
        entry.autodrain();
        continue;
      }

      importedTables++;
      await this.importTableDataEntryV2(
        entry,
        table,
        baseId,
        tableIdMap[table.id] ?? table.id,
        viewIdMap,
        commandBus,
        queryBus,
        context,
        onProgress
      );
    }

    if (importedTables === 0) {
      onProgress?.('table_data_empty');
    }
  }

  private async importTableDataEntryV2(
    entry: unzipper.Entry,
    table: IBaseJson['tables'][number],
    baseId: string,
    targetTableId: string,
    viewIdMap: Record<string, string>,
    commandBus: ICommandBus,
    queryBus: IQueryBus,
    context: IExecutionContext,
    onProgress?: BaseImportProgressCallback
  ) {
    const tableId = targetTableId;
    const tableName = table.name;
    const config = await this.buildTableDataImportConfig(baseId, tableId, queryBus, context);

    const commandResult = RestoreRecordsStreamCommand.create({
      tableId,
      records: this.createTableRestoreRecordStream(entry, config, viewIdMap),
      batchSize: tableDataImportBatchSize,
      deferComputedUpdates: true,
      enqueueDeferredComputedUpdates: true,
    });
    if (commandResult.isErr()) {
      throw new Error(commandResult.error.message);
    }

    const result = await commandBus.execute<
      RestoreRecordsStreamCommand,
      RestoreRecordsStreamResult
    >(context, commandResult.value);
    if (result.isErr()) {
      throw new Error(result.error.message);
    }

    for await (const event of result.value) {
      if (event.id === 'progress') {
        onProgress?.({
          phase: 'table_data_progress',
          tableId,
          tableName,
          processedRows: event.totalInserted,
          batchProcessedRows: event.insertedCount,
          currentBatch: event.batchIndex + 1,
        });
        continue;
      }

      if (event.id === 'error') {
        throw new Error(event.message);
      }

      onProgress?.({
        phase: 'table_data_done',
        tableId,
        tableName,
        processedRows: event.restoredCount,
      });
    }
  }

  private async buildTableDataImportConfig(
    baseId: string,
    tableId: string,
    queryBus: IQueryBus,
    context: IExecutionContext
  ) {
    const queryResult = GetTableByIdQuery.create({ baseId, tableId });
    if (queryResult.isErr()) {
      throw new Error(queryResult.error.message);
    }

    const tableResult = await queryBus.execute<GetTableByIdQuery, GetTableByIdResult>(
      context,
      queryResult.value
    );
    if (tableResult.isErr()) {
      throw new Error(tableResult.error.message);
    }

    const table = tableResult.value.table;
    const dbTableNameResult = table.dbTableName().andThen((name) => name.value());
    if (dbTableNameResult.isErr()) {
      throw new Error(dbTableNameResult.error.message);
    }

    const fields = table.getFields().flatMap((field) => {
      const dbFieldNameResult = field.dbFieldName().andThen((name) => name.value());
      const dbFieldTypeResult = field.dbFieldType().andThen((type) => type.value());
      const isMultipleCellValueResult = field.isMultipleCellValue();

      if (dbFieldNameResult.isErr() || dbFieldTypeResult.isErr()) {
        return [];
      }

      return {
        id: field.id().toString(),
        type: field.type().toString(),
        dbFieldName: dbFieldNameResult.value,
        dbFieldType: dbFieldTypeResult.value,
        isMultipleCellValue: isMultipleCellValueResult.isOk()
          ? isMultipleCellValueResult.value.toBoolean()
          : false,
        isComputed: field.computed().toBoolean(),
        notNull: field.notNull().toBoolean(),
      };
    });
    const fieldsByDbFieldName = new Map(fields.map((field) => [field.dbFieldName, field]));
    const columnNames = new Set([
      '__id',
      '__auto_number',
      '__created_time',
      '__last_modified_time',
      '__last_modified_by',
      '__created_by',
      '__version',
      ...fieldsByDbFieldName.keys(),
    ]);

    return {
      table,
      dbTableName: dbTableNameResult.value,
      columnNames,
      fieldsByDbFieldName,
    };
  }

  private async importTableLinkFieldsV2(
    path: string,
    baseId: string,
    structure: IBaseJson,
    tableIdMap: Record<string, string>,
    queryBus: IQueryBus,
    tableRecordRepository: ITableRecordRepository,
    unitOfWork: IUnitOfWork,
    context: IExecutionContext,
    onProgress?: BaseImportProgressCallback
  ) {
    const linkFieldsTableId = '__link_fields__';
    const totalRows = await this.countTableLinkFieldUpdatesV2(
      path,
      baseId,
      structure,
      tableIdMap,
      queryBus,
      context
    );

    if (totalRows === 0) {
      return;
    }

    const dotTeaDataStream = await this.storageAdapter.downloadFile(
      StorageAdapter.getBucket(UploadType.Import),
      path
    );
    const parser = unzipper.Parse({ forceStream: true });
    dotTeaDataStream.pipe(parser);

    const tablesById = new Map(structure.tables.map((table) => [table.id, table]));
    let processedRows = 0;
    let currentBatch = 0;

    onProgress?.({
      phase: 'link_fields_progress',
      tableId: linkFieldsTableId,
      processedRows,
      batchProcessedRows: 0,
      currentBatch,
      totalRows,
    });

    const onLinkBatchUpdated = (batchProcessedRows: number) => {
      if (batchProcessedRows <= 0) {
        return;
      }

      processedRows += batchProcessedRows;
      currentBatch += 1;
      onProgress?.({
        phase: 'link_fields_progress',
        tableId: linkFieldsTableId,
        processedRows,
        batchProcessedRows,
        currentBatch,
        totalRows,
      });
    };

    for await (const entry of parser as AsyncIterable<unzipper.Entry>) {
      const filePath = entry.path;
      const isTableCsv =
        filePath.startsWith('tables/') &&
        entry.type !== 'Directory' &&
        filePath.endsWith('.csv') &&
        !filePath.includes('junction_');

      if (!isTableCsv) {
        entry.autodrain();
        continue;
      }

      const tableId = filePath.replace('tables/', '').replace(/\.csv$/, '');
      const table = tablesById.get(tableId);
      if (!table) {
        entry.autodrain();
        continue;
      }

      await this.importTableLinkFieldEntryV2(
        entry,
        baseId,
        tableIdMap[table.id] ?? table.id,
        queryBus,
        tableRecordRepository,
        unitOfWork,
        context,
        onLinkBatchUpdated
      );
    }

    if (processedRows > 0) {
      onProgress?.({
        phase: 'link_fields_done',
        tableId: linkFieldsTableId,
        processedRows,
        totalRows,
      });
    }
  }

  private async countTableLinkFieldUpdatesV2(
    path: string,
    baseId: string,
    structure: IBaseJson,
    tableIdMap: Record<string, string>,
    queryBus: IQueryBus,
    context: IExecutionContext
  ) {
    const dotTeaDataStream = await this.storageAdapter.downloadFile(
      StorageAdapter.getBucket(UploadType.Import),
      path
    );
    const parser = unzipper.Parse({ forceStream: true });
    dotTeaDataStream.pipe(parser);

    const tablesById = new Map(structure.tables.map((table) => [table.id, table]));
    let totalRows = 0;

    for await (const entry of parser as AsyncIterable<unzipper.Entry>) {
      const filePath = entry.path;
      const isTableCsv =
        filePath.startsWith('tables/') &&
        entry.type !== 'Directory' &&
        filePath.endsWith('.csv') &&
        !filePath.includes('junction_');

      if (!isTableCsv) {
        entry.autodrain();
        continue;
      }

      const tableId = filePath.replace('tables/', '').replace(/\.csv$/, '');
      const table = tablesById.get(tableId);
      if (!table) {
        entry.autodrain();
        continue;
      }

      const config = await this.buildTableDataImportConfig(
        baseId,
        tableIdMap[table.id] ?? table.id,
        queryBus,
        context
      );
      const hasLinkFields = [...config.fieldsByDbFieldName.values()].some(
        (field) => field.type === FieldType.Link && !this.isRestoreComputedField(field)
      );

      if (!hasLinkFields) {
        entry.autodrain();
        continue;
      }

      for await (const _record of this.createTableLinkFieldUpdateStream(entry, config)) {
        totalRows += 1;
      }
    }

    return totalRows;
  }

  private async importTableLinkFieldEntryV2(
    entry: unzipper.Entry,
    baseId: string,
    targetTableId: string,
    queryBus: IQueryBus,
    tableRecordRepository: ITableRecordRepository,
    unitOfWork: IUnitOfWork,
    context: IExecutionContext,
    onLinkBatchUpdated: (batchProcessedRows: number) => void
  ) {
    const tableId = targetTableId;
    const config = await this.buildTableDataImportConfig(baseId, tableId, queryBus, context);
    const hasLinkFields = [...config.fieldsByDbFieldName.values()].some(
      (field) => field.type === FieldType.Link && !this.isRestoreComputedField(field)
    );

    if (!hasLinkFields) {
      entry.autodrain();
      return;
    }

    for await (const batchResult of this.createTableLinkFieldUpdateBatchStream(entry, config)) {
      if (batchResult.isErr()) {
        throw new Error(batchResult.error.message);
      }

      const result = await unitOfWork.withTransaction(context, async (transactionContext) =>
        tableRecordRepository.updateManyStream(transactionContext, config.table, [batchResult], {
          deferComputedUpdates: true,
          enqueueDeferredComputedUpdates: true,
          fillLinkTitles: true,
        })
      );
      if (result.isErr()) {
        throw new Error(result.error.message);
      }

      onLinkBatchUpdated(result.value.totalUpdated);
    }
  }

  private async *createTableRestoreRecordStream(
    entry: unzipper.Entry,
    config: Awaited<ReturnType<BaseImportService['buildTableDataImportConfig']>>,
    viewIdMap: Record<string, string>
  ): AsyncGenerator<RestoreRecordInput> {
    const csvStream = entry.pipe(
      csvParser.default({
        mapHeaders: ({ header }) => header.replace(/^\uFEFF/, ''),
        mapValues: ({ value }) => value,
      })
    );

    for await (const row of csvStream as AsyncIterable<Record<string, string>>) {
      yield this.toRestoreRecordInput(row, config, viewIdMap);
    }
  }

  private toRestoreRecordInput(
    row: Record<string, string>,
    config: Awaited<ReturnType<BaseImportService['buildTableDataImportConfig']>>,
    viewIdMap: Record<string, string>
  ): RestoreRecordInput {
    const recordId = row.__id || generateRecordId();
    const fields: Record<string, unknown> = {};
    const extraColumnValues: Record<string, unknown> = {};
    const orders: Record<string, number> = {};

    for (const [columnName, rawValue] of Object.entries(row)) {
      if (columnName === '__id') {
        continue;
      }

      if (columnName.startsWith('__row_')) {
        const order = Number(rawValue);
        if (Number.isFinite(order)) {
          const sourceViewId = columnName.slice('__row_'.length);
          orders[viewIdMap[sourceViewId] ?? sourceViewId] = order;
        }
        continue;
      }

      if (this.isRestoreSystemColumn(columnName)) {
        continue;
      }

      if (!config.columnNames.has(columnName)) {
        continue;
      }

      const field = config.fieldsByDbFieldName.get(columnName);
      if (
        this.isRestoreComputedField(field) ||
        field?.type === FieldType.Button ||
        field?.type === FieldType.Link
      ) {
        continue;
      }

      const value = this.normalizeDotTeaCsvValue(rawValue, {
        dbFieldType: field?.dbFieldType,
        isMultipleCellValue: Boolean(field?.isMultipleCellValue),
        notNull: Boolean(field?.notNull),
      });

      if (field?.type === FieldType.Attachment && value != null) {
        fields[field.id] = this.parseJsonCellValue(value);
        continue;
      }

      extraColumnValues[columnName] = this.serializeRestoreColumnValue(value, field?.dbFieldType);
    }

    return {
      recordId,
      fields,
      ...(Object.keys(orders).length ? { orders } : {}),
      ...(row.__version ? { version: Number(row.__version) } : {}),
      ...(row.__auto_number ? { autoNumber: Number(row.__auto_number) } : {}),
      ...(row.__created_time ? { createdTime: row.__created_time } : {}),
      ...(row.__created_by ? { createdBy: row.__created_by } : {}),
      ...(row.__last_modified_time ? { lastModifiedTime: row.__last_modified_time } : {}),
      ...(row.__last_modified_by ? { lastModifiedBy: row.__last_modified_by } : {}),
      ...(Object.keys(extraColumnValues).length ? { extraColumnValues } : {}),
    };
  }

  private async *createTableLinkFieldUpdateStream(
    entry: unzipper.Entry,
    config: Awaited<ReturnType<BaseImportService['buildTableDataImportConfig']>>
  ): AsyncGenerator<{ id: string; fields: Record<string, unknown> }> {
    const csvStream = entry.pipe(
      csvParser.default({
        mapHeaders: ({ header }) => header.replace(/^\uFEFF/, ''),
        mapValues: ({ value }) => value,
      })
    );

    for await (const row of csvStream as AsyncIterable<Record<string, string>>) {
      const updateRecord = this.toLinkFieldUpdateRecordInput(row, config);
      if (updateRecord) {
        yield updateRecord;
      }
    }
  }

  private async *createTableLinkFieldUpdateBatchStream(
    entry: unzipper.Entry,
    config: Awaited<ReturnType<BaseImportService['buildTableDataImportConfig']>>
  ): AsyncGenerator<Result<UpdateManyStreamBatchInput, DomainError>> {
    let batch: RecordUpdateResult[] = [];

    const flush = () => {
      if (!batch.length) {
        return null;
      }

      const updates = batch;
      batch = [];
      return ok({ table: config.table, updates });
    };

    for await (const record of this.createTableLinkFieldUpdateStream(entry, config)) {
      const recordIdResult = RecordId.create(record.id);
      if (recordIdResult.isErr()) {
        yield err(recordIdResult.error);
        return;
      }

      const updateResult = config.table.updateRecord(
        recordIdResult.value,
        new Map(Object.entries(record.fields)),
        { typecast: true }
      );
      if (updateResult.isErr()) {
        yield err(updateResult.error);
        return;
      }

      batch.push(updateResult.value);
      if (batch.length >= linkFieldImportBatchSize) {
        const batchResult = flush();
        if (batchResult) {
          yield batchResult;
        }
      }
    }

    const batchResult = flush();
    if (batchResult) {
      yield batchResult;
    }
  }

  private toLinkFieldUpdateRecordInput(
    row: Record<string, string>,
    config: Awaited<ReturnType<BaseImportService['buildTableDataImportConfig']>>
  ): { id: string; fields: Record<string, unknown> } | null {
    const recordId = row.__id;
    if (!recordId) {
      return null;
    }

    const fields: Record<string, unknown> = {};
    for (const [columnName, rawValue] of Object.entries(row)) {
      const field = config.fieldsByDbFieldName.get(columnName);
      if (field?.type !== FieldType.Link || this.isRestoreComputedField(field) || rawValue === '') {
        continue;
      }

      const value = this.normalizeDotTeaCsvValue(rawValue, {
        dbFieldType: field.dbFieldType,
        isMultipleCellValue: Boolean(field.isMultipleCellValue),
        notNull: Boolean(field.notNull),
      });
      if (value == null) {
        continue;
      }

      fields[field.id] = this.parseJsonCellValue(value);
    }

    return Object.keys(fields).length ? { id: recordId, fields } : null;
  }

  private isRestoreSystemColumn(columnName: string) {
    return [
      '__auto_number',
      '__created_time',
      '__last_modified_time',
      '__last_modified_by',
      '__created_by',
      '__version',
    ].includes(columnName);
  }

  private isRestoreComputedField(field?: { type: string; isComputed?: boolean | null }) {
    if (!field) {
      return false;
    }

    return (
      Boolean(field.isComputed) ||
      [
        FieldType.Formula,
        FieldType.Rollup,
        FieldType.ConditionalRollup,
        FieldType.CreatedTime,
        FieldType.LastModifiedTime,
        FieldType.CreatedBy,
        FieldType.LastModifiedBy,
        FieldType.AutoNumber,
      ].includes(field.type as FieldType)
    );
  }

  private normalizeDotTeaCsvValue(
    value: string,
    field?: { dbFieldType?: string; isMultipleCellValue?: boolean; notNull?: boolean }
  ): unknown {
    if (value !== '') {
      switch (this.normalizeDbFieldType(field?.dbFieldType)) {
        case DbFieldType.Integer: {
          const intValue = Number.parseInt(value, 10);
          return Number.isFinite(intValue) ? intValue : value;
        }
        case DbFieldType.Real: {
          const numberValue = Number(value);
          return Number.isFinite(numberValue) ? numberValue : value;
        }
        case DbFieldType.Boolean:
          if (value === '1' || value.toLowerCase() === 'true') {
            return true;
          }
          if (value === '0' || value.toLowerCase() === 'false') {
            return false;
          }
          return value;
        case DbFieldType.Json:
          return this.parseJsonCellValue(value);
        default:
          return value;
      }
    }

    if (!field?.notNull) {
      return null;
    }

    return this.getNotNullDefault(
      field.dbFieldType || DbFieldType.Text,
      Boolean(field.isMultipleCellValue)
    );
  }

  private parseJsonCellValue(value: unknown): unknown {
    if (typeof value !== 'string') {
      return value;
    }
    try {
      return JSON.parse(value);
    } catch {
      return value;
    }
  }

  private normalizeDbFieldType(dbFieldType?: string) {
    return dbFieldType?.toUpperCase();
  }

  private serializeRestoreColumnValue(value: unknown, dbFieldType?: string): unknown {
    if (value == null || this.normalizeDbFieldType(dbFieldType) !== DbFieldType.Json) {
      return value;
    }

    return JSON.stringify(value);
  }

  private getNotNullDefault(dbFieldType: string, isMultipleCellValue: boolean): unknown {
    switch (this.normalizeDbFieldType(dbFieldType)) {
      case DbFieldType.Integer:
      case DbFieldType.Real:
        return 0;
      case DbFieldType.Boolean:
        return false;
      case DbFieldType.DateTime:
        return new Date(0).toISOString();
      case DbFieldType.Json:
        return isMultipleCellValue ? [] : {};
      case DbFieldType.Text:
      default:
        return 'null';
    }
  }

  private async readDotTeaStructure(zipStream: Readable): Promise<IBaseJson> {
    const zipParser = unzipper.Parse();
    zipStream.pipe(zipParser);

    return new Promise((resolve, reject) => {
      zipParser.on('entry', (entry) => {
        if (entry.path !== 'structure.json') {
          entry.autodrain();
          return;
        }

        const parser = streamJson.parser();
        const pipeline = entry.pipe(parser).pipe(streamValues.streamValues());

        pipeline
          .on('data', (data: { key: number; value: IBaseJson }) => {
            resolve(data.value);
          })
          .on('error', (err: Error) => reject(err));
      });
      zipParser.on('error', (err) => reject(err));
      zipParser.on('finish', () => {
        reject(new Error('structure.json not found in dottea file'));
      });
    });
  }

  private async processStructure(
    zipStream: Readable,
    importBaseRo: ImportBaseRo,
    onProgress?: BaseImportProgressCallback
  ): Promise<{
    base: ICreateBaseVo;
    tableIdMap: Record<string, string>;
    fieldIdMap: Record<string, string>;
    viewIdMap: Record<string, string>;
    fkMap: Record<string, string>;
    structure: IBaseJson;
  }> {
    const { spaceId } = importBaseRo;
    const parser = unzipper.Parse();
    zipStream.pipe(parser);
    return new Promise((resolve, reject) => {
      parser.on('entry', (entry) => {
        const filePath = entry.path;
        if (filePath === 'structure.json') {
          const parser = streamJson.parser();
          const pipeline = entry.pipe(parser).pipe(streamValues.streamValues());

          let structureObject: IBaseJson | null = null;
          pipeline
            .on('data', (data: { key: number; value: IBaseJson }) => {
              structureObject = data.value;
            })
            .on('end', async () => {
              if (!structureObject) {
                reject(new Error('import base structure.json resolve error'));
              }

              try {
                const result = await this.createBaseStructure(
                  spaceId,
                  structureObject!,
                  undefined,
                  undefined,
                  undefined,
                  onProgress
                );
                resolve(result);
              } catch (error) {
                reject(error);
              }
            })
            .on('error', (err: Error) => {
              parser.destroy(new Error(`resolve structure.json error: ${err.message}`));
              reject(Error);
            });
        } else {
          entry.autodrain();
        }
      });
    });
  }

  private async uploadAttachments(path: string) {
    const userId = this.cls.get('user.id');
    await this.baseImportAttachmentsQueueProcessor.queue.add(
      'import_base_attachments',
      {
        path,
        userId,
      },
      {
        jobId: `import_attachments_${path}_${userId}`,
      }
    );
  }

  private async appendTableData(
    baseId: string,
    importBaseRo: ImportBaseRo,
    path: string,
    tableIdMap: Record<string, string>,
    fieldIdMap: Record<string, string>,
    viewIdMap: Record<string, string>,
    fkMap: Record<string, string>,
    structure: IBaseJson
  ): Promise<string> {
    const userId = this.cls.get('user.id');
    const origin = this.cls.get('origin');
    // Generate a unique logId for upsert to ensure only one audit log
    const logId = generateLogId();

    await this.baseImportCsvQueueProcessor.queue.add(
      'base_import_csv',
      {
        baseId,
        path,
        userId,
        origin,
        tableIdMap,
        fieldIdMap,
        viewIdMap,
        fkMap,
        structure,
        importBaseRo,
        logId,
      },
      {
        jobId: `import_csv_${path}_${userId}`,
      }
    );

    return logId;
  }

  async createBaseStructure(
    spaceId: string,
    structure: IBaseJson,
    baseId?: string,
    skipCreateBaseNodes?: boolean,
    duplicateMode: BaseDuplicateMode = BaseDuplicateMode.Normal,
    onProgress?: BaseImportProgressCallback
  ) {
    const { name, icon, tables, plugins, folders } = structure;

    const isCopyToExistingBase = !!baseId && duplicateMode === BaseDuplicateMode.CopyShareBase;

    // create base
    onProgress?.('creating_base', name);
    const newBase = baseId
      ? await this.prismaService.base.findUniqueOrThrow({
          where: { id: baseId },
          select: {
            id: true,
            name: true,
            icon: true,
            spaceId: true,
          },
        })
      : await this.createBase(spaceId, name, icon || undefined);
    this.logger.log(`base-duplicate-service: Duplicate base successfully`);

    // update base icon and name (skip when copying into an existing base)
    if (baseId && !isCopyToExistingBase) {
      await this.prismaService.txClient().base.update({
        where: { id: baseId },
        data: {
          name,
          icon,
        },
      });
    }

    // When copying into an existing base, strip dbTableName to avoid conflicts
    const effectiveTables = isCopyToExistingBase
      ? tables.map(({ dbTableName: _, ...rest }) => rest)
      : tables;

    // Skip computed field evaluation during structure creation — tables have no records yet,
    // and calculations will run when data is actually imported/copied.
    this.cls.set('skipFieldComputation', true);

    let tableIdMap: Record<string, string>;
    let fieldIdMap: Record<string, string>;
    let viewIdMap: Record<string, string>;
    let fkMap: Record<string, string>;

    try {
      // create table
      ({ tableIdMap, fieldIdMap, viewIdMap, fkMap } = await this.createTables(
        newBase.id,
        effectiveTables as IBaseJson['tables'],
        onProgress
      ));
    } finally {
      this.cls.set('skipFieldComputation', false);
    }

    this.logger.log(`base-duplicate-service: Duplicate base tables successfully`);

    // create plugins
    const hasPlugins = Object.values(plugins).some((arr) => Array.isArray(arr) && arr.length > 0);
    if (hasPlugins) {
      onProgress?.('creating_plugins');
    }
    const { dashboardIdMap } = await this.createPlugins(
      newBase.id,
      plugins,
      tableIdMap,
      fieldIdMap,
      viewIdMap
    );
    this.logger.log(`base-duplicate-service: Duplicate base plugins successfully`);

    // create folders
    if (Array.isArray(folders) && folders.length > 0) {
      onProgress?.('creating_folders');
    }
    const { folderIdMap } = await this.createFolders(newBase.id, folders, isCopyToExistingBase);
    this.logger.log(`base-duplicate-service: Duplicate base folders successfully`);

    let nodeIdMap: Record<string, string> = {};

    // create base nodes
    if (!skipCreateBaseNodes) {
      nodeIdMap = await this.createBaseNodes(
        newBase.id,
        structure.nodes,
        {
          folderIdMap,
          tableIdMap,
          dashboardIdMap,
        },
        isCopyToExistingBase
      );
    }

    const baseIdMap = {
      [structure.id]: newBase.id,
    };

    return {
      base: newBase,
      tableIdMap,
      fieldIdMap,
      viewIdMap,
      structure,
      fkMap,
      folderIdMap,
      dashboardIdMap,
      nodeIdMap,
      baseIdMap,
    };
  }

  private async createTables(
    baseId: string,
    tables: IBaseJson['tables'],
    onProgress?: BaseImportProgressCallback
  ) {
    const tableIdMap: Record<string, string> = {};
    // Build a name lookup: oldTableId → tableName
    const tableNameMap: Record<string, string> = {};

    for (const table of tables) {
      const { name, icon, description, id: tableId, dbTableName } = table;
      tableNameMap[tableId] = name;
      onProgress?.('creating_table', name);
      const newTableVo = await this.tableService.createTable(baseId, {
        name,
        icon,
        description,
        dbTableName,
      });
      tableIdMap[tableId] = newTableVo.id;
      this.logger.log(`base-duplicate-service: duplicate table item successfully`);
    }

    const { fieldMap: fieldIdMap, fkMap } = await this.createFields(
      tables,
      tableIdMap,
      tableNameMap,
      onProgress
    );
    this.logger.log(`base-duplicate-service: Duplicate table fields successfully`);

    const viewIdMap = await this.createViews(tables, tableIdMap, fieldIdMap, onProgress);
    this.logger.log(`base-duplicate-service: Duplicate table views successfully`);

    await this.fieldDuplicateService.repairFieldOptions(tables, tableIdMap, fieldIdMap, viewIdMap);

    return { tableIdMap, fieldIdMap, viewIdMap, fkMap };
  }

  private async createFields(
    tables: IBaseJson['tables'],
    tableIdMap: Record<string, string>,
    tableNameMap?: Record<string, string>,
    onProgress?: BaseImportProgressCallback
  ) {
    const fieldMap: Record<string, string> = {};
    const fkMap: Record<string, string> = {};

    const allFields = tables
      .reduce((acc, cur) => {
        const fieldWithTableId = cur.fields.map((field) => ({
          ...field,
          sourceTableId: cur.id,
          targetTableId: tableIdMap[cur.id],
        }));
        return [...acc, ...fieldWithTableId];
      }, [] as IFieldWithTableIdJson[])
      .sort((a, b) => a.createdTime.localeCompare(b.createdTime));

    const nonCommonFieldTypes = [
      FieldType.Link,
      FieldType.Rollup,
      FieldType.ConditionalRollup,
      FieldType.Formula,
      FieldType.Button,
    ];

    const commonFields = allFields.filter(
      ({ type, isLookup, aiConfig }) =>
        !nonCommonFieldTypes.includes(type) && !isLookup && !aiConfig
    );

    // the primary formula which rely on other fields
    const primaryFormulaFields = allFields.filter(
      ({ type, isLookup }) => type === FieldType.Formula && !isLookup
    );

    // link fields
    const linkFields = allFields.filter(
      ({ type, isLookup }) => type === FieldType.Link && !isLookup
    );

    const buttonFields = allFields.filter(
      ({ type, isLookup }) => type === FieldType.Button && !isLookup
    );

    // rest fields, like formula, rollup, lookup fields
    const dependencyFields = allFields.filter(
      ({ id }) =>
        ![...primaryFormulaFields, ...linkFields, ...commonFields, ...buttonFields]
          .map(({ id }) => id)
          .includes(id)
    );

    const primaryDependencyFields = dependencyFields.filter(({ isPrimary, aiConfig, isLookup }) =>
      Boolean(isPrimary && aiConfig && !isLookup)
    );

    // helper: emit per-table progress with field names
    const emitFieldProgress = (
      phase: string,
      fields: { sourceTableId: string; name: string }[]
    ) => {
      if (!fields.length || !onProgress) return;
      const byTable = new Map<string, string[]>();
      for (const f of fields) {
        const tableName = tableNameMap?.[f.sourceTableId] ?? f.sourceTableId;
        if (!byTable.has(tableName)) byTable.set(tableName, []);
        byTable.get(tableName)!.push(f.name);
      }
      for (const [table, fieldNames] of byTable) {
        onProgress(phase, JSON.stringify({ table, fields: fieldNames.join(', ') }));
      }
    };

    emitFieldProgress('creating_common_fields', commonFields);
    await this.fieldDuplicateService.createCommonFields(commonFields, fieldMap);

    emitFieldProgress('creating_button_fields', buttonFields);
    await this.fieldDuplicateService.createButtonFields(buttonFields, fieldMap);

    emitFieldProgress('creating_formula_fields', primaryFormulaFields);
    await this.fieldDuplicateService.createTmpPrimaryFormulaFields(primaryFormulaFields, fieldMap);

    // main fix formula dbField type
    await this.fieldDuplicateService.repairPrimaryFormulaFields(primaryFormulaFields, fieldMap);

    // Some valid primary fields are deferred to dependency creation, for example
    // AI-config primaries. Bootstrap them before two-way link creation so
    // generateSymmetricField can always resolve the current table primary.
    emitFieldProgress('creating_primary_dependency_fields', primaryDependencyFields);
    await this.fieldDuplicateService.bootstrapPrimaryDependencyFields(
      primaryDependencyFields,
      fieldMap
    );

    emitFieldProgress('creating_link_fields', linkFields);
    await this.fieldDuplicateService.createLinkFields(linkFields, tableIdMap, fieldMap, fkMap);

    emitFieldProgress('creating_lookup_fields', dependencyFields);
    await this.fieldDuplicateService.createDependencyFields(dependencyFields, tableIdMap, fieldMap);

    // fix formula expression' field map
    await this.fieldDuplicateService.repairPrimaryFormulaFields(primaryFormulaFields, fieldMap);

    const formulaFields = allFields.filter(
      ({ type, isLookup }) => type === FieldType.Formula && !isLookup
    );

    // fix formula reference
    await this.fieldDuplicateService.repairFormulaReference(formulaFields, fieldMap);

    return { fieldMap, fkMap };
  }

  /* eslint-disable sonarjs/cognitive-complexity */
  private async createViews(
    tables: IBaseJson['tables'],
    tableIdMap: Record<string, string>,
    fieldMap: Record<string, string>,
    onProgress?: BaseImportProgressCallback
  ) {
    const viewMap: Record<string, string> = {};
    for (const table of tables) {
      const { views: originalViews, id: tableId, name: tableName } = table;
      const views = originalViews.filter((view) => view.type !== ViewType.Plugin);
      if (views.length) {
        const viewNames = views.map((v) => v.name).join(', ');
        onProgress?.(
          'creating_table_views',
          JSON.stringify({ table: tableName, fields: viewNames })
        );
      }
      for (const view of views) {
        const {
          name,
          type,
          id: viewId,
          description,
          enableShare,
          isLocked,
          order,
          columnMeta,
          shareMeta,
          shareId,
        } = view;

        const keys = ['options', 'columnMeta', 'filter', 'group', 'sort'] as (keyof typeof view)[];
        const obj = {} as Record<string, unknown>;

        for (const key of keys) {
          const keyString = replaceStringByMap(view[key], { fieldMap });
          const newValue = keyString ? JSON.parse(keyString) : null;
          obj[key] = newValue;
        }
        const newViewVo = await this.viewOpenApiService.createView(tableIdMap[tableId], {
          name,
          type,
          description,
          enableShare,
          isLocked,
          ...obj,
        });

        viewMap[viewId] = newViewVo.id;

        await this.prismaService.txClient().view.update({
          where: {
            id: newViewVo.id,
          },
          data: {
            order,
            columnMeta: columnMeta ? replaceStringByMap(columnMeta, { fieldMap }) : columnMeta,
            shareId: shareId ? generateShareId() : undefined,
            shareMeta: shareMeta ? JSON.stringify(shareMeta) : undefined,
            enableShare,
            isLocked,
          },
        });
      }
    }

    return viewMap;
  }

  private async createFolders(
    baseId: string,
    folders: IBaseJson['folders'],
    copyToExistingBase: boolean = false
  ) {
    const folderIdMap: Record<string, string> = {};
    if (!Array.isArray(folders) || folders.length === 0) {
      return { folderIdMap };
    }
    const prisma = this.prismaService.txClient();
    const userId = this.cls.get('user.id');

    const existingNames: string[] = [];
    if (copyToExistingBase) {
      const existingFolders = await prisma.baseNodeFolder.findMany({
        where: { baseId },
        select: { name: true },
      });
      existingNames.push(...existingFolders.map((f) => f.name));
    }

    for (const folder of folders) {
      const { id, name } = folder;
      const uniqueName = copyToExistingBase ? getUniqName(name, existingNames) : name;
      if (copyToExistingBase) {
        existingNames.push(uniqueName);
      }

      const newFolderId = generateBaseNodeFolderId();
      await prisma.baseNodeFolder.create({
        data: { id: newFolderId, name: uniqueName, baseId, createdBy: userId },
      });
      folderIdMap[id] = newFolderId;
    }
    return { folderIdMap };
  }

  async createBaseNodes(
    baseId: string,
    nodes: IBaseJson['nodes'],
    idMapContext: {
      folderIdMap?: Record<string, string>;
      tableIdMap?: Record<string, string>;
      dashboardIdMap?: Record<string, string>;
      workflowIdMap?: Record<string, string>;
      appIdMap?: Record<string, string>;
    },
    copyToExistingBase: boolean = false,
    options?: {
      updateExistingNodes?: boolean;
    }
  ) {
    if (!Array.isArray(nodes) || nodes.length === 0) {
      return {} as Record<string, string>;
    }

    const prisma = this.prismaService.txClient();
    const userId = this.cls.get('user.id');
    const {
      folderIdMap = {},
      tableIdMap = {},
      dashboardIdMap = {},
      workflowIdMap = {},
      appIdMap = {},
    } = idMapContext;

    const allNodeIdMap = nodes.reduce(
      (acc, cur) => {
        acc[cur.id] = generateBaseNodeId();
        return acc;
      },
      {} as Record<string, string>
    );

    const allTypeNodeIdMap = nodes.reduce(
      (acc, cur) => {
        const { resourceType, resourceId } = cur;
        acc[resourceType] = acc[resourceType] ?? {};
        switch (resourceType) {
          case BaseNodeResourceType.Folder:
            acc[resourceType][resourceId] = folderIdMap[resourceId];
            break;
          case BaseNodeResourceType.Table:
            acc[resourceType][resourceId] = tableIdMap[resourceId];
            break;
          case BaseNodeResourceType.Dashboard:
            acc[resourceType][resourceId] = dashboardIdMap[resourceId];
            break;
          case BaseNodeResourceType.Workflow:
            acc[resourceType][resourceId] = workflowIdMap[resourceId];
            break;
          case BaseNodeResourceType.App:
            acc[resourceType][resourceId] = appIdMap[resourceId];
            break;
          default:
            break;
        }
        return acc;
      },
      {} as Record<BaseNodeResourceType, Record<string, string>>
    );
    // Sort nodes by parent-child relationship (topological sort)
    // Ensure parent nodes are created before child nodes
    const sortedNodes: typeof nodes = [];
    const nodeMap = new Map(nodes.map((node) => [node.id, node]));
    const visited = new Set<string>();

    const visit = (node: (typeof nodes)[0]) => {
      if (visited.has(node.id)) return;
      if (node.parentId && nodeMap.has(node.parentId)) {
        visit(nodeMap.get(node.parentId)!);
      }
      visited.add(node.id);
      sortedNodes.push(node);
    };

    for (const node of nodes) {
      visit(node);
    }

    // Deduplicate nodes by (resourceType, newResourceId) to avoid unique constraint violations
    const createdResourceKeys = new Set<string>();

    let rootOrderOffset = 0;
    if (copyToExistingBase) {
      const maxOrderResult = await prisma.baseNode.aggregate({
        where: { baseId, parentId: null },
        _max: { order: true },
      });
      rootOrderOffset = (maxOrderResult._max.order ?? 0) + 1;
    }

    for (const node of sortedNodes) {
      const { id, parentId, resourceId, resourceType, order } = node;
      const newId = allNodeIdMap[id];
      const newParentId = parentId && allNodeIdMap[parentId] ? allNodeIdMap[parentId] : null;
      const newResourceId =
        allTypeNodeIdMap[resourceType] && allTypeNodeIdMap[resourceType][resourceId]
          ? allTypeNodeIdMap[resourceType][resourceId]
          : null;
      if (!newResourceId) {
        this.logger.error(
          `base-import-service: create base node failed, nodeId: ${id}, resourceId: ${resourceId}, resourceType: ${resourceType}`
        );
        continue;
      }

      // Check if this (baseId, resourceType, resourceId) combination already exists in this batch
      const resourceKey = `${baseId}:${resourceType}:${newResourceId}`;
      if (createdResourceKeys.has(resourceKey)) {
        this.logger.warn(
          `base-import-service: skipping duplicate node in batch, baseId: ${baseId}, resourceType: ${resourceType}, resourceId: ${newResourceId}`
        );
        continue;
      }

      const effectiveOrder = newParentId ? order : order + rootOrderOffset;

      // Check if node already exists in database (could be created by prepareNodeList self-healing)
      const existingNode = await prisma.baseNode.findFirst({
        where: {
          baseId,
          resourceType,
          resourceId: newResourceId,
        },
      });

      if (existingNode && (copyToExistingBase || options?.updateExistingNodes)) {
        await prisma.baseNode.update({
          where: { id: existingNode.id },
          data: { parentId: newParentId, order: effectiveOrder },
        });
        allNodeIdMap[id] = existingNode.id;
        createdResourceKeys.add(resourceKey);
        continue;
      }

      if (existingNode) {
        this.logger.warn(
          `base-import-service: node already exists in database, baseId: ${baseId}, resourceType: ${resourceType}, resourceId: ${newResourceId}`
        );
        createdResourceKeys.add(resourceKey);
        continue;
      }

      await prisma.baseNode.create({
        data: {
          id: newId,
          parentId: newParentId,
          resourceId: newResourceId,
          resourceType,
          baseId,
          createdBy: userId,
          order: effectiveOrder,
        },
      });

      createdResourceKeys.add(resourceKey);
    }

    return allNodeIdMap;
  }

  private async createPlugins(
    baseId: string,
    plugins: IBaseJson['plugins'],
    tableIdMap: Record<string, string>,
    fieldMap: Record<string, string>,
    viewIdMap: Record<string, string>
  ) {
    const { dashboardIdMap } = await this.createDashboard(
      baseId,
      plugins[PluginPosition.Dashboard],
      tableIdMap,
      fieldMap
    );
    await this.createPanel(baseId, plugins[PluginPosition.Panel], tableIdMap, fieldMap);
    await this.createPluginViews(
      baseId,
      plugins[PluginPosition.View],
      tableIdMap,
      fieldMap,
      viewIdMap
    );
    return { dashboardIdMap };
  }

  async createDashboard(
    baseId: string,
    plugins: IBaseJson['plugins'][PluginPosition.Dashboard],
    tableMap: Record<string, string>,
    fieldMap: Record<string, string>
  ) {
    const dashboardMap: Record<string, string> = {};
    const pluginInstallMap: Record<string, string> = {};
    const userId = this.cls.get('user.id');
    const prisma = this.prismaService.txClient();
    const pluginInstalls = plugins.map(({ pluginInstall }) => pluginInstall).flat();

    for (const plugin of plugins) {
      const { id, name } = plugin;
      const newDashBoardId = generateDashboardId();
      await prisma.dashboard.create({
        data: {
          id: newDashBoardId,
          baseId,
          name,
          createdBy: userId,
        },
      });
      dashboardMap[id] = newDashBoardId;
    }

    for (const pluginInstall of pluginInstalls) {
      const { id, pluginId, positionId, position, name, storage } = pluginInstall;
      const newPluginInstallId = generatePluginInstallId();
      const newStorage = replaceStringByMap(storage, { tableMap, fieldMap });
      await prisma.pluginInstall.create({
        data: {
          id: newPluginInstallId,
          createdBy: userId,
          baseId,
          pluginId,
          name,
          positionId: dashboardMap[positionId],
          position,
          storage: newStorage,
        },
      });
      pluginInstallMap[id] = newPluginInstallId;
    }

    // replace pluginId in layout with new pluginInstallId
    for (const plugin of plugins) {
      const { id, layout } = plugin;
      const newLayout = replaceStringByMap(layout, { pluginInstallMap });
      await prisma.dashboard.update({
        where: { id: dashboardMap[id] },
        data: {
          layout: newLayout,
        },
      });
    }

    return {
      dashboardIdMap: dashboardMap,
    };
  }

  async createPanel(
    baseId: string,
    plugins: IBaseJson['plugins'][PluginPosition.Panel],
    tableMap: Record<string, string>,
    fieldMap: Record<string, string>
  ) {
    const panelMap: Record<string, string> = {};
    const pluginInstallMap: Record<string, string> = {};
    const userId = this.cls.get('user.id');
    const prisma = this.prismaService.txClient();
    const pluginInstalls = plugins.map(({ pluginInstall }) => pluginInstall).flat();

    for (const plugin of plugins) {
      const { id, name, tableId } = plugin;
      const newPluginPanelId = generatePluginPanelId();
      await prisma.pluginPanel.create({
        data: {
          id: newPluginPanelId,
          tableId: tableMap[tableId],
          name,
          createdBy: userId,
        },
      });
      panelMap[id] = newPluginPanelId;
    }

    for (const pluginInstall of pluginInstalls) {
      const { id, pluginId, positionId, position, name, storage } = pluginInstall;
      const newPluginInstallId = generatePluginInstallId();
      const newStorage = replaceStringByMap(storage, { tableMap, fieldMap });
      await prisma.pluginInstall.create({
        data: {
          id: newPluginInstallId,
          createdBy: userId,
          baseId,
          pluginId,
          name,
          positionId: panelMap[positionId],
          position,
          storage: newStorage,
        },
      });
      pluginInstallMap[id] = newPluginInstallId;
    }

    // replace pluginId in layout with new pluginInstallId
    for (const plugin of plugins) {
      const { id, layout } = plugin;
      const newLayout = replaceStringByMap(layout, { pluginInstallMap });
      await prisma.pluginPanel.update({
        where: { id: panelMap[id] },
        data: {
          layout: newLayout,
        },
      });
    }

    return {
      panelMap,
    };
  }

  private async createPluginViews(
    baseId: string,
    pluginViews: IBaseJson['plugins'][PluginPosition.View],
    tableIdMap: Record<string, string>,
    fieldIdMap: Record<string, string>,
    viewIdMap: Record<string, string>
  ) {
    const prisma = this.prismaService.txClient();

    for (const pluginView of pluginViews) {
      const {
        id,
        name,
        description,
        enableShare,
        shareMeta,
        isLocked,
        tableId,
        pluginInstall,
        order,
      } = pluginView;
      if (viewIdMap[id]) {
        continue;
      }
      const { pluginId } = pluginInstall;
      const { viewId: newViewId, pluginInstallId } = await this.viewOpenApiService.pluginInstall(
        tableIdMap[tableId],
        {
          name,
          pluginId,
        }
      );
      viewIdMap[id] = newViewId;

      await prisma.view.update({
        where: { id: newViewId },
        data: {
          order,
        },
      });

      // 1. update view options
      const configProperties = ['columnMeta', 'options', 'sort', 'group', 'filter'] as const;
      const updateConfig = {} as Record<(typeof configProperties)[number], string>;
      for (const property of configProperties) {
        const result = replaceStringByMap(pluginView[property], {
          tableIdMap,
          fieldIdMap,
          viewIdMap,
        });

        if (result) {
          updateConfig[property] = result;
        }
      }
      await prisma.view.update({
        where: { id: newViewId },
        data: {
          description,
          isLocked,
          enableShare,
          shareMeta: shareMeta ? JSON.stringify(shareMeta) : undefined,
          ...updateConfig,
        },
      });

      // 2. update plugin install
      const newStorage = replaceStringByMap(pluginInstall.storage, {
        tableIdMap,
        fieldIdMap,
        viewIdMap,
      });
      await prisma.pluginInstall.update({
        where: { id: pluginInstallId },
        data: {
          storage: newStorage,
        },
      });
    }
  }
}
