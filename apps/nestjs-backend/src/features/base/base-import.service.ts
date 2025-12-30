import type { Readable } from 'stream';
import { Injectable, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import {
  FieldType,
  generateBaseId,
  generateBaseNodeFolderId,
  generateBaseNodeId,
  generateDashboardId,
  generateLogId,
  generatePluginInstallId,
  generatePluginPanelId,
  generateShareId,
  ViewType,
} from '@teable/core';
import { PrismaService } from '@teable/db-main-prisma';
import type {
  ICreateBaseVo,
  IBaseJson,
  ImportBaseRo,
  IFieldWithTableIdJson,
} from '@teable/openapi';
import {
  UploadType,
  PluginPosition,
  BaseNodeResourceType,
  BaseDuplicateMode,
} from '@teable/openapi';

import { Knex } from 'knex';
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
import { ViewOpenApiService } from '../view/open-api/view-open-api.service';
import { BaseImportAttachmentsQueueProcessor } from './base-import-processor/base-import-attachments.processor';
import { BaseImportCsvQueueProcessor } from './base-import-processor/base-import-csv.processor';
import { replaceStringByMap } from './utils';

@Injectable()
export class BaseImportService {
  private logger = new Logger(BaseImportService.name);

  constructor(
    private readonly prismaService: PrismaService,
    private readonly cls: ClsService<IClsStore>,
    private readonly tableService: TableService,
    private readonly fieldDuplicateService: FieldDuplicateService,
    private readonly viewOpenApiService: ViewOpenApiService,
    private readonly baseImportAttachmentsQueueProcessor: BaseImportAttachmentsQueueProcessor,
    private readonly baseImportCsvQueueProcessor: BaseImportCsvQueueProcessor,
    @InjectModel('CUSTOM_KNEX') private readonly knex: Knex,
    @InjectDbProvider() private readonly dbProvider: IDbProvider,
    @InjectStorageAdapter() private readonly storageAdapter: StorageAdapter,
    @ThresholdConfig() private readonly thresholdConfig: IThresholdConfig,
    private readonly eventEmitter: EventEmitter2
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

    return this.prismaService.$tx(async (prisma) => {
      const order = (await this.getMaxOrder(spaceId)) + 1;

      const base = await prisma.base.create({
        data: {
          id: generateBaseId(),
          name: name || 'Untitled Base',
          spaceId,
          order,
          icon,
          createdBy: userId,
        },
        select: {
          id: true,
          name: true,
          icon: true,
          spaceId: true,
        },
      });

      const sqlList = this.dbProvider.createSchema(base.id);
      if (sqlList) {
        for (const sql of sqlList) {
          await prisma.$executeRawUnsafe(sql);
        }
      }

      return base;
    });
  }

  async importBase(importBaseRo: ImportBaseRo) {
    const {
      notify: { path },
    } = importBaseRo;

    // 1. create base structure from json
    const structureStream = await this.storageAdapter.downloadFile(
      StorageAdapter.getBucket(UploadType.Import),
      path
    );

    const { base, tableIdMap, viewIdMap, fieldIdMap, fkMap, structure, ...rest } =
      await this.prismaService.$tx(
        async () => {
          return await this.processStructure(structureStream, importBaseRo);
        },
        {
          timeout: this.thresholdConfig.bigTransactionTimeout,
        }
      );

    // 2. upload attachments
    this.uploadAttachments(path);

    // 3. create import table data task
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

  private async processStructure(
    zipStream: Readable,
    importBaseRo: ImportBaseRo
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
                const result = await this.createBaseStructure(spaceId, structureObject!, undefined);
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
    duplicateMode: BaseDuplicateMode = BaseDuplicateMode.Normal
  ) {
    const { name, icon, tables, plugins, folders } = structure;

    // create base
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

    // update base icon and name
    if (baseId) {
      await this.prismaService.txClient().base.update({
        where: { id: baseId },
        data: {
          name,
          icon,
        },
      });
    }

    // create table
    const { tableIdMap, fieldIdMap, viewIdMap, fkMap } = await this.createTables(
      newBase.id,
      tables
    );

    this.logger.log(`base-duplicate-service: Duplicate base tables successfully`);

    // create plugins
    const { dashboardIdMap } = await this.createPlugins(
      newBase.id,
      plugins,
      tableIdMap,
      fieldIdMap,
      viewIdMap
    );
    this.logger.log(`base-duplicate-service: Duplicate base plugins successfully`);

    // create folders
    const { folderIdMap } = await this.createFolders(newBase.id, folders);
    this.logger.log(`base-duplicate-service: Duplicate base folders successfully`);

    let nodeIdMap: Record<string, string> = {};

    // create base nodes
    if (!skipCreateBaseNodes) {
      nodeIdMap = await this.createBaseNodes(newBase.id, structure.nodes, {
        folderIdMap,
        tableIdMap,
        dashboardIdMap,
      });
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

  private async createTables(baseId: string, tables: IBaseJson['tables']) {
    const tableIdMap: Record<string, string> = {};

    for (const table of tables) {
      const { name, icon, description, id: tableId, dbTableName } = table;
      const newTableVo = await this.tableService.createTable(baseId, {
        name,
        icon,
        description,
        dbTableName,
      });
      tableIdMap[tableId] = newTableVo.id;
      this.logger.log(`base-duplicate-service: duplicate table item successfully`);
    }

    const { fieldMap: fieldIdMap, fkMap } = await this.createFields(tables, tableIdMap);
    this.logger.log(`base-duplicate-service: Duplicate table fields successfully`);

    const viewIdMap = await this.createViews(tables, tableIdMap, fieldIdMap);
    this.logger.log(`base-duplicate-service: Duplicate table views successfully`);

    await this.fieldDuplicateService.repairFieldOptions(tables, tableIdMap, fieldIdMap, viewIdMap);

    return { tableIdMap, fieldIdMap, viewIdMap, fkMap };
  }

  private async createFields(tables: IBaseJson['tables'], tableIdMap: Record<string, string>) {
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

    await this.fieldDuplicateService.createCommonFields(commonFields, fieldMap);

    await this.fieldDuplicateService.createButtonFields(buttonFields, fieldMap);

    await this.fieldDuplicateService.createTmpPrimaryFormulaFields(primaryFormulaFields, fieldMap);

    // main fix formula dbField type
    await this.fieldDuplicateService.repairPrimaryFormulaFields(primaryFormulaFields, fieldMap);

    await this.fieldDuplicateService.createLinkFields(linkFields, tableIdMap, fieldMap, fkMap);

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
    fieldMap: Record<string, string>
  ) {
    const viewMap: Record<string, string> = {};
    for (const table of tables) {
      const { views: originalViews, id: tableId } = table;
      const views = originalViews.filter((view) => view.type !== ViewType.Plugin);
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

  private async createFolders(baseId: string, folders: IBaseJson['folders']) {
    const folderIdMap: Record<string, string> = {};
    if (!Array.isArray(folders) || folders.length === 0) {
      return { folderIdMap };
    }
    const prisma = this.prismaService.txClient();
    const userId = this.cls.get('user.id');
    for (const folder of folders) {
      const { id, name } = folder;
      const newFolderId = generateBaseNodeFolderId();
      await prisma.baseNodeFolder.create({
        data: { id: newFolderId, name, baseId, createdBy: userId },
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

      // Check if node already exists in database (could be created by listener)
      const existingNode = await prisma.baseNode.findFirst({
        where: {
          baseId,
          resourceType,
          resourceId: newResourceId,
        },
      });

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
          order,
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
