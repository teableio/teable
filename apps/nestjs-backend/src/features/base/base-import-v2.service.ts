/* eslint-disable @typescript-eslint/naming-convention */
import type { Readable } from 'node:stream';
import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import {
  type ILinkFieldOptions,
  type IUserCellValue,
  DbFieldType,
  FieldType,
  fieldVoSchema,
  generateAttachmentId,
  generateBaseId,
  generateBaseNodeFolderId,
  generateBaseNodeId,
  generateDashboardId,
  generatePluginInstallId,
  generatePluginPanelId,
  generateRecordId,
  generateViewId,
  getUniqName,
  HttpErrorCode,
  pluginViewOptionSchema,
  ViewType,
} from '@teable/core';
import { PrismaService } from '@teable/db-main-prisma';
import type {
  ICreateBaseVo,
  IBaseJson,
  IImportBasePreviewVo,
  IImportBaseVo,
} from '@teable/openapi';
import {
  UploadType,
  PluginPosition,
  BaseNodeResourceType,
  BaseDuplicateMode,
  CreateRecordAction,
  ImportBaseRo,
  tableFullVoSchema,
} from '@teable/openapi';
import { v2DataDbTokens, v2PostgresDbTokens } from '@teable/v2-adapter-db-postgres-pg';
import {
  err,
  ok,
  RecordId,
  UpdateFieldCommand,
  type UpdateFieldResult,
  GetTableByIdQuery,
  ImportDotTeaStructureCommand,
  RestoreRecordsStreamCommand,
  v2CoreTokens,
  type ICommandBus,
  type DomainError,
  type IExecutionContext,
  type IQueryBus,
  type ITableRecordRepository,
  type IUserLookupService,
  type UserLookupRecord,
  type IUnitOfWork,
  type GetTableByIdResult,
  type ImportDotTeaStructureResult,
  type RecordUpdateResult,
  type Result,
  type RestoreRecordInput,
  type RestoreRecordsStreamResult,
  type UpdateManyStreamBatchInput,
} from '@teable/v2-core';
import type { DependencyContainer } from '@teable/v2-di';
import * as csvParser from 'csv-parser';
import type { Kysely } from 'kysely';
import { sql } from 'kysely';
import { ClsService } from 'nestjs-cls';
import * as unzipper from 'unzipper';
import { CustomHttpException } from '../../custom.exception';
import type { IClsStore } from '../../types/cls';
import StorageAdapter from '../attachments/plugins/adapter';
import { InjectStorageAdapter } from '../attachments/plugins/storage';
import { AuditScope } from '../audit/audit-scope';
import { Audit } from '../audit/audit.decorator';
import { NotificationService } from '../notification/notification.service';
import { SpaceDataDbMigrationGuardService } from '../space/space-data-db-migration-guard.service';
import { V2ContainerService } from '../v2/v2-container.service';
import { V2ExecutionContextFactory } from '../v2/v2-execution-context.factory';
import { auditBaseCreated } from './base-create-audit';
import { BaseImportComputedService } from './base-import-computed.service';
import type { BaseImportProgressCallback, IBaseHostIdMaps } from './base-import-contract';
import { formatBaseImportError } from './base-import-contract';
import {
  buildImportBasePreview,
  toImportPreviewResources,
  type IImportPreviewResources,
} from './base-import-preview';
import { notifyBaseImportWarnings, type IBaseImportWarnings } from './base-import-warnings';
import { DotTeaStructureError, readDotTeaStructureJson } from './dottea-structure-reader';
import {
  parseImportAttachmentEntryName,
  pinImportAttachmentCell,
  replaceStringByMap,
  resolveImportAttachmentPaths,
} from './utils';

interface IImportedBaseNode {
  id: string;
  parentId: string | null;
  resourceId: string;
  resourceType: BaseNodeResourceType;
  baseId: string;
  createdBy: string;
  order: number;
}

interface IRestoreRecordColumnConfig {
  columnNames: ReadonlySet<string>;
  fieldsByDbFieldName: ReadonlyMap<
    string,
    {
      id: string;
      type: string;
      dbFieldType: string;
      isMultipleCellValue: boolean;
      isComputed: boolean;
      notNull: boolean;
    }
  >;
}

interface IImportedLinkTarget {
  id: string;
  dbTableName: string;
  baseId: string;
}

interface IImportedLinkReferences {
  target: IImportedLinkTarget;
  ids: Set<string>;
  existing: Set<string>;
}

const tableDataImportBatchSize = 100;

const linkFieldImportBatchSize = 25;

const attachmentsDirPrefix = 'attachments/';

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
export class BaseImportV2Service {
  private readonly logger = new Logger(BaseImportV2Service.name);

  constructor(
    private readonly prismaService: PrismaService,
    private readonly cls: ClsService<IClsStore>,
    @InjectStorageAdapter() private readonly storageAdapter: StorageAdapter,
    private readonly v2ContainerService: V2ContainerService,
    private readonly v2ContextFactory: V2ExecutionContextFactory,
    private readonly audit: AuditScope,
    private readonly computed: BaseImportComputedService,
    private readonly notificationService: NotificationService,
    @Optional()
    @Inject(SpaceDataDbMigrationGuardService)
    private readonly spaceDataDbMigrationGuard?: SpaceDataDbMigrationGuardService
  ) {}

  private async assertSpaceWritable(spaceId: string) {
    await this.spaceDataDbMigrationGuard?.assertSpaceWritable(spaceId);
  }

  private async assertBaseWritable(baseId: string) {
    await this.spaceDataDbMigrationGuard?.assertBaseWritable(baseId);
  }

  async createBaseV2(
    db: Kysely<unknown>,
    spaceId: string,
    name: string,
    icon?: string,
    baseId?: string,
    updateExistingBase: boolean = true
  ): Promise<ICreateBaseVo> {
    const userId = this.cls.get('user.id');
    await this.assertSpaceWritable(spaceId);
    if (baseId) {
      await this.assertBaseWritable(baseId);
      const existingResult = await sql<{
        id: string;
        name: string;
        icon: string | null;
        space_id: string;
      }>`
        select "id", "name", "icon", "space_id"
        from "base"
        where "id" = ${baseId}
          and "deleted_time" is null
        limit 1
      `.execute(db);
      const existing = existingResult.rows[0];
      if (!existing) {
        throw new Error(`Project not found: ${baseId}`);
      }
      if (updateExistingBase) {
        await sql`
          update "base"
          set
            "name" = ${name?.trim() || null},
            "icon" = ${icon ?? null},
            "last_modified_by" = ${userId},
            "last_modified_time" = ${new Date()}
          where "id" = ${baseId}
        `.execute(db);
        return {
          id: existing.id,
          name: name?.trim() || null,
          spaceId: existing.space_id,
        };
      }

      return {
        id: existing.id,
        name: existing.name,
        spaceId: existing.space_id,
      };
    }

    const base = {
      id: generateBaseId(),
      name: name?.trim() || null,
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

    return {
      id: base.id,
      name: base.name,
      spaceId: base.spaceId,
    };
  }

  protected collectImportPreviewResources(structure: IBaseJson): IImportPreviewResources[] {
    return [
      toImportPreviewResources(BaseNodeResourceType.Table, structure.tables),
      toImportPreviewResources(
        BaseNodeResourceType.Dashboard,
        structure.plugins?.[PluginPosition.Dashboard]
      ),
      toImportPreviewResources(BaseNodeResourceType.Folder, structure.folders),
    ];
  }

  /** Host extensions can reject incomplete resources before any destination write. */
  protected async preflightExtraBaseResources(
    _structure: IBaseJson,
    _archivePath: string
  ): Promise<void> {
    // Community has no extra resources to validate.
  }

  async previewImportBase(importBaseRo: ImportBaseRo): Promise<IImportBasePreviewVo> {
    const {
      notify: { path },
    } = importBaseRo;
    const zipStream = await this.storageAdapter.downloadFile(
      StorageAdapter.getBucket(UploadType.Import),
      path
    );
    const structure = await this.readDotTeaStructure(zipStream);
    this.validateStructureDbIdentifiers(structure);

    return buildImportBasePreview(structure, this.collectImportPreviewResources(structure));
  }

  @Audit({
    rootAction: CreateRecordAction.BaseImport,
    resourceId: (ro: ImportBaseRo) => ro.spaceId,
  })
  async importBaseV2(
    importBaseRo: ImportBaseRo,
    onProgress?: BaseImportProgressCallback,
    maxRowCount?: number
  ): Promise<IImportBaseVo> {
    // Cross-table budget of plan rows this import may still create; tables are
    // truncated (imported rows kept) once it runs out, then reported below.
    const rowBudget =
      maxRowCount === undefined
        ? undefined
        : { remaining: maxRowCount, truncatedTables: [] as string[] };
    const {
      spaceId,
      notify: { path },
    } = importBaseRo;
    const userId = this.cls.get('user.id');
    await this.assertSpaceWritable(spaceId);

    onProgress?.('importing_v2');
    onProgress?.('parsing_structure');

    const structureStream = await this.storageAdapter.downloadFile(
      StorageAdapter.getBucket(UploadType.Import),
      path
    );
    const structure = await this.readDotTeaStructure(structureStream);
    this.validateStructureDbIdentifiers(structure);
    await this.preflightExtraBaseResources(structure, path);
    onProgress?.('creating_base', structure.name);
    let container: DependencyContainer;
    try {
      container = await this.v2ContainerService.getContainerForSpace(spaceId);
    } catch (error) {
      throw new Error(
        formatBaseImportError(error, `Failed to connect space data database for ${spaceId}`)
      );
    }
    const commandBus = container.resolve<ICommandBus>(v2CoreTokens.commandBus);
    const queryBus = container.resolve<IQueryBus>(v2CoreTokens.queryBus);
    const tableRecordRepository = container.resolve<ITableRecordRepository>(
      v2CoreTokens.tableRecordRepository
    );
    const unitOfWork = container.resolve<IUnitOfWork>(v2CoreTokens.unitOfWork);
    const userLookupService = container.resolve<IUserLookupService>(v2CoreTokens.userLookupService);
    const db = container.resolve<Kysely<unknown>>(v2PostgresDbTokens.db);
    const context = await this.v2ContextFactory.createContext(container);
    const base = await this.createBaseV2(db, spaceId, structure.name, structure.icon || undefined);
    // Recorded as soon as it exists: a later failure (or the row-limit truncation below) keeps it.
    await auditBaseCreated(this.audit, { ...base, icon: structure.icon });

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
      throw new Error(formatBaseImportError(commandResult.error, 'Invalid dottea import command'));
    }

    const result = await commandBus.execute<
      ImportDotTeaStructureCommand,
      ImportDotTeaStructureResult
    >(context, commandResult.value);

    if (result.isErr()) {
      throw new Error(formatBaseImportError(result.error, 'Failed to import dottea structure'));
    }

    const { tableIdMap, fieldIdMap, viewIdMap } = result.value;

    onProgress?.('structure_created', base.id);
    const { appIdMap, workflowIdMap, routineIdMap, dashboardIdMap, folderIdMap, nodeIdMap } =
      await this.restoreBaseExtrasV2(
        db,
        base.id,
        structure,
        { tableIdMap, fieldIdMap, viewIdMap },
        BaseDuplicateMode.Normal,
        onProgress
      );
    onProgress?.('queuing_attachments');
    await this.importAttachmentsV2(db, path);
    onProgress?.('importing_table_data');
    const warnings: IBaseImportWarnings = {
      skippedUserCells: 0,
      skippedLinkCells: 0,
      relaxedRequiredUserFields: 0,
    };
    try {
      await this.importTableDataV2(
        path,
        base.id,
        structure,
        tableIdMap,
        viewIdMap,
        commandBus,
        queryBus,
        context,
        userLookupService,
        warnings,
        onProgress,
        rowBudget
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
        warnings,
        onProgress
      );
      const destinationTableIds = Object.values(tableIdMap);
      try {
        await this.computed.recomputeForTables(destinationTableIds);
      } catch (error) {
        const affectedTables = structure.tables.map((table) => ({
          sourceTableId: table.id,
          tableId: tableIdMap[table.id] ?? table.id,
          name: table.name,
        }));
        onProgress?.({
          phase: 'computed_backfill_failed',
          detail: JSON.stringify({
            baseId: base.id,
            tableIds: destinationTableIds,
            tables: affectedTables,
          }),
        });
        const reason = error instanceof Error ? error.message : String(error);
        throw new CustomHttpException(
          `Base import created base ${base.id}, but computed field backfill failed for tables (${affectedTables
            .map((table) => `${table.name}:${table.tableId}`)
            .join(', ')}): ${reason}`,
          HttpErrorCode.INTERNAL_SERVER_ERROR,
          {
            baseId: base.id,
            affectedTableIds: destinationTableIds,
            affectedTables,
          }
        );
      }

      if (rowBudget?.truncatedTables.length) {
        // Keep the imported base and rows (truncate-and-keep), but surface the
        // plan limit so the caller can run the upgrade flow; details name the
        // truncated tables so the report is explicit, not a silent partial.
        throw new CustomHttpException(
          `Exceed max row limit: ${maxRowCount ?? 0}. Imported data was truncated (tables: ${rowBudget.truncatedTables.join(', ')})`,
          HttpErrorCode.VALIDATION_ERROR,
          {
            domainCode: 'validation.limit.rows_per_table_max',
            details: {
              max: maxRowCount,
              truncatedTables: rowBudget.truncatedTables,
              baseId: base.id,
            },
            localization: {
              i18nKey: 'httpErrors.billing.exceedMaxRowLimit',
              context: { maxRowCount: maxRowCount ?? 0 },
            },
          }
        );
      }
    } catch (error) {
      try {
        await notifyBaseImportWarnings(this.notificationService, base.id, userId, {
          skippedUserCells: 0,
          skippedLinkCells: 0,
          relaxedRequiredUserFields: warnings.relaxedRequiredUserFields,
        });
      } catch {
        this.logger.error('Failed to notify imported required User constraint changes');
      }
      throw error;
    }
    await notifyBaseImportWarnings(this.notificationService, base.id, userId, warnings);

    return {
      base,
      tableIdMap,
      fieldIdMap,
      viewIdMap,
      appIdMap,
      workflowIdMap,
      routineIdMap,
      dashboardIdMap,
      folderIdMap,
      nodeIdMap,
      // Source->new base id, so EE import can rewrite base-id references baked into app
      // build artifacts (matches the v1 import/duplicate idMap; v2 dropped it).
      baseIdMap: { [structure.id]: base.id },
    } as IImportBaseVo & {
      appIdMap: Record<string, string>;
      workflowIdMap: Record<string, string>;
      routineIdMap: Record<string, string>;
      dashboardIdMap: Record<string, string>;
      folderIdMap: Record<string, string>;
      nodeIdMap: Record<string, string>;
      baseIdMap: Record<string, string>;
    };
  }

  async restoreBaseExtrasV2(
    db: Kysely<unknown>,
    baseId: string,
    structure: IBaseJson,
    idMaps: {
      tableIdMap: Record<string, string>;
      fieldIdMap: Record<string, string>;
      viewIdMap: Record<string, string>;
    },
    duplicateMode: BaseDuplicateMode = BaseDuplicateMode.Normal,
    onProgress?: BaseImportProgressCallback,
    copyToExistingBase: boolean = false
  ): Promise<IBaseHostIdMaps> {
    const { tableIdMap, fieldIdMap, viewIdMap } = idMaps;
    // Existing-base template installs own an ambient Prisma metadata transaction. The native
    // table command has already committed; these host helpers must use that transaction.
    const useHostTransaction =
      copyToExistingBase &&
      (duplicateMode === BaseDuplicateMode.ApplyTemplate ||
        duplicateMode === BaseDuplicateMode.InstallTemplate);
    let dashboardIdMap: Record<string, string> = {};
    const hasPlugins = Object.values(structure.plugins).some(
      (plugins) => Array.isArray(plugins) && plugins.length > 0
    );
    if (hasPlugins) {
      onProgress?.('creating_plugins');
      ({ dashboardIdMap } = useHostTransaction
        ? await this.createPluginsInTransactionV2(
            baseId,
            structure.plugins,
            tableIdMap,
            fieldIdMap,
            viewIdMap
          )
        : await this.createPluginsV2(
            db,
            baseId,
            structure.plugins,
            tableIdMap,
            fieldIdMap,
            viewIdMap
          ));
    }

    // Restore edition-specific resources (apps / workflows / authority matrix) through the v2
    // extension hook and collect their id maps so matching base_node rows can be remapped below.
    // Community has none, so the hook is a no-op; EE overrides it for imported and duplicated bases.
    const {
      workflowIdMap = {},
      appIdMap = {},
      routineIdMap = {},
    } = await this.restoreExtraBaseResourcesV2(
      db,
      baseId,
      structure,
      { tableIdMap, fieldIdMap, viewIdMap },
      duplicateMode,
      onProgress
    );

    const hasFolders = Array.isArray(structure.folders) && structure.folders.length > 0;
    const hasNodes = Array.isArray(structure.nodes) && structure.nodes.length > 0;

    if (hasFolders) {
      onProgress?.('creating_folders');
    }
    const { folderIdMap } = useHostTransaction
      ? await this.createFolders(baseId, structure.folders, copyToExistingBase)
      : await this.createFoldersV2(db, baseId, structure.folders, copyToExistingBase);

    let nodeIdMap: Record<string, string> = {};
    if (hasNodes) {
      onProgress?.('restoring_base_nodes');
      const resourceMaps = {
        folderIdMap,
        tableIdMap,
        dashboardIdMap,
        workflowIdMap,
        appIdMap,
        routineIdMap,
      };
      nodeIdMap = useHostTransaction
        ? await this.createBaseNodes(baseId, structure.nodes, resourceMaps, copyToExistingBase, {
            updateExistingNodes: true,
          })
        : await this.createBaseNodesV2(db, baseId, structure.nodes, resourceMaps, {
            updateExistingNodes: true,
            copyToExistingBase,
          });
    }

    return {
      appIdMap,
      workflowIdMap,
      routineIdMap,
      dashboardIdMap,
      folderIdMap,
      nodeIdMap,
    };
  }

  protected async restoreExtraBaseResourcesV2(
    _db: Kysely<unknown>,
    _baseId: string,
    _structure: IBaseJson,
    _idMaps: {
      tableIdMap: Record<string, string>;
      fieldIdMap: Record<string, string>;
      viewIdMap: Record<string, string>;
    },
    _duplicateMode: BaseDuplicateMode,
    _onProgress?: BaseImportProgressCallback
  ): Promise<{
    workflowIdMap?: Record<string, string>;
    appIdMap?: Record<string, string>;
    routineIdMap?: Record<string, string>;
  }> {
    return {};
  }

  private async createFoldersV2(
    db: Kysely<unknown>,
    baseId: string,
    folders: IBaseJson['folders'],
    copyToExistingBase: boolean = false
  ) {
    const folderIdMap: Record<string, string> = {};
    if (!Array.isArray(folders) || folders.length === 0) {
      return { folderIdMap };
    }

    const userId = this.cls.get('user.id');

    // The target base may already own folders with the same names (e.g. saving a shared
    // base into the same base twice), which would violate the (base_id, name) unique index.
    const existingNames: string[] = [];
    if (copyToExistingBase) {
      const existingFolders = await sql<{ name: string }>`
        select "name" from "base_node_folder" where "base_id" = ${baseId} and "deleted_time" is null
      `.execute(db);
      existingNames.push(...existingFolders.rows.map((row) => row.name));
    }

    for (const folder of folders) {
      const { id, name } = folder;
      const uniqueName = copyToExistingBase ? getUniqName(name, existingNames) : name;
      if (copyToExistingBase) {
        existingNames.push(uniqueName);
      }

      const newFolderId = generateBaseNodeFolderId();
      await sql`
        insert into "base_node_folder" ("id", "name", "base_id", "created_by")
        values (${newFolderId}, ${uniqueName}, ${baseId}, ${userId})
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
      routineIdMap?: Record<string, string>;
    },
    options?: {
      updateExistingNodes?: boolean;
      copyToExistingBase?: boolean;
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
      routineIdMap = {},
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
      routineIdMap,
    });
    const sortedNodes = this.sortBaseNodesByParent(nodes);
    const createdResourceKeys = new Set<string>();

    const rootOrderOffset = options?.copyToExistingBase
      ? await this.getRootOrderOffsetV2(db, baseId)
      : 0;

    for (const node of sortedNodes) {
      const { id, resourceId, resourceType } = node;
      const newId = allNodeIdMap[id];
      const { parentId: newParentId, order: effectiveOrder } = this.getImportedBaseNodePosition(
        node,
        allNodeIdMap,
        rootOrderOffset
      );
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

      const updatedNodeId = await this.persistImportedBaseNodeV2(
        db,
        {
          id: newId,
          parentId: newParentId,
          resourceId: newResourceId,
          resourceType,
          baseId,
          createdBy: userId,
          order: effectiveOrder,
        },
        options?.updateExistingNodes
      );
      if (updatedNodeId) {
        allNodeIdMap[id] = updatedNodeId;
      }
      createdResourceKeys.add(resourceKey);
    }

    return allNodeIdMap;
  }

  private getImportedBaseNodePosition(
    node: IBaseJson['nodes'][number],
    allNodeIdMap: Record<string, string>,
    rootOrderOffset: number
  ) {
    const parentId =
      node.parentId && allNodeIdMap[node.parentId] ? allNodeIdMap[node.parentId] : null;
    const order = parentId ? node.order : node.order + rootOrderOffset;
    return { parentId, order };
  }

  private async persistImportedBaseNodeV2(
    db: Kysely<unknown>,
    node: IImportedBaseNode,
    updateExistingNodes?: boolean
  ): Promise<string | undefined> {
    const { id, parentId, resourceId, resourceType, baseId, createdBy, order } = node;
    const existingNode = await sql<{ id: string }>`
      select "id"
      from "base_node"
      where "base_id" = ${baseId}
        and "resource_type" = ${resourceType}
        and "resource_id" = ${resourceId}
      limit 1
    `.execute(db);
    const existingNodeId = existingNode.rows[0]?.id;

    if (existingNodeId && updateExistingNodes) {
      await sql`
        update "base_node"
        set "parent_id" = ${parentId},
            "order" = ${order},
            "last_modified_by" = ${createdBy},
            "last_modified_time" = now()
        where "id" = ${existingNodeId}
      `.execute(db);
      return existingNodeId;
    }

    if (existingNodeId) {
      this.logger.warn(
        `base-import-service: node already exists in database, baseId: ${baseId}, resourceType: ${resourceType}, resourceId: ${resourceId}`
      );
      return;
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
        ${id},
        ${parentId},
        ${resourceId},
        ${resourceType},
        ${baseId},
        ${createdBy},
        ${order}
      )
    `.execute(db);
  }

  private async getRootOrderOffsetV2(db: Kysely<unknown>, baseId: string): Promise<number> {
    const maxOrderResult = await sql<{ max: number | null }>`
      select max("order") as max from "base_node"
      where "base_id" = ${baseId} and "parent_id" is null
    `.execute(db);
    return Number(maxOrderResult.rows[0]?.max ?? 0) + 1;
  }

  private buildBaseNodeResourceIdMap(params: {
    nodes: IBaseJson['nodes'];
    folderIdMap: Record<string, string>;
    tableIdMap: Record<string, string>;
    dashboardIdMap: Record<string, string>;
    workflowIdMap: Record<string, string>;
    appIdMap: Record<string, string>;
    routineIdMap: Record<string, string>;
  }) {
    const {
      nodes,
      folderIdMap,
      tableIdMap,
      dashboardIdMap,
      workflowIdMap,
      appIdMap,
      routineIdMap,
    } = params;
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
            acc[resourceType][resourceId] = routineIdMap[resourceId];
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

  private async createPluginsInTransactionV2(
    baseId: string,
    plugins: IBaseJson['plugins'],
    tableIdMap: Record<string, string>,
    fieldIdMap: Record<string, string>,
    viewIdMap: Record<string, string>
  ) {
    const { dashboardIdMap } = await this.createDashboard(
      baseId,
      plugins[PluginPosition.Dashboard],
      tableIdMap,
      fieldIdMap
    );
    await this.createPanel(
      baseId,
      plugins[PluginPosition.Panel].filter(({ tableId }) => tableIdMap[tableId]),
      tableIdMap,
      fieldIdMap
    );
    const prisma = this.prismaService.txClient();
    const userId = this.cls.get('user.id');
    for (const pluginView of plugins[PluginPosition.View]) {
      const viewId = viewIdMap[pluginView.id] ?? generateViewId();
      const pluginInstallId = generatePluginInstallId();
      viewIdMap[pluginView.id] = viewId;
      const config = this.mapPluginViewConfig(
        pluginView,
        tableIdMap,
        fieldIdMap,
        viewIdMap,
        pluginInstallId
      );
      const viewData = {
        name: pluginView.name,
        description: pluginView.description,
        tableId: tableIdMap[pluginView.tableId],
        type: ViewType.Plugin,
        sort: config.sort,
        filter: config.filter,
        group: config.group,
        options: config.options,
        columnMeta: config.columnMeta,
        order: pluginView.order ?? 0,
        isLocked: pluginView.isLocked,
        enableShare: pluginView.enableShare,
        shareMeta: pluginView.shareMeta ? JSON.stringify(pluginView.shareMeta) : null,
      };
      await prisma.view.upsert({
        where: { id: viewId },
        create: { ...viewData, id: viewId, version: 1, createdBy: userId },
        update: { ...viewData, lastModifiedBy: userId },
      });
      await prisma.pluginInstall.create({
        data: {
          id: pluginInstallId,
          baseId,
          createdBy: userId,
          pluginId: pluginView.pluginInstall.pluginId,
          name: pluginView.pluginInstall.name,
          positionId: viewId,
          position: PluginPosition.View,
          storage: config.storage,
        },
      });
    }
    return { dashboardIdMap };
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
    const pluginInstalls = plugins.flatMap(({ pluginInstall }) => pluginInstall);

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
    panelPlugins: IBaseJson['plugins'][PluginPosition.Panel],
    tableMap: Record<string, string>,
    fieldMap: Record<string, string>
  ) {
    const panelMap: Record<string, string> = {};
    const pluginInstallMap: Record<string, string> = {};
    const userId = this.cls.get('user.id');
    // Panels whose table is outside the imported scope have no table mapping
    const plugins = panelPlugins.filter(({ tableId }) => tableMap[tableId]);
    const pluginInstalls = plugins.flatMap(({ pluginInstall }) => pluginInstall);

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
    for (const pluginView of pluginViews) {
      await this.createPluginViewV2(db, baseId, pluginView, tableIdMap, fieldIdMap, viewIdMap);
    }
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

  private async savePluginViewV2(
    db: Kysely<unknown>,
    pluginView: IBaseJson['plugins'][PluginPosition.View][number],
    newViewId: string,
    newTableId: string,
    userId: string,
    config: ReturnType<BaseImportV2Service['mapPluginViewConfig']>,
    exists: boolean
  ) {
    const { name, description, enableShare, shareMeta, isLocked, order } = pluginView;
    if (exists) {
      await sql`
        update "view"
        set "name" = ${name},
            "description" = ${description ?? null},
            "table_id" = ${newTableId},
            "type" = ${ViewType.Plugin},
            "sort" = ${config.sort},
            "filter" = ${config.filter},
            "group" = ${config.group},
            "options" = ${config.options},
            "order" = ${order},
            "column_meta" = ${config.columnMeta},
            "is_locked" = ${isLocked ?? null},
            "enable_share" = ${enableShare ?? null},
            "share_meta" = ${shareMeta ? JSON.stringify(shareMeta) : null},
            "last_modified_by" = ${userId},
            "last_modified_time" = now()
        where "id" = ${newViewId}
      `.execute(db);
      return;
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
        ${newTableId},
        ${ViewType.Plugin},
        ${config.sort},
        ${config.filter},
        ${config.group},
        ${config.options},
        ${order},
        ${1},
        ${config.columnMeta},
        ${isLocked ?? null},
        ${enableShare ?? null},
        ${shareMeta ? JSON.stringify(shareMeta) : null},
        ${userId}
      )
    `.execute(db);
  }

  private async createPluginViewV2(
    db: Kysely<unknown>,
    baseId: string,
    pluginView: IBaseJson['plugins'][PluginPosition.View][number],
    tableIdMap: Record<string, string>,
    fieldIdMap: Record<string, string>,
    viewIdMap: Record<string, string>
  ) {
    const userId = this.cls.get('user.id');
    const existingViewId = viewIdMap[pluginView.id];
    const newViewId = existingViewId ?? generateViewId();
    const pluginInstallId = generatePluginInstallId();
    viewIdMap[pluginView.id] = newViewId;
    const config = this.mapPluginViewConfig(
      pluginView,
      tableIdMap,
      fieldIdMap,
      viewIdMap,
      pluginInstallId
    );

    await this.savePluginViewV2(
      db,
      pluginView,
      newViewId,
      tableIdMap[pluginView.tableId],
      userId,
      config,
      Boolean(existingViewId)
    );

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
        ${pluginView.pluginInstall.pluginId},
        ${pluginView.pluginInstall.name},
        ${newViewId},
        ${PluginPosition.View},
        ${config.storage}
      )
    `.execute(db);
  }

  private async forEachDotTeaEntry(
    path: string,
    match: (entryPath: string, entry: unzipper.Entry) => boolean,
    consume: (entry: unzipper.Entry) => Promise<void>
  ): Promise<void> {
    const zipStream = await this.storageAdapter.downloadFile(
      StorageAdapter.getBucket(UploadType.Import),
      path
    );
    const parser = unzipper.Parse();

    await new Promise<void>((resolve, reject) => {
      let settled = false;
      let chain: Promise<void> = Promise.resolve();

      const fail = (error: unknown) => {
        if (settled) return;
        settled = true;
        zipStream.destroy();
        reject(error instanceof Error ? error : new Error(String(error)));
      };

      parser.on('entry', (entry: unzipper.Entry) => {
        // Synchronous skip: drain (PassThrough, no inflate) entries we don't need.
        if (settled || !match(entry.path, entry)) {
          entry.autodrain();
          return;
        }
        // Matched entries are consumed sequentially; the parser back-pressures until done.
        chain = chain.then(() => consume(entry)).catch(fail);
      });
      parser.on('error', fail);
      zipStream.on('error', fail);
      parser.on('close', () => {
        chain
          .then(() => {
            if (!settled) {
              settled = true;
              resolve();
            }
          })
          .catch(fail);
      });

      zipStream.pipe(parser);
    });
  }

  private async importAttachmentsV2(db: Kysely<unknown>, path: string) {
    await this.importAttachmentFilesV2(db, path);
    await this.importAttachmentMetadataV2(db, path);
  }

  private async importAttachmentFilesV2(db: Kysely<unknown>, path: string) {
    const bucket = StorageAdapter.getBucket(UploadType.Table);

    await this.forEachDotTeaEntry(
      path,
      (entryPath, entry) =>
        entryPath.startsWith(attachmentsDirPrefix) &&
        entry.type !== 'Directory' &&
        (entryPath.split('.').pop() ?? '') !== 'csv',
      async (entry) => {
        const entryName = entry.path.replace(attachmentsDirPrefix, '');
        const parsed = parseImportAttachmentEntryName(entryName);
        if (!parsed) {
          this.logger.warn(`[base import attachment] skip invalid entry: ${entryName}`);
          entry.autodrain();
          return;
        }
        const { isThumbnail, key: finalToken, extension } = parsed;
        const finalPath = isThumbnail
          ? `table/${finalToken}`
          : `${StorageAdapter.getDir(UploadType.Table)}/${finalToken}`;
        const existing = await sql<{ id: string }>`
          select "id"
          from "attachments"
          where "token" = ${finalToken}
          limit 1
        `.execute(db);

        if (existing.rows[0]) {
          entry.autodrain();
          return;
        }

        await this.storageAdapter.uploadFileStream(bucket, finalPath, entry, {
          // eslint-disable-next-line @typescript-eslint/naming-convention
          'Content-Type': this.getAttachmentMimeType(extension),
        });
      }
    );
  }

  private async importAttachmentMetadataV2(db: Kysely<unknown>, path: string) {
    const userId = this.cls.get('user.id');

    await this.forEachDotTeaEntry(
      path,
      (entryPath, entry) =>
        entryPath.startsWith(attachmentsDirPrefix) &&
        entry.type !== 'Directory' &&
        entryPath.endsWith('.csv'),
      async (entry) => {
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
          // The archive's own path columns are not trusted; the row names the object
          // importAttachmentFilesV2 uploaded for this token.
          const paths = resolveImportAttachmentPaths(row);
          if (!paths) {
            this.logger.warn(`[base import attachment] skip row with invalid token: ${row.id}`);
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
              ${paths.path},
              ${row.width ? Number(row.width) : null},
              ${row.height ? Number(row.height) : null},
              ${paths.thumbnailPath},
              ${userId}
            )
          `.execute(db);
        }
      }
    );
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

  private isImportableTableCsv(
    entryPath: string,
    entry: unzipper.Entry,
    tablesById: Map<string, IBaseJson['tables'][number]>
  ): boolean {
    if (
      !entryPath.startsWith('tables/') ||
      entry.type === 'Directory' ||
      !entryPath.endsWith('.csv') ||
      entryPath.includes('junction_')
    ) {
      return false;
    }
    return tablesById.has(entryPath.replace('tables/', '').replace(/\.csv$/, ''));
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
    userLookupService: IUserLookupService,
    warnings: IBaseImportWarnings,
    onProgress?: BaseImportProgressCallback,
    rowBudget?: { remaining: number; truncatedTables: string[] }
  ) {
    const tablesById = new Map(structure.tables.map((table) => [table.id, table]));
    let importedTables = 0;

    await this.forEachDotTeaEntry(
      path,
      (entryPath, entry) => this.isImportableTableCsv(entryPath, entry, tablesById),
      async (entry) => {
        const tableId = entry.path.replace('tables/', '').replace(/\.csv$/, '');
        const table = tablesById.get(tableId)!;
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
          userLookupService,
          warnings,
          onProgress,
          rowBudget
        );
      }
    );

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
    userLookupService: IUserLookupService,
    warnings: IBaseImportWarnings,
    onProgress?: BaseImportProgressCallback,
    rowBudget?: { remaining: number; truncatedTables: string[] }
  ) {
    const tableId = targetTableId;
    const tableName = table.name;
    let config = await this.buildTableDataImportConfig(baseId, tableId, queryBus, context);

    // Keep CSV processing streaming: only this batch is buffered. Authorization
    // runs immediately before its restore, at the same timing as normal writes.
    // Earlier batches/schema remain committed if a later batch fails; a grant
    // revoked after this batch's lookup has the normal write-path race window.
    let batch: RestoreRecordInput[] = [];
    let totalInserted = 0;
    let batchIndex = 0;
    const source = this.applyRowBudget(
      this.createTableRestoreRecordStream(entry, config, viewIdMap),
      rowBudget,
      table.name
    );

    const restoreBatch = async () => {
      if (batch.length === 0) return;
      const authorized = await this.authorizeImportedUserValues(
        batch,
        config,
        baseId,
        tableId,
        userLookupService,
        warnings,
        commandBus,
        context
      );
      if (authorized.relaxedRequiredUserFields > 0) {
        config = await this.buildTableDataImportConfig(baseId, tableId, queryBus, context);
      }
      const commandResult = RestoreRecordsStreamCommand.create({
        tableId,
        records: this.toAsyncIterable(authorized.records),
        batchSize: tableDataImportBatchSize,
        // Final dependency-ordered backfill owns computation after all rows and links exist.
        skipComputedUpdates: true,
      });
      if (commandResult.isErr()) {
        throw new Error(
          formatBaseImportError(commandResult.error, 'Invalid table data import command')
        );
      }

      const result = await commandBus.execute<
        RestoreRecordsStreamCommand,
        RestoreRecordsStreamResult
      >(context, commandResult.value);
      if (result.isErr()) {
        throw new Error(formatBaseImportError(result.error, 'Failed to import table data'));
      }

      for await (const event of result.value) {
        if (event.id === 'progress') {
          onProgress?.({
            phase: 'table_data_progress',
            tableId,
            tableName,
            processedRows: totalInserted + event.totalInserted,
            batchProcessedRows: event.insertedCount,
            currentBatch: batchIndex + 1,
          });
          continue;
        }
        if (event.id === 'error') {
          throw new Error(formatBaseImportError(event.message, 'Failed to import table data'));
        }
        totalInserted += event.restoredCount;
      }
      batchIndex += 1;
      batch = [];
    };

    for await (const record of source) {
      batch.push(record);
      if (batch.length === tableDataImportBatchSize) await restoreBatch();
    }
    await restoreBatch();
    onProgress?.({
      phase: 'table_data_done',
      tableId,
      tableName,
      processedRows: totalInserted,
    });
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
    warnings: IBaseImportWarnings,
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

    await this.forEachDotTeaEntry(
      path,
      (entryPath, entry) => this.isImportableTableCsv(entryPath, entry, tablesById),
      async (entry) => {
        const tableId = entry.path.replace('tables/', '').replace(/\.csv$/, '');
        const table = tablesById.get(tableId)!;
        await this.importTableLinkFieldEntryV2(
          entry,
          baseId,
          tableIdMap[table.id] ?? table.id,
          queryBus,
          tableRecordRepository,
          unitOfWork,
          context,
          warnings,
          onLinkBatchUpdated
        );
      }
    );

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
    const tablesById = new Map(structure.tables.map((table) => [table.id, table]));
    let totalRows = 0;

    await this.forEachDotTeaEntry(
      path,
      (entryPath, entry) => this.isImportableTableCsv(entryPath, entry, tablesById),
      async (entry) => {
        const tableId = entry.path.replace('tables/', '').replace(/\.csv$/, '');
        const table = tablesById.get(tableId)!;
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
          return;
        }

        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        for await (const _record of this.createTableLinkFieldUpdateStream(entry, config)) {
          totalRows += 1;
        }
      }
    );

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
    warnings: IBaseImportWarnings,
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

    for await (const batchResult of this.createTableLinkFieldUpdateBatchStream(
      entry,
      config,
      warnings
    )) {
      if (batchResult.isErr()) {
        throw new Error(
          formatBaseImportError(batchResult.error, 'Invalid link field import batch')
        );
      }

      const result = await unitOfWork.withTransaction(context, async (transactionContext) =>
        tableRecordRepository.updateManyStream(transactionContext, config.table, [batchResult], {
          skipComputedUpdates: true,
          fillLinkTitles: true,
        })
      );
      if (result.isErr()) {
        throw new Error(formatBaseImportError(result.error, 'Failed to import link fields'));
      }

      onLinkBatchUpdated(result.value.totalUpdated);
    }
  }

  private async *applyRowBudget(
    source: AsyncGenerator<RestoreRecordInput>,
    rowBudget: { remaining: number; truncatedTables: string[] } | undefined,
    tableName: string
  ): AsyncGenerator<RestoreRecordInput> {
    if (!rowBudget) {
      yield* source;
      return;
    }
    for await (const record of source) {
      if (rowBudget.remaining <= 0) {
        if (!rowBudget.truncatedTables.includes(tableName)) {
          rowBudget.truncatedTables.push(tableName);
        }
        return;
      }
      rowBudget.remaining -= 1;
      yield record;
    }
  }

  private async *createTableRestoreRecordStream(
    entry: unzipper.Entry,
    config: Awaited<ReturnType<BaseImportV2Service['buildTableDataImportConfig']>>,
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
    row: Record<string, unknown>,
    config: Awaited<ReturnType<BaseImportV2Service['buildTableDataImportConfig']>>,
    viewIdMap: Record<string, string>
  ): RestoreRecordInput {
    const recordId = typeof row.__id === 'string' && row.__id ? row.__id : generateRecordId();
    const { fields, extraColumnValues, orders } = this.toRestoreRecordColumnValues(
      row,
      config,
      viewIdMap
    );

    return {
      recordId,
      fields,
      ...(Object.keys(orders).length ? { orders } : {}),
      ...(row.__version ? { version: Number(row.__version) } : {}),
      ...(row.__auto_number ? { autoNumber: Number(row.__auto_number) } : {}),
      ...(row.__created_time ? { createdTime: this.toRestoreString(row.__created_time) } : {}),
      ...(row.__created_by ? { createdBy: this.toRestoreString(row.__created_by) } : {}),
      ...(row.__last_modified_time
        ? { lastModifiedTime: this.toRestoreString(row.__last_modified_time) }
        : {}),
      ...(row.__last_modified_by
        ? { lastModifiedBy: this.toRestoreString(row.__last_modified_by) }
        : {}),
      ...(Object.keys(extraColumnValues).length ? { extraColumnValues } : {}),
    };
  }

  private toRestoreRecordColumnValues(
    row: Record<string, unknown>,
    config: IRestoreRecordColumnConfig,
    viewIdMap: Record<string, string>
  ) {
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

      this.addRestoreRecordFieldValue(columnName, rawValue, config, fields, extraColumnValues);
    }

    return { fields, extraColumnValues, orders };
  }

  private addRestoreRecordFieldValue(
    columnName: string,
    rawValue: unknown,
    config: IRestoreRecordColumnConfig,
    fields: Record<string, unknown>,
    extraColumnValues: Record<string, unknown>
  ): void {
    if (this.isRestoreSystemColumn(columnName)) {
      return;
    }

    if (!config.columnNames.has(columnName)) {
      return;
    }

    const field = config.fieldsByDbFieldName.get(columnName);
    if (
      this.isRestoreComputedField(field) ||
      field?.type === FieldType.Button ||
      field?.type === FieldType.Link
    ) {
      return;
    }

    const value = this.normalizeDotTeaCsvValue(rawValue, {
      dbFieldType: field?.dbFieldType,
      isMultipleCellValue: Boolean(field?.isMultipleCellValue),
      notNull: Boolean(field?.notNull),
    });

    if (field?.type === FieldType.Attachment && value != null) {
      fields[field.id] = pinImportAttachmentCell(this.parseJsonCellValue(value));
      return;
    }

    extraColumnValues[columnName] = this.serializeRestoreColumnValue(value, field?.dbFieldType);
  }

  private async authorizeImportedUserValues(
    records: ReadonlyArray<RestoreRecordInput>,
    config: {
      fieldsByDbFieldName: ReadonlyMap<
        string,
        {
          id: string;
          type: string;
          dbFieldName: string;
          isMultipleCellValue: boolean;
          isComputed: boolean;
          notNull: boolean;
        }
      >;
    },
    baseId: string,
    tableId: string,
    userLookupService: IUserLookupService,
    warnings: IBaseImportWarnings,
    commandBus: ICommandBus,
    context: IExecutionContext
  ): Promise<{ records: RestoreRecordInput[]; relaxedRequiredUserFields: number }> {
    // The archive is caller-controlled, unlike undo/trash restore snapshots.
    // Re-evaluate scope for each bounded restore batch; do not cache grants
    // across batches or claim the whole import is atomic after schema commit.
    const userFields = [...config.fieldsByDbFieldName.values()].filter(
      (field) => field.type === FieldType.User && !field.isComputed
    );
    const scopedIds = new Set<string>();
    const identityPairs: Array<{ id: string; email: string }> = [];
    const parsedCells = new Map<
      RestoreRecordInput,
      Map<string, ReadonlyArray<{ id: string; email?: string }> | null>
    >();

    for (const record of records) {
      const cells = new Map<string, ReadonlyArray<{ id: string; email?: string }> | null>();
      parsedCells.set(record, cells);
      for (const field of userFields) {
        const references = this.parseImportedUserReferences(
          record.extraColumnValues?.[field.dbFieldName],
          field.isMultipleCellValue
        );
        cells.set(field.dbFieldName, references);
        for (const reference of references ?? []) {
          if (reference.email !== undefined) {
            identityPairs.push({ id: reference.id, email: reference.email });
          } else {
            scopedIds.add(reference.id);
          }
        }
      }
    }
    this.collectImportedAuthorIds(records, scopedIds);

    const { scopedUsersById, pairedUsersById } = await this.lookupImportedUsers(
      tableId,
      scopedIds,
      identityPairs,
      userLookupService
    );

    const affectedRequiredFields = new Set<string>();
    const authorizedRecords = records.map((record) => {
      const extraColumnValues = { ...record.extraColumnValues };
      for (const field of userFields) {
        const references = parsedCells.get(record)?.get(field.dbFieldName) ?? null;
        extraColumnValues[field.dbFieldName] = this.authorizeImportedUserCell(
          references,
          field,
          scopedUsersById,
          pairedUsersById,
          warnings,
          affectedRequiredFields
        );
      }
      let { createdBy, lastModifiedBy } = record;
      if (createdBy && !scopedUsersById.has(createdBy)) {
        createdBy = this.cls.get('user.id');
        warnings.skippedUserCells += 1;
      }
      if (lastModifiedBy && !scopedUsersById.has(lastModifiedBy)) {
        lastModifiedBy = this.cls.get('user.id');
        warnings.skippedUserCells += 1;
      }
      return { ...record, createdBy, lastModifiedBy, extraColumnValues };
    });
    const relaxedRequiredUserFields = await this.relaxImportedRequiredUserFieldsV2(
      baseId,
      tableId,
      affectedRequiredFields,
      commandBus,
      context,
      warnings
    );
    return { records: authorizedRecords, relaxedRequiredUserFields };
  }

  private authorizeImportedUserCell(
    references: ReadonlyArray<{ id: string; email?: string }> | null,
    field: { id: string; isMultipleCellValue: boolean; notNull: boolean },
    scopedUsersById: ReadonlyMap<string, UserLookupRecord>,
    pairedUsersById: ReadonlyMap<string, UserLookupRecord>,
    warnings: IBaseImportWarnings,
    affectedRequiredFields: Set<string>
  ): string | null {
    if (!references) return null;
    const canonical = this.canonicalizeImportedUserReferences(
      references,
      scopedUsersById,
      pairedUsersById
    );
    if (canonical.length !== references.length) warnings.skippedUserCells += 1;
    if (canonical.length === 0) {
      if (field.notNull) affectedRequiredFields.add(field.id);
      return null;
    }
    return JSON.stringify(field.isMultipleCellValue ? canonical : canonical[0]);
  }

  private canonicalizeImportedUserReferences(
    references: ReadonlyArray<{ id: string; email?: string }>,
    scopedUsersById: ReadonlyMap<string, UserLookupRecord>,
    pairedUsersById: ReadonlyMap<string, UserLookupRecord>
  ): IUserCellValue[] {
    const canonical: IUserCellValue[] = [];
    for (const reference of references) {
      const user = (reference.email === undefined ? scopedUsersById : pairedUsersById).get(
        reference.id
      );
      if (user && (reference.email === undefined || user.email === reference.email)) {
        canonical.push({
          id: user.id,
          title: user.name,
          ...(user.email ? { email: user.email } : {}),
          ...(user.avatarUrl ? { avatarUrl: user.avatarUrl } : {}),
        });
      }
    }
    return canonical;
  }

  private async relaxImportedRequiredUserFieldsV2(
    baseId: string,
    tableId: string,
    fieldIds: ReadonlySet<string>,
    commandBus: ICommandBus,
    context: IExecutionContext,
    warnings: IBaseImportWarnings
  ): Promise<number> {
    let relaxed = 0;
    for (const fieldId of fieldIds) {
      const field = await this.prismaService.field.findFirstOrThrow({
        where: { id: fieldId, tableId, table: { baseId }, deletedTime: null },
        select: { type: true, isComputed: true, isLookup: true, notNull: true },
      });
      if (field.type !== FieldType.User || field.isComputed || field.isLookup) {
        throw new Error('Imported user field is no longer writable');
      }
      if (!field.notNull) continue;
      const command = UpdateFieldCommand.create({ tableId, fieldId, field: { notNull: false } });
      if (command.isErr()) throw new Error('Failed to relax imported required user field');
      const result = await commandBus.execute<UpdateFieldCommand, UpdateFieldResult>(
        context,
        command.value
      );
      if (result.isErr()) throw new Error('Failed to relax imported required user field');
      warnings.relaxedRequiredUserFields += 1;
      relaxed += 1;
    }
    return relaxed;
  }

  private collectImportedAuthorIds(
    records: ReadonlyArray<RestoreRecordInput>,
    scopedIds: Set<string>
  ): void {
    // A pair in an editable cell never authorizes a bare archive author id.
    for (const { createdBy, lastModifiedBy } of records) {
      if (createdBy) scopedIds.add(createdBy);
      if (lastModifiedBy) scopedIds.add(lastModifiedBy);
    }
  }

  private async lookupImportedUsers(
    tableId: string,
    scopedIds: ReadonlySet<string>,
    identityPairs: ReadonlyArray<{ id: string; email: string }>,
    userLookupService: IUserLookupService
  ) {
    const scopedResult = scopedIds.size
      ? await userLookupService.listTableUsersByIdentifiers(tableId, [...scopedIds])
      : ok<ReadonlyArray<UserLookupRecord>, DomainError>([]);
    const pairedResult = identityPairs.length
      ? await userLookupService.listUsersByIdentityPairs(identityPairs)
      : ok<ReadonlyArray<UserLookupRecord>, DomainError>([]);
    if (scopedResult.isErr() || pairedResult.isErr()) {
      throw new Error('Failed to validate imported user references');
    }
    const scopedUsersById = new Map(scopedResult.value.map((user) => [user.id, user]));
    const pairedUsersById = new Map(pairedResult.value.map((user) => [user.id, user]));
    return { scopedUsersById, pairedUsersById };
  }

  private parseImportedUserReferences(
    rawValue: unknown,
    isMultiple: boolean
  ): ReadonlyArray<{ id: string; email?: string }> | null {
    if (rawValue == null || rawValue === '') return null;
    let value = rawValue;
    if (typeof value === 'string') {
      try {
        value = JSON.parse(value);
      } catch {
        this.throwInvalidImportedUserValue();
      }
    }
    if (value == null || (isMultiple && Array.isArray(value) && value.length === 0)) return null;
    const values = isMultiple ? value : [value];
    if (!Array.isArray(values) || values.length === 0) this.throwInvalidImportedUserValue();
    return values.map((item) => {
      if (!item || typeof item !== 'object' || Array.isArray(item)) {
        this.throwInvalidImportedUserValue();
      }
      const id = Reflect.get(item, 'id');
      if (typeof id !== 'string' || id.length === 0) this.throwInvalidImportedUserValue();
      const email = Reflect.get(item, 'email');
      if (email !== undefined && (typeof email !== 'string' || email.length === 0)) {
        this.throwInvalidImportedUserValue();
      }
      return email === undefined ? { id } : { id, email: email as string };
    });
  }

  private throwInvalidImportedUserValue(): never {
    throw new CustomHttpException(
      'The imported archive contains an invalid user value',
      HttpErrorCode.VALIDATION_ERROR,
      { domainCode: 'validation.field.invalid_user_format' }
    );
  }

  private async *toAsyncIterable(
    records: ReadonlyArray<RestoreRecordInput>
  ): AsyncGenerator<RestoreRecordInput> {
    yield* records;
  }

  private async *createTableLinkFieldUpdateStream(
    entry: unzipper.Entry,
    config: Awaited<ReturnType<BaseImportV2Service['buildTableDataImportConfig']>>
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
    config: Awaited<ReturnType<BaseImportV2Service['buildTableDataImportConfig']>>,
    warnings: IBaseImportWarnings
  ): AsyncGenerator<Result<UpdateManyStreamBatchInput, DomainError>> {
    const fields = await this.prismaService.field.findMany({
      where: { tableId: config.table.id().toString(), deletedTime: null, type: FieldType.Link },
      select: { id: true, options: true, isLookup: true, isComputed: true },
    });
    const linkFields = fields
      .filter((field) => !field.isLookup && !field.isComputed)
      .map((field) => ({
        id: field.id,
        foreignTableId: (JSON.parse(field.options ?? '{}') as ILinkFieldOptions).foreignTableId,
      }));
    const targetTables = await this.prismaService.tableMeta.findMany({
      where: {
        id: { in: [...new Set(linkFields.map((field) => field.foreignTableId))] },
        deletedTime: null,
      },
      select: { id: true, dbTableName: true, baseId: true },
    });
    const targetsById = new Map(targetTables.map((table) => [table.id, table]));
    const linkTargets = new Map<string, IImportedLinkTarget>();
    for (const field of linkFields) {
      const target = targetsById.get(field.foreignTableId);
      if (!target) throw new Error('Invalid imported link target metadata');
      linkTargets.set(field.id, target);
    }

    let batch: Array<{ id: string; fields: Record<string, unknown> }> = [];
    const flush = async (): Promise<Result<UpdateManyStreamBatchInput, DomainError>> => {
      await this.filterDanglingImportedLinks(batch, linkTargets, warnings);
      const updates: RecordUpdateResult[] = [];
      for (const record of batch) {
        const recordIdResult = RecordId.create(record.id);
        if (recordIdResult.isErr()) return err(recordIdResult.error);
        const updateResult = config.table.updateRecord(
          recordIdResult.value,
          new Map(Object.entries(record.fields)),
          { typecast: true }
        );
        if (updateResult.isErr()) return err(updateResult.error);
        updates.push(updateResult.value);
      }
      batch = [];
      return ok({ table: config.table, updates });
    };

    for await (const record of this.createTableLinkFieldUpdateStream(entry, config)) {
      batch.push(record);
      if (batch.length >= linkFieldImportBatchSize) {
        const result = await flush();
        yield result;
        if (result.isErr()) return;
      }
    }
    if (batch.length) yield await flush();
  }

  private async filterDanglingImportedLinks(
    records: Array<{ id: string; fields: Record<string, unknown> }>,
    linkTargets: ReadonlyMap<string, IImportedLinkTarget>,
    warnings: IBaseImportWarnings
  ): Promise<void> {
    const references = this.collectImportedLinkReferences(records, linkTargets);
    await this.queryImportedLinkTargets(references);
    for (const record of records) {
      for (const [fieldId, value] of Object.entries(record.fields)) {
        const target = linkTargets.get(fieldId)!;
        const existing = references.get(target.id)!.existing;
        const sanitized = this.filterImportedLinkCell(value, existing);
        if (sanitized === value) continue;
        record.fields[fieldId] = sanitized;
        warnings.skippedLinkCells += 1;
      }
    }
  }

  private collectImportedLinkReferences(
    records: ReadonlyArray<{ fields: Record<string, unknown> }>,
    linkTargets: ReadonlyMap<string, IImportedLinkTarget>
  ) {
    const referencesByTarget = new Map<string, IImportedLinkReferences>();
    for (const record of records) {
      for (const [fieldId, value] of Object.entries(record.fields)) {
        const target = linkTargets.get(fieldId);
        if (!target) throw new Error('Invalid imported link field metadata');
        let references = referencesByTarget.get(target.id);
        if (!references) {
          references = { target, ids: new Set(), existing: new Set() };
          referencesByTarget.set(target.id, references);
        }
        this.collectImportedLinkCellIds(value, references.ids);
      }
    }
    return referencesByTarget;
  }

  private collectImportedLinkCellIds(value: unknown, ids: Set<string>): void {
    for (const item of Array.isArray(value) ? value : [value]) {
      const id = this.importedLinkRecordId(item);
      if (id !== undefined) ids.add(id);
    }
  }

  private importedLinkRecordId(value: unknown): string | undefined {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
    const id = Reflect.get(value, 'id');
    return typeof id === 'string' && RecordId.create(id).isOk() ? id : undefined;
  }

  private async queryImportedLinkTargets(
    referencesByTarget: ReadonlyMap<string, IImportedLinkReferences>
  ): Promise<void> {
    for (const { target, ids, existing } of referencesByTarget.values()) {
      if (!ids.size) continue;
      const container = await this.v2ContainerService.getContainerForBase(target.baseId);
      const db = container.resolve<Kysely<unknown>>(v2DataDbTokens.db);
      const targetIds = [...ids];
      for (let offset = 0; offset < targetIds.length; offset += 500) {
        const batch = targetIds.slice(offset, offset + 500);
        const result = await sql<{
          id: string;
        }>`select "__id" as "id" from ${sql.table(target.dbTableName)} where "__id" in (${sql.join(batch)})`.execute(
          db
        );
        for (const row of result.rows) existing.add(row.id);
      }
    }
  }

  private filterImportedLinkCell(value: unknown, existing: ReadonlySet<string>): unknown {
    const values = Array.isArray(value) ? value : [value];
    const filtered = values.filter((item) => {
      // Malformed values still reach normal domain validation; only valid-shaped
      // references to absent records are discarded.
      const id = this.importedLinkRecordId(item);
      return id === undefined || existing.has(id);
    });
    if (filtered.length === values.length) return value;
    if (filtered.length === 0) return null;
    return Array.isArray(value) ? filtered : filtered[0];
  }

  private toLinkFieldUpdateRecordInput(
    row: Record<string, string>,
    config: Awaited<ReturnType<BaseImportV2Service['buildTableDataImportConfig']>>
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
    value: unknown,
    field?: { dbFieldType?: string; isMultipleCellValue?: boolean; notNull?: boolean }
  ): unknown {
    if (typeof value !== 'string') {
      if (value != null || !field?.notNull) {
        return value;
      }
      return this.getNotNullDefault(
        field.dbFieldType || DbFieldType.Text,
        Boolean(field.isMultipleCellValue)
      );
    }

    if (value !== '') {
      return this.normalizeNonEmptyDotTeaCsvValue(value, field?.dbFieldType);
    }

    if (!field?.notNull) {
      return null;
    }

    return this.getNotNullDefault(
      field.dbFieldType || DbFieldType.Text,
      Boolean(field.isMultipleCellValue)
    );
  }

  private normalizeNonEmptyDotTeaCsvValue(value: string, dbFieldType?: string): unknown {
    switch (this.normalizeDbFieldType(dbFieldType)) {
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

  private toRestoreString(value: unknown) {
    return value instanceof Date ? value.toISOString() : String(value);
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
    idMapContext: {
      folderIdMap?: Record<string, string>;
      tableIdMap?: Record<string, string>;
      dashboardIdMap?: Record<string, string>;
      workflowIdMap?: Record<string, string>;
      appIdMap?: Record<string, string>;
      routineIdMap?: Record<string, string>;
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
      routineIdMap = {},
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
      routineIdMap,
    });
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
      const newId = allNodeIdMap[id];
      const { parentId: newParentId, order: effectiveOrder } = this.getImportedBaseNodePosition(
        node,
        allNodeIdMap,
        rootOrderOffset
      );
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

      const updatedNodeId = await this.persistImportedBaseNode(
        prisma,
        {
          id: newId,
          parentId: newParentId,
          resourceId: newResourceId,
          resourceType,
          baseId,
          createdBy: userId,
          order: effectiveOrder,
        },
        Boolean(copyToExistingBase || options?.updateExistingNodes)
      );
      if (updatedNodeId) {
        allNodeIdMap[id] = updatedNodeId;
      }

      createdResourceKeys.add(resourceKey);
    }

    return allNodeIdMap;
  }

  private async persistImportedBaseNode(
    prisma: Pick<PrismaService, 'baseNode'>,
    node: IImportedBaseNode,
    updateExistingNodes: boolean
  ): Promise<string | undefined> {
    const { parentId, resourceId, resourceType, baseId, order } = node;
    // Nodes may already exist after prepareNodeList self-healing.
    const existingNode = await prisma.baseNode.findFirst({
      where: { baseId, resourceType, resourceId },
    });

    if (existingNode && updateExistingNodes) {
      await prisma.baseNode.update({
        where: { id: existingNode.id },
        data: { parentId, order },
      });
      return existingNode.id;
    }

    if (existingNode) {
      this.logger.warn(
        `base-import-service: node already exists in database, baseId: ${baseId}, resourceType: ${resourceType}, resourceId: ${resourceId}`
      );
      return;
    }

    await prisma.baseNode.create({ data: node });
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
}
