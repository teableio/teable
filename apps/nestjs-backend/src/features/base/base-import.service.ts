import type { Readable } from 'node:stream';
import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import {
  FieldType,
  fieldVoSchema,
  generateBaseId,
  generateBaseNodeFolderId,
  generateBaseNodeId,
  generateDashboardId,
  generatePluginInstallId,
  generatePluginPanelId,
  generateShareId,
  getUniqName,
  HttpErrorCode,
  pluginViewOptionSchema,
  ViewType,
} from '@teable/core';
import { PrismaService, ProvisionState } from '@teable/db-main-prisma';
import type { ICreateBaseVo, IBaseJson, IFieldWithTableIdJson } from '@teable/openapi';
import {
  UploadType,
  PluginPosition,
  BaseNodeResourceType,
  BaseDuplicateMode,
  isCopyToExistingBaseMode,
  CreateRecordAction,
  ImportBaseRo,
  tableFullVoSchema,
} from '@teable/openapi';
import { ClsService } from 'nestjs-cls';
import { IThresholdConfig, ThresholdConfig } from '../../configs/threshold.config';
import { CustomHttpException } from '../../custom.exception';
import { InjectDbProvider } from '../../db-provider/db.provider';
import { IDbProvider } from '../../db-provider/db.provider.interface';
import { DataDbClientManager } from '../../global/data-db-client-manager.service';
import type { IDataDbRoutingOptions } from '../../global/data-db-client-manager.service';
import { V1Engine } from '../../tracing/decorators/v1-engine';
import type { IClsStore } from '../../types/cls';
import StorageAdapter from '../attachments/plugins/adapter';
import { InjectStorageAdapter } from '../attachments/plugins/storage';
import { AuditScope } from '../audit/audit-scope';
import { Audit } from '../audit/audit.decorator';
import { FieldDuplicateService } from '../field/field-duplicate/field-duplicate.service';
import { NotificationService } from '../notification/notification.service';
import { RecordMutationPolicyService } from '../record-mutation-policy/record-mutation-policy.service';
import { SpaceDataDbMigrationGuardService } from '../space/space-data-db-migration-guard.service';
import { TableService } from '../table/table.service';
import { ViewOpenApiService } from '../view/open-api/view-open-api.service';
import { auditBaseCreated } from './base-create-audit';
import type { BaseImportProgressCallback } from './base-import-contract';
import { BaseImportAttachmentsQueueProcessor } from './base-import-processor/base-import-attachments.processor';
import { BaseImportCsvQueueProcessor } from './base-import-processor/base-import-csv.processor';
import { DotTeaStructureError, readDotTeaStructureJson } from './dottea-structure-reader';
import { replaceStringByMap } from './utils';

type IDataPrismaExecutor = {
  $executeRawUnsafe(query: string, ...values: unknown[]): Promise<number>;
};

type IDataPrismaScopedClient = IDataPrismaExecutor & {
  txClient?: () => IDataPrismaExecutor;
};

type BaseImportNodeIdMaps = {
  folderIdMap?: Record<string, string>;
  tableIdMap?: Record<string, string>;
  dashboardIdMap?: Record<string, string>;
  workflowIdMap?: Record<string, string>;
  appIdMap?: Record<string, string>;
  routineIdMap?: Record<string, string>;
};

const remapPluginViewOptions = (
  options: unknown,
  maps: Record<string, Record<string, string>>,
  pluginId: string,
  pluginInstallId: string
): string => {
  const remappedOptions = replaceStringByMap(options, maps, false) as
    | { pluginLogo?: unknown }
    | undefined;
  return JSON.stringify(
    pluginViewOptionSchema.parse({
      pluginId,
      pluginInstallId,
      pluginLogo: typeof remappedOptions?.pluginLogo === 'string' ? remappedOptions.pluginLogo : '',
    })
  );
};

@Injectable()
export class BaseImportService {
  private readonly logger = new Logger(BaseImportService.name);

  constructor(
    private readonly prismaService: PrismaService,
    private readonly cls: ClsService<IClsStore>,
    private readonly tableService: TableService,
    private readonly fieldDuplicateService: FieldDuplicateService,
    private readonly viewOpenApiService: ViewOpenApiService,
    private readonly baseImportAttachmentsQueueProcessor: BaseImportAttachmentsQueueProcessor,
    private readonly baseImportCsvQueueProcessor: BaseImportCsvQueueProcessor,
    @InjectDbProvider() private readonly dbProvider: IDbProvider,
    @InjectStorageAdapter() private readonly storageAdapter: StorageAdapter,
    @ThresholdConfig() private readonly thresholdConfig: IThresholdConfig,
    private readonly dataDbClientManager: DataDbClientManager,
    private readonly audit: AuditScope,
    private readonly notificationService: NotificationService,
    @Optional()
    @Inject(SpaceDataDbMigrationGuardService)
    private readonly spaceDataDbMigrationGuard: SpaceDataDbMigrationGuardService | undefined,
    private readonly recordMutationPolicy: RecordMutationPolicyService
  ) {}

  private async assertSpaceWritable(spaceId: string) {
    await this.spaceDataDbMigrationGuard?.assertSpaceWritable(spaceId);
  }

  private async getMaxOrder(spaceId: string) {
    const spaceAggregate = await this.prismaService.txClient().base.aggregate({
      where: { spaceId, deletedTime: null },
      _max: { order: true },
    });
    return spaceAggregate._max.order || 0;
  }

  private async createBase(
    spaceId: string,
    name: string,
    icon?: string,
    routingOptions?: IDataDbRoutingOptions
  ) {
    await this.assertSpaceWritable(spaceId);
    const userId = this.cls.get('user.id');
    const order = (await this.getMaxOrder(spaceId)) + 1;

    const base = await this.prismaService.txClient().base.create({
      data: {
        id: generateBaseId(),
        name: name?.trim() || null,
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
        const scopedDataPrisma = (await this.dataDbClientManager.dataPrismaForSpace(
          spaceId,
          routingOptions
        )) as IDataPrismaScopedClient;
        const dataPrisma = scopedDataPrisma.txClient?.() ?? scopedDataPrisma;
        for (const sql of sqlList) {
          // Keep schema creation visible to the subsequent data-plane DDL/insert steps even when
          // import structure creation is wrapped in an outer shared meta transaction.
          await dataPrisma.$executeRawUnsafe(sql);
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

  /** Host extensions can reject incomplete resources before any destination write. */
  protected async preflightExtraBaseResources(
    _structure: IBaseJson,
    _archivePath: string
  ): Promise<void> {
    // Community has no extra resources to validate.
  }

  @V1Engine()
  @Audit({
    rootAction: CreateRecordAction.BaseImport,
    resourceId: (ro: ImportBaseRo) => ro.spaceId,
  })
  async importBase(importBaseRo: ImportBaseRo, onProgress?: BaseImportProgressCallback) {
    const {
      spaceId,
      notify: { path },
    } = importBaseRo;
    await this.assertSpaceWritable(spaceId);
    const logId = this.audit.current()!.operationId;

    onProgress?.('parsing_structure');

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

    // The import routes answer over SSE or lost the controller BASE_CREATE event (EE override),
    // so the new base is recorded here, under the `base.import` operation.
    await auditBaseCreated(this.audit, base);

    onProgress?.('structure_created', base.id);

    onProgress?.('queuing_attachments');
    await this.uploadAttachments(path);

    onProgress?.('queuing_data_import');
    await this.appendTableData(
      base.id,
      importBaseRo,
      path,
      tableIdMap,
      fieldIdMap,
      viewIdMap,
      fkMap,
      structure,
      logId,
      rest
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
      // Added by the EE `createBaseStructure` override (apps); absent in community.
      appIdMap?: Record<string, string>;
      baseIdMap?: Record<string, string>;
    };
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

  private mapPluginViewConfig(
    pluginView: IBaseJson['plugins'][PluginPosition.View][number],
    tableIdMap: Record<string, string>,
    fieldIdMap: Record<string, string>,
    viewIdMap: Record<string, string>,
    pluginInstallId: string
  ) {
    const configMaps = { tableIdMap, fieldIdMap, viewIdMap };
    return {
      sort: replaceStringByMap(pluginView.sort, configMaps) ?? null,
      filter: replaceStringByMap(pluginView.filter, configMaps) ?? null,
      group: replaceStringByMap(pluginView.group, configMaps) ?? null,
      columnMeta: replaceStringByMap(pluginView.columnMeta, configMaps) ?? JSON.stringify({}),
      options: remapPluginViewOptions(
        pluginView.options,
        configMaps,
        pluginView.pluginInstall.pluginId,
        pluginInstallId
      ),
      storage: replaceStringByMap(pluginView.pluginInstall.storage, configMaps),
    };
  }

  /**
   * `structure.json` is user-supplied, and `dbTableName` / `dbFieldName` end up
   * as raw SQL identifiers, so they must satisfy the same rules the create
   * routes enforce before any table or column is created from them.
   * Teable-generated archives always contain slugified names; only a
   * hand-edited archive is rejected here.
   */
  private validateStructureDbIdentifiers(structure: IBaseJson) {
    const dbTableNameSchema = tableFullVoSchema.shape.dbTableName;
    const dbFieldNameSchema = fieldVoSchema.shape.dbFieldName;
    for (const table of structure.tables ?? []) {
      if (table.dbTableName != null && !dbTableNameSchema.safeParse(table.dbTableName).success) {
        throw new CustomHttpException(
          `Invalid dbTableName "${table.dbTableName}" for table ${table.id}`,
          HttpErrorCode.VALIDATION_ERROR
        );
      }
      for (const field of table.fields ?? []) {
        if (field.dbFieldName != null && !dbFieldNameSchema.safeParse(field.dbFieldName).success) {
          throw new CustomHttpException(
            `Invalid dbFieldName "${field.dbFieldName}" for field ${field.id}`,
            HttpErrorCode.VALIDATION_ERROR
          );
        }
      }
    }
  }

  private async readDotTeaStructure(zipStream: Readable): Promise<IBaseJson> {
    let structure: unknown;
    try {
      structure = await readDotTeaStructureJson(zipStream);
    } catch (error) {
      if (error instanceof DotTeaStructureError) {
        throw new CustomHttpException(
          `Invalid .tea file: ${error.message}`,
          HttpErrorCode.VALIDATION_ERROR
        );
      }
      throw error;
    } finally {
      zipStream.destroy();
    }
    if (!structure || typeof structure !== 'object' || Array.isArray(structure)) {
      throw new CustomHttpException(
        'Invalid .tea file: structure.json is not an object',
        HttpErrorCode.VALIDATION_ERROR
      );
    }
    return structure as IBaseJson;
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
    const structure = await this.readDotTeaStructure(zipStream);
    this.validateStructureDbIdentifiers(structure);
    await this.preflightExtraBaseResources(structure, importBaseRo.notify.path);
    return await this.createBaseStructure(
      spaceId,
      structure,
      undefined,
      undefined,
      undefined,
      onProgress,
      { useTransaction: true },
      true
    );
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
    structure: IBaseJson,
    // Supplied by caller (importBase / importBaseV2) so HTTP-side structural rows and
    // BullMQ worker chunk rows share the same audit operationId.
    logId: string,
    hostResourceIdMaps: Record<string, Record<string, string>>
  ): Promise<string> {
    for (const tableId of Object.values(tableIdMap)) {
      await this.recordMutationPolicy.assertAllowed({
        tableId,
        operation: 'create',
        payload: importBaseRo,
      });
    }
    const userId = this.cls.get('user.id');
    const origin = this.cls.get('origin');

    await this.baseImportCsvQueueProcessor.queue.add(
      'base_import_csv',
      {
        baseId,
        path,
        userId,
        origin,
        recordInitiator: this.cls.get('recordInitiator'),
        tableIdMap,
        fieldIdMap,
        viewIdMap,
        fkMap,
        structure,
        importBaseRo,
        hostResourceIdMaps,
        logId,
      },
      {
        jobId: `import_csv_${path}_${userId}`,
      }
    );

    return logId;
  }

  @V1Engine()
  async createBaseStructure(
    spaceId: string,
    structure: IBaseJson,
    baseId?: string,
    skipCreateBaseNodes?: boolean,
    duplicateMode: BaseDuplicateMode = BaseDuplicateMode.Normal,
    onProgress?: BaseImportProgressCallback,
    routingOptions?: IDataDbRoutingOptions,
    _deferHostFinalization?: boolean
  ) {
    const { name, icon, tables, plugins, folders } = structure;

    const isCopyToExistingBase = !!baseId && isCopyToExistingBaseMode(duplicateMode);

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
      : await this.createBase(spaceId, name, icon || undefined, routingOptions);
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

    // create table
    const { tableIdMap, fieldIdMap, viewIdMap, fkMap } = await this.createTables(
      newBase.id,
      effectiveTables as IBaseJson['tables'],
      onProgress,
      routingOptions,
      { skipComputedEvaluation: true }
    );

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
    onProgress?: BaseImportProgressCallback,
    routingOptions?: IDataDbRoutingOptions,
    options: { skipComputedEvaluation?: boolean } = {}
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
      onProgress,
      routingOptions,
      options
    );
    this.logger.log(`base-duplicate-service: Duplicate table fields successfully`);

    const viewIdMap = await this.createViews(tables, tableIdMap, fieldIdMap, onProgress, {
      ensureRowOrder: routingOptions?.useTransaction !== true,
    });
    this.logger.log(`base-duplicate-service: Duplicate table views successfully`);

    await this.fieldDuplicateService.repairFieldOptions(tables, tableIdMap, fieldIdMap, viewIdMap);

    return { tableIdMap, fieldIdMap, viewIdMap, fkMap };
  }

  private async createFields(
    tables: IBaseJson['tables'],
    tableIdMap: Record<string, string>,
    tableNameMap?: Record<string, string>,
    onProgress?: BaseImportProgressCallback,
    routingOptions?: IDataDbRoutingOptions,
    options: { skipComputedEvaluation?: boolean } = {}
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
    await this.fieldDuplicateService.createCommonFields(
      commonFields,
      fieldMap,
      routingOptions,
      options
    );

    emitFieldProgress('creating_button_fields', buttonFields);
    await this.fieldDuplicateService.createButtonFields(
      buttonFields,
      fieldMap,
      routingOptions,
      options
    );

    emitFieldProgress('creating_formula_fields', primaryFormulaFields);
    await this.fieldDuplicateService.createTmpPrimaryFormulaFields(
      primaryFormulaFields,
      fieldMap,
      routingOptions,
      options
    );

    // main fix formula dbField type
    await this.fieldDuplicateService.repairPrimaryFormulaFields(primaryFormulaFields, fieldMap);

    // Some valid primary fields are deferred to dependency creation, for example
    // AI-config primaries. Bootstrap them before two-way link creation so
    // generateSymmetricField can always resolve the current table primary.
    emitFieldProgress('creating_primary_dependency_fields', primaryDependencyFields);
    await this.fieldDuplicateService.bootstrapPrimaryDependencyFields(
      primaryDependencyFields,
      fieldMap,
      routingOptions,
      options
    );

    emitFieldProgress('creating_link_fields', linkFields);
    await this.fieldDuplicateService.createLinkFields(
      linkFields,
      tableIdMap,
      fieldMap,
      fkMap,
      routingOptions,
      options
    );

    emitFieldProgress('creating_lookup_fields', dependencyFields);
    await this.fieldDuplicateService.createDependencyFields(
      dependencyFields,
      tableIdMap,
      fieldMap,
      'base',
      routingOptions,
      options
    );

    // fix formula expression' field map
    await this.fieldDuplicateService.repairPrimaryFormulaFields(primaryFormulaFields, fieldMap);

    const formulaFields = allFields.filter(
      ({ type, isLookup }) => type === FieldType.Formula && !isLookup
    );

    // fix formula reference
    await this.fieldDuplicateService.repairFormulaReference(formulaFields, fieldMap);

    return { fieldMap, fkMap };
  }

  private async createViews(
    tables: IBaseJson['tables'],
    tableIdMap: Record<string, string>,
    fieldMap: Record<string, string>,
    onProgress?: BaseImportProgressCallback,
    options: { ensureRowOrder?: boolean } = {}
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
        viewMap[view.id] = await this.createImportedView(
          view,
          tableIdMap[tableId],
          fieldMap,
          options.ensureRowOrder
        );
      }
    }

    return viewMap;
  }

  private async createImportedView(
    view: IBaseJson['tables'][number]['views'][number],
    tableId: string,
    fieldMap: Record<string, string>,
    ensureRowOrder?: boolean
  ) {
    const {
      name,
      type,
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
      obj[key] = keyString ? JSON.parse(keyString) : null;
    }
    const newViewVo = await this.viewOpenApiService.createView(
      tableId,
      { name, type, description, enableShare, isLocked, ...obj },
      { ensureRowOrder }
    );
    await this.prismaService.txClient().view.update({
      where: { id: newViewVo.id },
      data: {
        order,
        columnMeta: columnMeta ? replaceStringByMap(columnMeta, { fieldMap }) : columnMeta,
        shareId: shareId ? generateShareId() : undefined,
        shareMeta: shareMeta ? JSON.stringify(shareMeta) : undefined,
        enableShare,
        isLocked,
      },
    });
    return newViewVo.id;
  }

  private buildImportedNodeResourceMap(
    nodes: IBaseJson['nodes'],
    idMapContext: BaseImportNodeIdMaps
  ) {
    const {
      folderIdMap = {},
      tableIdMap = {},
      dashboardIdMap = {},
      workflowIdMap = {},
      appIdMap = {},
      routineIdMap = {},
    } = idMapContext;
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
          case BaseNodeResourceType.Routine:
            acc[resourceType][resourceId] = routineIdMap?.[resourceId];
            break;
          default:
            break;
        }
        return acc;
      },
      {} as Record<BaseNodeResourceType, Record<string, string>>
    );
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
        where: { baseId, deletedTime: null },
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
    idMapContext: BaseImportNodeIdMaps,
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

    const allNodeIdMap = nodes.reduce(
      (acc, cur) => {
        acc[cur.id] = generateBaseNodeId();
        return acc;
      },
      {} as Record<string, string>
    );

    const allTypeNodeIdMap = this.buildImportedNodeResourceMap(nodes, idMapContext);
    // Sort nodes by parent-child relationship (topological sort)
    // Ensure parent nodes are created before child nodes
    const sortedNodes = this.sortBaseNodesByParent(nodes);

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
      const { id, resourceId, resourceType } = node;
      const {
        id: newId,
        parentId: newParentId,
        order: effectiveOrder,
      } = this.getImportedBaseNodePosition(node, allNodeIdMap, rootOrderOffset);
      const newResourceId = allTypeNodeIdMap[resourceType]?.[resourceId] ?? null;
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

      const persistedNodeId = await this.persistImportedBaseNode(
        {
          id: newId,
          parentId: newParentId,
          resourceId: newResourceId,
          resourceType,
          baseId,
          createdBy: userId,
          order: effectiveOrder,
        },
        copyToExistingBase || Boolean(options?.updateExistingNodes)
      );
      if (persistedNodeId) {
        allNodeIdMap[id] = persistedNodeId;
      }

      createdResourceKeys.add(resourceKey);
    }

    return allNodeIdMap;
  }

  private getImportedBaseNodePosition(
    node: IBaseJson['nodes'][number],
    nodeIds: Record<string, string>,
    rootOrderOffset: number
  ) {
    const parentId = node.parentId ? (nodeIds[node.parentId] ?? null) : null;
    return {
      id: nodeIds[node.id],
      parentId,
      order: parentId ? node.order : node.order + rootOrderOffset,
    };
  }

  private async persistImportedBaseNode(
    data: {
      id: string;
      parentId: string | null;
      resourceId: string;
      resourceType: IBaseJson['nodes'][number]['resourceType'];
      baseId: string;
      createdBy: string;
      order: number;
    },
    updateExistingNodes: boolean
  ) {
    const prisma = this.prismaService.txClient();
    const { baseId, resourceType, resourceId } = data;
    // prepareNodeList self-healing may already have created this resource's node.
    const existingNode = await prisma.baseNode.findFirst({
      where: { baseId, resourceType, resourceId },
    });
    if (existingNode && updateExistingNodes) {
      await prisma.baseNode.update({
        where: { id: existingNode.id },
        data: { parentId: data.parentId, order: data.order },
      });
      return existingNode.id;
    }
    if (existingNode) {
      this.logger.warn(
        `base-import-service: node already exists in database, baseId: ${baseId}, resourceType: ${resourceType}, resourceId: ${resourceId}`
      );
      return undefined;
    }
    await prisma.baseNode.create({ data });
    return data.id;
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
    const pluginInstalls = plugins.flatMap(({ pluginInstall }) => pluginInstall);

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
    panelPlugins: IBaseJson['plugins'][PluginPosition.Panel],
    tableMap: Record<string, string>,
    fieldMap: Record<string, string>
  ) {
    const panelMap: Record<string, string> = {};
    const pluginInstallMap: Record<string, string> = {};
    const userId = this.cls.get('user.id');
    const prisma = this.prismaService.txClient();
    // Panels whose table is outside the imported scope have no table mapping
    const plugins = panelPlugins.filter(({ tableId }) => tableMap[tableId]);
    const pluginInstalls = plugins.flatMap(({ pluginInstall }) => pluginInstall);

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
      const configProperties = ['columnMeta', 'sort', 'group', 'filter'] as const;
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
      const options = remapPluginViewOptions(
        pluginView.options,
        { tableIdMap, fieldIdMap, viewIdMap },
        pluginInstall.pluginId,
        pluginInstallId
      );
      await prisma.view.update({
        where: { id: newViewId },
        data: {
          description,
          isLocked,
          enableShare,
          shareMeta: shareMeta ? JSON.stringify(shareMeta) : undefined,
          ...updateConfig,
          options,
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
