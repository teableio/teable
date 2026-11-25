import { HttpException, HttpStatus, Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { CellFormat, FieldKeyType, FieldType, HttpErrorCode, IdPrefix } from '@teable/core';
import type { IFieldRo, IFieldVo, ILinkFieldOptionsRo, IRecord, ISnapshotBase } from '@teable/core';
import { PrismaService, ProvisionState } from '@teable/db-main-prisma';
import {
  CreateRecordAction,
  type ICreateTableWithDefault,
  type IDuplicateTableRo,
  type IDuplicateTableVo,
  type ITableFullVo,
  type ITableVo,
} from '@teable/openapi';
import {
  mapDomainErrorToHttpError,
  mapDomainErrorToHttpStatus,
  type ITableDto,
} from '@teable/v2-contract-http';
import {
  executeCreateTableEndpoint,
  executeDeleteTableEndpoint,
  executeDuplicateTableEndpoint,
  executeGetTableByIdEndpoint,
  executeListTableRecordsEndpoint,
  executeRenameTableEndpoint,
  executeRestoreTableEndpoint,
  executeUpdateTablePropertiesEndpoint,
} from '@teable/v2-contract-http-implementation/handlers';
import {
  BaseId,
  GetDefaultViewIdQuery,
  RenameTableStorageCommand,
  v2CoreTokens,
  type GetDefaultViewIdResult,
  type ICommandBus,
  type IExecutionContext,
  type IQueryBus,
  type TableStorageRenameResult,
} from '@teable/v2-core';
import { ClsService } from 'nestjs-cls';
import { CustomHttpException } from '../../../custom.exception';
import { EventEmitterService } from '../../../event-emitter/event-emitter.service';
import { Events, TableUpdateEvent, type IChangeTable } from '../../../event-emitter/events';
import type { IRawOpMap } from '../../../share-db/interface';
import { ShareDbService } from '../../../share-db/share-db.service';
import type { IClsStore } from '../../../types/cls';
import { AuditScope } from '../../audit/audit-scope';
import { Audit } from '../../audit/audit.decorator';
import { PermissionService } from '../../auth/permission.service';
import { SpaceDataDbMigrationGuardService } from '../../space/space-data-db-migration-guard.service';
import { TableLifecycleCleanupService } from '../../table-lifecycle/table-lifecycle-cleanup.service';
import { TrustedRetentionContextService } from '../../table-lifecycle/trusted-retention-context.service';
import { V2ContainerService } from '../../v2/v2-container.service';
import { V2ExecutionContextFactory } from '../../v2/v2-execution-context.factory';
import { throwV2Error } from '../../v2/v2-http-error';
import { TableDuplicatePolicyService } from '../table-duplicate-policy.service';
import { TableSnapshotReadService } from '../table-snapshot-read.service';
import { TABLE_PERMANENT_DELETE_ACTION } from './table-audit.constants';
import { mapLegacyCreateTableToV2Input } from './table-open-api-v2.mapper';

const internalServerError = 'Internal server error';

@Injectable()
export class TableOpenApiV2Service {
  private readonly logger = new Logger(TableOpenApiV2Service.name);
  constructor(
    private readonly v2ContainerService: V2ContainerService,
    private readonly v2ContextFactory: V2ExecutionContextFactory,
    private readonly prismaService: PrismaService,
    private readonly tableDuplicatePolicyService: TableDuplicatePolicyService,
    private readonly tableSnapshotReadService: TableSnapshotReadService,
    private readonly shareDbService: ShareDbService,
    private readonly audit: AuditScope,
    private readonly cls: ClsService<IClsStore>,
    private readonly trustedRetention: TrustedRetentionContextService,
    private readonly tableLifecycleCleanup: TableLifecycleCleanupService,
    private readonly permissionService: PermissionService,
    @Optional()
    @Inject(SpaceDataDbMigrationGuardService)
    private readonly spaceDataDbMigrationGuard?: SpaceDataDbMigrationGuardService,
    @Optional() private readonly eventEmitterService?: EventEmitterService
  ) {}

  private async assertBaseWritable(baseId: string) {
    await this.spaceDataDbMigrationGuard?.assertBaseWritable(baseId);
  }

  private async assertTableWritable(tableId: string) {
    await this.spaceDataDbMigrationGuard?.assertTableWritable(tableId);
  }

  async updateDbTableName(baseId: string, tableId: string, name: string): Promise<void> {
    await this.assertBaseWritable(baseId);
    const current = await this.prismaService.tableMeta.findFirst({
      where: { id: tableId, baseId, deletedTime: null },
      select: { name: true, description: true, icon: true, order: true },
    });
    const container = await this.v2ContainerService.getContainerForBase(baseId);
    const context = await this.v2ContextFactory.createContext(container);
    const command = RenameTableStorageCommand.create({
      baseId,
      tableId,
      dbTableName: `${baseId}.${name}`,
    });
    if (command.isErr())
      throwV2Error(
        mapDomainErrorToHttpError(command.error),
        mapDomainErrorToHttpStatus(command.error)
      );
    const result = await container
      .resolve<ICommandBus>(v2CoreTokens.commandBus)
      .execute<RenameTableStorageCommand, TableStorageRenameResult>(context, command.value);
    if (result.isErr()) {
      if (result.error.code === 'table.db_table_name_exists') {
        throw new CustomHttpException(
          `dbTableName ${name} already exists`,
          HttpErrorCode.VALIDATION_ERROR,
          {
            localization: { i18nKey: 'httpErrors.table.dbTableNameAlreadyExists' },
          }
        );
      }
      if (result.error.tags.includes('not-found')) {
        throw new CustomHttpException(`table ${tableId} not found`, HttpErrorCode.NOT_FOUND, {
          localization: { i18nKey: 'httpErrors.table.notFound' },
        });
      }
      throwV2Error(
        mapDomainErrorToHttpError(result.error),
        mapDomainErrorToHttpStatus(result.error)
      );
    }
    const change = result.value;
    if (this.cls.isActive()) {
      this.cls.set('dataLoaderCache.fieldData', undefined);
      this.cls.set('dataLoaderCache.tableData', undefined);
    }
    const map: IRawOpMap = {
      [`${IdPrefix.Table}_${baseId}`]: {
        [tableId]: {
          src: this.cls.getId() || 'unknown',
          seq: 1,
          m: { ts: Date.now() },
          v: change.previousVersion,
          op: [
            { p: ['dbTableName'], oi: change.dbTableName, od: change.previousDbTableName },
            { p: ['version'], oi: change.previousVersion + 1, od: change.previousVersion },
            { p: ['lastModifiedBy'], oi: change.lastModifiedBy, od: change.previousLastModifiedBy },
            {
              p: ['lastModifiedTime'],
              oi: change.lastModifiedTime,
              od: change.previousLastModifiedTime,
            },
          ],
        },
      },
    };
    if (!this.shareDbService.shareDbAdapter.closed) {
      try {
        await this.shareDbService.publishOpsMap([map]);
      } catch (error) {
        this.logger.error(`Failed to publish table storage op: tableId=${tableId}`, error);
      }
    }
    const user = this.cls.get('user');
    await this.eventEmitterService?.emitAsync(
      Events.TABLE_UPDATE,
      new TableUpdateEvent(
        {
          baseId,
          table: {
            id: tableId,
            name: { oldValue: current?.name, newValue: current?.name },
            description: { oldValue: current?.description, newValue: current?.description },
            icon: { oldValue: current?.icon, newValue: current?.icon },
            order: { oldValue: current?.order, newValue: current?.order },
            dbTableName: { oldValue: change.previousDbTableName, newValue: change.dbTableName },
          } as IChangeTable,
        },
        { user: user ? { id: user.id, name: user.name, email: user.email } : undefined }
      )
    );
  }

  async getDefaultViewId(tableId: string): Promise<{ id: string }> {
    const container = await this.v2ContainerService.getContainerForTable(tableId);
    const queryBus = container.resolve<IQueryBus>(v2CoreTokens.queryBus);
    const context = await this.v2ContextFactory.createContext(container);
    const queryResult = GetDefaultViewIdQuery.create({ tableId });
    if (queryResult.isErr()) {
      throwV2Error(
        mapDomainErrorToHttpError(queryResult.error),
        mapDomainErrorToHttpStatus(queryResult.error)
      );
    }

    const result = await queryBus.execute<GetDefaultViewIdQuery, GetDefaultViewIdResult>(
      context,
      queryResult.value
    );
    if (result.isErr()) {
      throwV2Error(
        mapDomainErrorToHttpError(result.error),
        mapDomainErrorToHttpStatus(result.error)
      );
    }

    return { id: result.value.viewId };
  }

  async getTable(baseId: string, tableId: string): Promise<ITableVo> {
    const container = await this.v2ContainerService.getContainerForBase(baseId);
    const queryBus = container.resolve<IQueryBus>(v2CoreTokens.queryBus);
    const context = await this.v2ContextFactory.createContext(container);
    const result = await executeGetTableByIdEndpoint(context, { baseId, tableId }, queryBus);

    if (result.status === 200 && result.body.ok) {
      return this.overlayTableMeta(this.mapV2TableToVo(result.body.data.table), tableId);
    }

    if (!result.body.ok) {
      throwV2Error(result.body.error, result.status);
    }

    throw new HttpException(internalServerError, HttpStatus.INTERNAL_SERVER_ERROR);
  }

  /** Table navigation reads metadata, not field schemas of every sibling table. */
  async getTables(baseId: string): Promise<ITableVo[]> {
    const baseIdResult = BaseId.create(baseId);
    if (baseIdResult.isErr()) {
      throwV2Error(
        mapDomainErrorToHttpError(baseIdResult.error),
        mapDomainErrorToHttpStatus(baseIdResult.error)
      );
    }

    const visibleIds = await this.permissionService.getBaseShareVisibleResourceIds(baseId, 'table');
    const tables = await this.prismaService.tableMeta.findMany({
      where: {
        baseId,
        deletedTime: null,
        provisionState: ProvisionState.ready,
        ...(visibleIds ? { id: { in: [...visibleIds] } } : {}),
      },
      orderBy: { order: 'asc' },
      select: {
        id: true,
        name: true,
        dbTableName: true,
        actorStorageVersion: true,
        description: true,
        icon: true,
        order: true,
        lastModifiedTime: true,
      },
    });
    const defaultViewIdByTableId = await this.getDefaultViewIds(tables.map((table) => table.id));
    return tables.map((table) => ({
      id: table.id,
      name: table.name,
      dbTableName: table.dbTableName,
      actorStorageVersion: table.actorStorageVersion === 1 ? 1 : 0,
      ...(table.description != null ? { description: table.description } : {}),
      ...(table.icon != null ? { icon: table.icon } : {}),
      order: table.order,
      ...(table.lastModifiedTime ? { lastModifiedTime: table.lastModifiedTime.toISOString() } : {}),
      ...(defaultViewIdByTableId.has(table.id)
        ? { defaultViewId: defaultViewIdByTableId.get(table.id) }
        : {}),
    }));
  }

  async getSnapshotBulk(
    baseId: string,
    ids: string[],
    options: { ignoreDefaultViewId?: boolean } = {}
  ): Promise<ISnapshotBase<ITableVo>[]> {
    return this.tableSnapshotReadService.getSnapshotBulk(baseId, ids, options);
  }

  private async getDefaultViewIds(tableIds: string[]): Promise<Map<string, string>> {
    const defaultViewIdByTableId = new Map<string, string>();
    if (!tableIds.length) return defaultViewIdByTableId;

    const views = await this.prismaService.view.findMany({
      where: { tableId: { in: tableIds }, deletedTime: null },
      select: { id: true, tableId: true, order: true },
      orderBy: { order: 'asc' },
    });
    for (const view of views) {
      if (!defaultViewIdByTableId.has(view.tableId)) {
        defaultViewIdByTableId.set(view.tableId, view.id);
      }
    }
    return defaultViewIdByTableId;
  }

  async getDocIds(baseId: string, projectionTableIds?: string[]): Promise<{ ids: string[] }> {
    return this.tableSnapshotReadService.getDocIdsByQuery(baseId, { projectionTableIds });
  }

  async updateName(baseId: string, tableId: string, name: string): Promise<void> {
    await this.assertBaseWritable(baseId);
    const current = await this.prismaService.tableMeta.findFirst({
      where: { id: tableId, baseId, deletedTime: null },
      select: {
        name: true,
        dbTableName: true,
        description: true,
        icon: true,
        order: true,
      },
    });
    const container = await this.v2ContainerService.getContainerForBase(baseId);
    const commandBus = container.resolve<ICommandBus>(v2CoreTokens.commandBus);
    const context = await this.v2ContextFactory.createContext(container);
    const result = await executeRenameTableEndpoint(context, { baseId, tableId, name }, commandBus);

    if (result.status === 200 && result.body.ok) {
      const user = this.cls.get('user');
      const dbTableName = current?.dbTableName;
      const description = current?.description;
      const icon = current?.icon;
      const order = current?.order;
      await this.eventEmitterService?.emitAsync(
        Events.TABLE_UPDATE,
        new TableUpdateEvent(
          {
            baseId,
            table: {
              id: tableId,
              name: { oldValue: current?.name, newValue: name },
              dbTableName: { oldValue: dbTableName, newValue: dbTableName },
              description: { oldValue: description, newValue: description },
              icon: { oldValue: icon, newValue: icon },
              order: { oldValue: order, newValue: order },
            } as IChangeTable,
          },
          {
            user: user ? { id: user.id, name: user.name, email: user.email } : undefined,
          }
        )
      );
      return;
    }

    if (!result.body.ok) {
      throwV2Error(result.body.error, result.status);
    }

    throw new HttpException(internalServerError, HttpStatus.INTERNAL_SERVER_ERROR);
  }

  async updateIcon(baseId: string, tableId: string, icon: string | null): Promise<void> {
    await this.assertBaseWritable(baseId);
    const container = await this.v2ContainerService.getContainerForBase(baseId);
    const commandBus = container.resolve<ICommandBus>(v2CoreTokens.commandBus);
    const context = await this.v2ContextFactory.createContext(container);
    const result = await executeUpdateTablePropertiesEndpoint(
      context,
      { baseId, tableId, icon },
      commandBus
    );

    if (result.status === 200 && result.body.ok) {
      return;
    }

    if (!result.body.ok) {
      throwV2Error(result.body.error, result.status);
    }

    throw new HttpException(internalServerError, HttpStatus.INTERNAL_SERVER_ERROR);
  }

  async updateDescription(
    baseId: string,
    tableId: string,
    description: string | null
  ): Promise<void> {
    await this.assertBaseWritable(baseId);
    const container = await this.v2ContainerService.getContainerForBase(baseId);
    const commandBus = container.resolve<ICommandBus>(v2CoreTokens.commandBus);
    const context = await this.v2ContextFactory.createContext(container);
    const result = await executeUpdateTablePropertiesEndpoint(
      context,
      { baseId, tableId, description },
      commandBus
    );

    if (result.status === 200 && result.body.ok) {
      return;
    }

    if (!result.body.ok) {
      throwV2Error(result.body.error, result.status);
    }

    throw new HttpException(internalServerError, HttpStatus.INTERNAL_SERVER_ERROR);
  }

  private mapV2TableToVo(table: ITableDto): ITableVo {
    const dbTableName = table.dbTableName ?? '';
    const defaultViewId = table.views?.[0]?.id;
    return {
      id: table.id,
      name: table.name,
      actorStorageVersion: table.actorStorageVersion,
      dbTableName,
      description: table.description ?? undefined,
      icon: table.icon ?? undefined,
      ...(defaultViewId ? { defaultViewId } : {}),
    };
  }

  private async overlayTableMeta(table: ITableVo, tableId: string): Promise<ITableVo> {
    const meta = await this.prismaService.tableMeta.findUnique({
      where: { id: tableId },
      select: { order: true, lastModifiedTime: true, icon: true, description: true },
    });
    return {
      ...table,
      ...(meta ? { icon: meta.icon ?? undefined, description: meta.description ?? undefined } : {}),
      ...(meta?.order != null ? { order: meta.order } : {}),
      ...(meta?.lastModifiedTime ? { lastModifiedTime: meta.lastModifiedTime.toISOString() } : {}),
    };
  }

  private async collectCrossSpaceAffectedFields(
    tableId: string
  ): Promise<Array<{ fieldId: string; fieldName: string; type: string }>> {
    return this.tableDuplicatePolicyService.previewCrossSpaceAffectedFields(tableId);
  }

  /** Read-only host policy shared by v2 execution and operation preview. */
  async previewDuplicateTableV2Policy(
    baseId: string,
    tableId: string
  ): Promise<{ readonly affectedFieldCount: number }> {
    await this.assertBaseWritable(baseId);
    await this.assertTableWritable(tableId);
    const affected = await this.collectCrossSpaceAffectedFields(tableId);
    return { affectedFieldCount: affected.length };
  }

  @Audit({
    // Only open the CreateDefaultRecords scope for the canonical 3-empty-row UI default.
    // Custom records sent via API skip the attribution and produce plain atomic record events.
    rootAction: (_baseId: string, ro: ICreateTableWithDefault) => {
      const isDefault =
        ro.records?.length === 3 &&
        ro.records?.every(({ fields }) => Object.keys(fields).length === 0);
      return isDefault ? CreateRecordAction.CreateDefaultRecords : undefined;
    },
    resourceId: (baseId: string) => baseId,
    params: (_baseId: string, ro: ICreateTableWithDefault) =>
      ro as unknown as Record<string, unknown>,
  })
  async createTable(baseId: string, createTableRo: ICreateTableWithDefault): Promise<ITableFullVo> {
    await this.assertBaseWritable(baseId);
    const container = await this.v2ContainerService.getContainerForBase(baseId);
    const commandBus = container.resolve<ICommandBus>(v2CoreTokens.commandBus);
    const context = await this.v2ContextFactory.createContext(container);
    const normalizedCreateTableRo = await this.normalizeLegacyCreateTableRo(baseId, createTableRo);
    const result = await executeCreateTableEndpoint(
      context,
      mapLegacyCreateTableToV2Input(baseId, normalizedCreateTableRo),
      commandBus
    );

    if (result.status === 201 && result.body.ok) {
      return await this.buildLegacyCreateTableResponse(
        normalizedCreateTableRo,
        result.body.data.table,
        context,
        container.resolve<IQueryBus>(v2CoreTokens.queryBus)
      );
    }

    if (!result.body.ok) {
      throwV2Error(result.body.error, result.status);
    }

    throw new HttpException(internalServerError, HttpStatus.INTERNAL_SERVER_ERROR);
  }

  async deleteTable(
    baseId: string,
    tableId: string,
    mode: 'soft' | 'permanent' = 'soft'
  ): Promise<void> {
    if (mode !== 'permanent') {
      return this.executeDeleteTable(baseId, tableId, mode);
    }
    // Same shape as the v1 permanent delete: the TableDeleted projection's `table.delete` row runs
    // inside a `table.permanent-delete` operation, and the permanent row is written once it is gone.
    const table = await this.prismaService.tableMeta
      .findUnique({ where: { id: tableId }, select: { name: true } })
      .catch(() => null);
    return this.audit.withOperation(
      { rootAction: TABLE_PERMANENT_DELETE_ACTION, resourceId: baseId },
      async () => {
        await this.executeDeleteTable(baseId, tableId, mode);
        await this.audit.emitAtomic({
          action: TABLE_PERMANENT_DELETE_ACTION,
          resourceId: tableId,
          params: { baseId, tableId, ...(table ? { name: table.name } : {}) },
        });
      }
    );
  }

  async permanentDeleteTables(baseId: string, tableIds: string[]): Promise<void> {
    for (const tableId of tableIds) {
      if (this.cls.get('user.id')) {
        await this.deleteTable(baseId, tableId, 'permanent');
      } else {
        await this.executeDeleteTable(baseId, tableId, 'permanent');
      }
    }
  }

  private async executeDeleteTable(
    baseId: string,
    tableId: string,
    mode: 'soft' | 'permanent'
  ): Promise<void> {
    await this.assertBaseWritable(baseId);
    // Prove the expired root and target using metadata before opening a customer database.
    const retentionContainer =
      mode === 'permanent' && !this.cls.get('user.id') && this.trustedRetention.hasActive()
        ? await this.v2ContainerService.getContainer()
        : undefined;
    const retentionContext = retentionContainer
      ? await this.trustedRetention.createContextForTable(baseId, tableId, retentionContainer)
      : undefined;
    const purgeState =
      mode === 'permanent'
        ? await this.tableLifecycleCleanup.captureNativePurgeState(tableId)
        : undefined;

    try {
      const container = await this.v2ContainerService.getContainerForBase(baseId);
      const commandBus = container.resolve<ICommandBus>(v2CoreTokens.commandBus);
      const context = retentionContext ?? (await this.v2ContextFactory.createContext(container));
      const result = await executeDeleteTableEndpoint(
        context,
        { baseId, tableId, mode },
        commandBus
      );
      if (!result.body.ok) {
        throwV2Error(result.body.error, result.status);
      }
      if (result.status !== 200) {
        throw new HttpException(internalServerError, HttpStatus.INTERNAL_SERVER_ERROR);
      }
    } catch (error) {
      if (!retentionContainer || !purgeState) throw error;
      // Admission may have changed while the routed connection or command was failing.
      await this.trustedRetention.createContextForTable(baseId, tableId, retentionContainer);
      await this.tableLifecycleCleanup.cleanupUnavailableRetainedTable(
        baseId,
        tableId,
        purgeState,
        error
      );
      return;
    }

    if (purgeState) {
      await this.tableLifecycleCleanup.cleanupAfterNativePurge(baseId, tableId, purgeState);
    }
  }

  async restoreTable(baseId: string, tableId: string): Promise<void> {
    await this.assertBaseWritable(baseId);
    const container = await this.v2ContainerService.getContainerForBase(baseId);
    const commandBus = container.resolve<ICommandBus>(v2CoreTokens.commandBus);
    const context = await this.v2ContextFactory.createContext(container);

    const result = await executeRestoreTableEndpoint(
      context,
      {
        baseId,
        tableId,
      },
      commandBus
    );

    if (result.status === 200 && result.body.ok) {
      return;
    }

    if (!result.body.ok) {
      throwV2Error(result.body.error, result.status);
    }

    throw new HttpException(internalServerError, HttpStatus.INTERNAL_SERVER_ERROR);
  }

  @Audit({
    rootAction: (_baseId: string, _tableId: string, ro: IDuplicateTableRo) =>
      ro.includeRecords ? CreateRecordAction.TableDuplicate : undefined,
    resourceId: (_baseId: string, tableId: string) => tableId,
    params: (_baseId: string, _tableId: string, ro: IDuplicateTableRo) =>
      ro as unknown as Record<string, unknown>,
  })
  async duplicateTable(
    baseId: string,
    tableId: string,
    duplicateTableRo: IDuplicateTableRo
  ): Promise<IDuplicateTableVo> {
    const { affectedFieldCount } = await this.previewDuplicateTableV2Policy(baseId, tableId);
    // The v2 duplicate command does not silently downgrade cross-space fields;
    // execution and preview share this explicit blocker.
    if (affectedFieldCount > 0) {
      throw new CustomHttpException(
        'v2 will not silently downgrade cross-space fields when duplicating a table',
        HttpErrorCode.VALIDATION_ERROR,
        { localization: { i18nKey: 'httpErrors.table.duplicateCrossSpaceField' } }
      );
    }

    const container = await this.v2ContainerService.getContainerForBase(baseId);
    const commandBus = container.resolve<ICommandBus>(v2CoreTokens.commandBus);
    const context = await this.v2ContextFactory.createContext(container);
    const result = await executeDuplicateTableEndpoint(
      context,
      {
        baseId,
        tableId,
        name: duplicateTableRo.name,
        includeRecords: duplicateTableRo.includeRecords,
      },
      commandBus
    );

    if (result.status === 201 && result.body.ok) {
      return await this.buildLegacyDuplicateTableResponse(
        baseId,
        tableId,
        result.body.data.table,
        result.body.data.fieldIdMap,
        result.body.data.viewIdMap,
        context,
        container.resolve<IQueryBus>(v2CoreTokens.queryBus)
      );
    }

    if (!result.body.ok) {
      throwV2Error(result.body.error, result.status);
    }

    throw new HttpException(internalServerError, HttpStatus.INTERNAL_SERVER_ERROR);
  }

  private async buildLegacyCreateTableResponse(
    createTableRo: ICreateTableWithDefault,
    tableDto: ITableDto,
    context: IExecutionContext,
    queryBus: IQueryBus
  ): Promise<ITableFullVo> {
    const table = this.mapV2TableToVo(tableDto);
    const records = await this.getCreatedRecords(table, createTableRo, context, queryBus);
    return {
      ...table,
      fields: tableDto.fields as IFieldVo[],
      views: tableDto.views as ITableFullVo['views'],
      records,
    };
  }

  private async buildLegacyDuplicateTableResponse(
    baseId: string,
    sourceTableId: string,
    tableDto: ITableDto,
    fieldMap: Record<string, string>,
    viewMap: Record<string, string>,
    context: IExecutionContext,
    queryBus: IQueryBus
  ): Promise<IDuplicateTableVo> {
    const table = this.mapV2TableToVo(tableDto);
    const fields = await this.buildLegacyDuplicateFieldResponse(
      baseId,
      sourceTableId,
      tableDto.fields as IFieldVo[],
      fieldMap,
      context,
      queryBus
    );
    return {
      ...table,
      fields,
      views: tableDto.views as IDuplicateTableVo['views'],
      fieldMap,
      viewMap,
    };
  }

  private async getCreatedRecords(
    table: ITableVo,
    createTableRo: ICreateTableWithDefault,
    context: IExecutionContext,
    queryBus: IQueryBus
  ): Promise<IRecord[]> {
    const total = createTableRo.records?.length ?? 0;
    if (total === 0) {
      return [];
    }

    const records: IRecord[] = [];
    for (let offset = 0; offset < total; offset += 1000) {
      const limit = Math.min(1000, total - offset);
      const result = await executeListTableRecordsEndpoint(
        context,
        {
          tableId: table.id,
          viewId: table.defaultViewId,
          fieldKeyType: createTableRo.fieldKeyType ?? FieldKeyType.Name,
          cellFormat: CellFormat.Json,
          limit,
          offset,
        },
        queryBus
      );

      if (result.status === 200 && result.body.ok) {
        records.push(...(result.body.data.records as IRecord[]));
        continue;
      }

      if (!result.body.ok) {
        throwV2Error(result.body.error, result.status);
      }

      throw new HttpException(internalServerError, HttpStatus.INTERNAL_SERVER_ERROR);
    }

    const recordById = new Map(records.map((record) => [record.id, record] as const));
    return records
      .map((record) => recordById.get(record.id))
      .filter((record): record is IRecord => record != null);
  }

  private async buildLegacyDuplicateFieldResponse(
    baseId: string,
    sourceTableId: string,
    duplicatedFields: IFieldVo[],
    fieldMap: Record<string, string>,
    context: IExecutionContext,
    queryBus: IQueryBus
  ): Promise<IFieldVo[]> {
    const sourceResult = await executeGetTableByIdEndpoint(
      context,
      { baseId, tableId: sourceTableId },
      queryBus
    );
    const sourceFields =
      sourceResult.status === 200 && sourceResult.body.ok
        ? (sourceResult.body.data.table.fields as IFieldVo[])
        : [];
    const sourceFieldIdByDuplicatedId = new Map(
      Object.entries(fieldMap).map(([sourceFieldId, duplicatedFieldId]) => [
        duplicatedFieldId,
        sourceFieldId,
      ])
    );
    const sourceFieldById = new Map(sourceFields.map((field) => [field.id, field] as const));

    return duplicatedFields.map((field) => {
      const sourceFieldId = sourceFieldIdByDuplicatedId.get(field.id);
      if (!sourceFieldId) {
        return field;
      }
      const sourceField = sourceFieldById.get(sourceFieldId);
      if (!sourceField) {
        return field;
      }
      return {
        ...field,
        ...(sourceField.dbFieldName ? { dbFieldName: sourceField.dbFieldName } : {}),
        ...(sourceField.dbFieldType ? { dbFieldType: sourceField.dbFieldType } : {}),
      };
    });
  }

  private async normalizeLegacyCreateTableRo(
    baseId: string,
    createTableRo: ICreateTableWithDefault
  ): Promise<ICreateTableWithDefault> {
    const withLookupFieldIds = await this.populateLegacyLinkLookupFieldIds(baseId, createTableRo);
    const normalizedDbTableName = this.normalizeLegacyDbTableName(
      baseId,
      withLookupFieldIds.dbTableName
    );

    if (normalizedDbTableName === withLookupFieldIds.dbTableName) {
      return withLookupFieldIds;
    }

    return {
      ...withLookupFieldIds,
      dbTableName: normalizedDbTableName,
    };
  }

  private normalizeLegacyDbTableName(baseId: string, dbTableName?: string): string | undefined {
    if (!dbTableName) {
      return dbTableName;
    }

    const legacyPrefix = `${baseId}.`;
    if (dbTableName.startsWith(legacyPrefix)) {
      return dbTableName;
    }

    return `${legacyPrefix}${dbTableName}`;
  }

  private async populateLegacyLinkLookupFieldIds(
    baseId: string,
    createTableRo: ICreateTableWithDefault
  ): Promise<ICreateTableWithDefault> {
    const fields = createTableRo.fields ?? [];
    const foreignBaseIdByTableId = new Map(
      fields.flatMap((field) => {
        if (field.type !== FieldType.Link || field.isLookup) {
          return [];
        }

        const options =
          field.options && typeof field.options === 'object' && !Array.isArray(field.options)
            ? (field.options as Record<string, unknown>)
            : undefined;
        if (typeof options?.lookupFieldId === 'string') {
          return [];
        }

        const foreignTableId = options?.foreignTableId;
        if (typeof foreignTableId !== 'string') {
          return [];
        }
        const foreignBaseId = typeof options?.baseId === 'string' ? options.baseId : baseId;
        return [[foreignTableId, foreignBaseId] as const];
      })
    );

    if (foreignBaseIdByTableId.size === 0) {
      return createTableRo;
    }

    const primaryFieldIdByTableId = new Map<string, string>();
    await Promise.all(
      [...foreignBaseIdByTableId].map(async ([foreignTableId, foreignBaseId]) => {
        const container = await this.v2ContainerService.getContainerForBase(foreignBaseId);
        const queryBus = container.resolve<IQueryBus>(v2CoreTokens.queryBus);
        const context = await this.v2ContextFactory.createContext(container);
        const foreignResult = await executeGetTableByIdEndpoint(
          context,
          { baseId: foreignBaseId, tableId: foreignTableId },
          queryBus
        );
        if (foreignResult.status !== 200 || !foreignResult.body.ok) {
          return;
        }
        const primaryField = (foreignResult.body.data.table.fields as IFieldVo[]).find(
          (field) => (field as Record<string, unknown>).isPrimary === true
        );
        if (primaryField?.id) {
          primaryFieldIdByTableId.set(foreignTableId, primaryField.id);
        }
      })
    );

    let changed = false;
    const nextFields = fields.map<IFieldRo>((field) => {
      if (field.type !== FieldType.Link || field.isLookup) {
        return field;
      }

      const options =
        field.options && typeof field.options === 'object' && !Array.isArray(field.options)
          ? (field.options as Record<string, unknown>)
          : undefined;
      if (typeof options?.lookupFieldId === 'string') {
        return field;
      }

      if (typeof options?.relationship !== 'string') {
        return field;
      }

      const foreignTableId =
        typeof options?.foreignTableId === 'string' ? options.foreignTableId : null;
      if (!foreignTableId) {
        return field;
      }

      const lookupFieldId = primaryFieldIdByTableId.get(foreignTableId);
      if (!lookupFieldId) {
        return field;
      }

      changed = true;
      const nextOptions: ILinkFieldOptionsRo = {
        ...(field.options as ILinkFieldOptionsRo),
        lookupFieldId,
      };
      return {
        ...field,
        options: nextOptions,
      };
    });

    if (!changed) {
      return createTableRo;
    }

    return {
      ...createTableRo,
      fields: nextFields,
    };
  }
}
