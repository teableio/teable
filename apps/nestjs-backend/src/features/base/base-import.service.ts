import type { Readable } from 'stream';
import { Injectable, Logger } from '@nestjs/common';
import {
  FieldType,
  generateBaseId,
  generateDashboardId,
  generatePluginInstallId,
  generatePluginPanelId,
  generateShareId,
  Role,
  ViewType,
} from '@teable/core';
import { PrismaService } from '@teable/db-main-prisma';
import { UploadType, PluginPosition, PrincipalType, ResourceType } from '@teable/openapi';
import type {
  ICreateBaseVo,
  IBaseJson,
  ImportBaseRo,
  IFieldWithTableIdJson,
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
    @ThresholdConfig() private readonly thresholdConfig: IThresholdConfig
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
    // 1. create base structure from json
    // 2. upload attachments
    // 3. create import table data task
    const structureStream = await this.storageAdapter.downloadFile(
      StorageAdapter.getBucket(UploadType.Import),
      importBaseRo.notify.path
    );

    const { base, tableIdMap, viewIdMap, fieldIdMap, structure, fkMap } =
      await this.prismaService.$tx(
        async () => {
          return await this.processStructure(structureStream, importBaseRo);
        },
        {
          timeout: this.thresholdConfig.bigTransactionTimeout,
        }
      );

    this.uploadAttachments(importBaseRo.notify.path);

    this.appendTableData(
      importBaseRo.notify.path,
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
                const result = await this.createBaseStructure(spaceId, structureObject!);
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
    path: string,
    tableIdMap: Record<string, string>,
    fieldIdMap: Record<string, string>,
    viewIdMap: Record<string, string>,
    fkMap: Record<string, string>,
    structure: IBaseJson
  ) {
    const userId = this.cls.get('user.id');
    await this.baseImportCsvQueueProcessor.queue.add(
      'base_import_csv',
      {
        path,
        userId,
        tableIdMap,
        fieldIdMap,
        viewIdMap,
        fkMap,
        structure,
      },
      {
        jobId: `import_csv_${path}_${userId}`,
      }
    );
  }

  async createBaseStructure(spaceId: string, structure: IBaseJson, baseId?: string) {
    const { name, icon, tables, plugins } = structure;

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
    await this.createPlugins(newBase.id, plugins, tableIdMap, fieldIdMap, viewIdMap);
    this.logger.log(`base-duplicate-service: Duplicate base plugins successfully`);

    return {
      base: newBase,
      tableIdMap,
      fieldIdMap,
      viewIdMap,
      structure,
      fkMap,
    };
  }

  private async createTables(baseId: string, tables: IBaseJson['tables']) {
    const tableIdMap: Record<string, string> = {};

    for (const table of tables) {
      const { name, icon, description, id: tableId } = table;
      const newTableVo = await this.tableService.createTable(baseId, {
        name,
        icon,
        description,
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

  private async createPlugins(
    baseId: string,
    plugins: IBaseJson['plugins'],
    tableIdMap: Record<string, string>,
    fieldMap: Record<string, string>,
    viewIdMap: Record<string, string>
  ) {
    await this.createDashboard(baseId, plugins[PluginPosition.Dashboard], tableIdMap, fieldMap);
    await this.createPanel(baseId, plugins[PluginPosition.Panel], tableIdMap, fieldMap);
    await this.createPluginViews(
      baseId,
      plugins[PluginPosition.View],
      tableIdMap,
      fieldMap,
      viewIdMap
    );
  }

  async createDashboard(
    baseId: string,
    plugins: IBaseJson['plugins'][PluginPosition.Dashboard],
    tableMap: Record<string, string>,
    fieldMap: Record<string, string>,
    inSameBase: boolean = false
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

    if (!inSameBase) {
      // create char user to collaborator
      await prisma.collaborator.create({
        data: {
          roleName: Role.Owner,
          createdBy: userId,
          resourceId: baseId,
          resourceType: ResourceType.Base,
          principalType: PrincipalType.User,
          principalId: 'pluchartuser',
        },
      });
    }

    return {
      dashboardMap,
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
