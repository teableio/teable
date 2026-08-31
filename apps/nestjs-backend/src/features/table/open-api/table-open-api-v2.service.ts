import { HttpException, HttpStatus, Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { CellFormat, FieldKeyType, FieldType, HttpErrorCode } from '@teable/core';
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
  executeListTablesEndpoint,
  executeRenameTableEndpoint,
  executeRestoreTableEndpoint,
  executeUpdateTablePropertiesEndpoint,
} from '@teable/v2-contract-http-implementation/handlers';
import { GetDefaultViewIdQuery, v2CoreTokens } from '@teable/v2-core';
import type {
  GetDefaultViewIdResult,
  ICommandBus,
  IExecutionContext,
  IQueryBus,
} from '@teable/v2-core';
import { ClsService } from 'nestjs-cls';
import { InjectDbProvider } from '../../../db-provider/db.provider';
import { IDbProvider } from '../../../db-provider/db.provider.interface';
import { DatabaseRouter } from '../../../global/database-router.service';
import type { IClsStore } from '../../../types/cls';
import { CustomHttpException } from '../../../custom.exception';
import { EventEmitterService } from '../../../event-emitter/event-emitter.service';
import { Events, TableUpdateEvent, type IChangeTable } from '../../../event-emitter/events';
import { AuditScope } from '../../audit/audit-scope';
import { Audit } from '../../audit/audit.decorator';
import { RecordHistoryColdStorageService } from '../../record-history-cold/record-history-cold-storage.service';
import { SpaceDataDbMigrationGuardService } from '../../space/space-data-db-migration-guard.service';
import { V2ContainerService } from '../../v2/v2-container.service';
import { V2ExecutionContextFactory } from '../../v2/v2-execution-context.factory';
import { throwV2Error } from '../../v2/v2-http-error';
import { TableDuplicateService } from '../table-duplicate.service';
import { mapLegacyCreateTableToV2Input } from './table-open-api-v2.mapper';

const internalServerError = 'Internal server error';

@Injectable()
export class TableOpenApiV2Service {
  constructor(
    private readonly v2ContainerService: V2ContainerService,
    private readonly v2ContextFactory: V2ExecutionContextFactory,
    private readonly prismaService: PrismaService,
    @InjectDbProvider() private readonly dbProvider: IDbProvider,
    private readonly tableDuplicateLegacyService: TableDuplicateService,
    private readonly audit: AuditScope,
    private readonly cls: ClsService<IClsStore>,
    private readonly databaseRouter: DatabaseRouter,
    private readonly recordHistoryColdStorage: RecordHistoryColdStorageService,
    @Optional()
    @Inject(SpaceDataDbMigrationGuardService)
    private readonly spaceDataDbMigrationGuard?: SpaceDataDbMigrationGuardService,
    @Optional() private readonly eventEmitterService?: EventEmitterService
  ) {}

  private readonly logger = new Logger(TableOpenApiV2Service.name);

  /**
   * the v2 permanent-delete flow drops the physical table via the command
   * bus but leaves record_history buffer rows and the cold prefix behind
   * (the v1 cleanTablesRelatedData hook never runs on this path) — clean
   * both here, best-effort: leftovers are safe (discovery skips orphan
   * buffer rows; a stray prefix only costs storage until the reaper).
   */
  private async cleanupRecordHistoryAfterPermanentDelete(
    baseId: string,
    tableId: string
  ): Promise<void> {
    try {
      const routed = await this.databaseRouter.dataPrismaForBase(baseId);
      const dataPrisma =
        'txClient' in routed && typeof routed.txClient === 'function' ? routed.txClient() : routed;
      await dataPrisma.recordHistory.deleteMany({ where: { tableId } });
    } catch (error) {
      this.logger.warn(`failed to clean record_history buffer for ${tableId}: ${error}`);
    }
    await this.recordHistoryColdStorage
      .deleteTablePrefix(tableId)
      .catch((error) =>
        this.logger.warn(`failed to delete cold history prefix for ${tableId}: ${error}`)
      );
  }

  private async assertBaseWritable(baseId: string) {
    await this.spaceDataDbMigrationGuard?.assertBaseWritable(baseId);
  }

  private async assertTableWritable(tableId: string) {
    await this.spaceDataDbMigrationGuard?.assertTableWritable(tableId);
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

  async getTables(baseId: string): Promise<ITableVo[]> {
    const container = await this.v2ContainerService.getContainerForBase(baseId);
    const queryBus = container.resolve<IQueryBus>(v2CoreTokens.queryBus);
    const context = await this.v2ContextFactory.createContext(container);
    const result = await executeListTablesEndpoint(context, { baseId, sortBy: 'name' }, queryBus);

    if (result.status === 200 && result.body.ok) {
      const tables = result.body.data.tables.map((table) => this.mapV2TableToVo(table));
      const metas = await this.prismaService.tableMeta.findMany({
        where: { baseId, deletedTime: null },
        select: { id: true, order: true, lastModifiedTime: true },
      });
      const metaById = new Map(metas.map((meta) => [meta.id, meta]));
      return tables
        .map((table) => {
          const meta = metaById.get(table.id);
          return {
            ...table,
            ...(meta?.order != null ? { order: meta.order } : {}),
            ...(meta?.lastModifiedTime
              ? { lastModifiedTime: meta.lastModifiedTime.toISOString() }
              : {}),
          };
        })
        .sort((left, right) => (left.order ?? 0) - (right.order ?? 0));
    }

    if (!result.body.ok) {
      throwV2Error(result.body.error, result.status);
    }

    throw new HttpException(internalServerError, HttpStatus.INTERNAL_SERVER_ERROR);
  }

  async getSnapshotBulk(baseId: string, ids: string[]): Promise<ISnapshotBase<ITableVo>[]> {
    const tables = await this.prismaService.tableMeta.findMany({
      where: { baseId, id: { in: ids }, deletedTime: null, provisionState: ProvisionState.ready },
      orderBy: { order: 'asc' },
    });

    const defaultViewIdByTableId = new Map<string, string>();
    if (tables.length) {
      const views = await this.prismaService.view.findMany({
        where: {
          tableId: { in: tables.map((table) => table.id) },
          deletedTime: null,
        },
        select: { id: true, tableId: true, order: true },
        orderBy: { order: 'asc' },
      });
      for (const view of views) {
        if (!defaultViewIdByTableId.has(view.tableId)) {
          defaultViewIdByTableId.set(view.tableId, view.id);
        }
      }
    }

    return tables
      .sort((a, b) => ids.indexOf(a.id) - ids.indexOf(b.id))
      .map((table) => ({
        id: table.id,
        v: table.version,
        type: 'json0',
        data: {
          ...table,
          description: table.description ?? undefined,
          icon: table.icon ?? undefined,
          lastModifiedTime:
            table.lastModifiedTime?.toISOString() || table.createdTime.toISOString(),
          defaultViewId: defaultViewIdByTableId.get(table.id),
        } as ITableVo,
      }));
  }

  async getDocIds(baseId: string, projectionTableIds?: string[]): Promise<{ ids: string[] }> {
    const tables = await this.prismaService.tableMeta.findMany({
      where: {
        deletedTime: null,
        baseId,
        provisionState: ProvisionState.ready,
        ...(projectionTableIds
          ? {
              id: { in: projectionTableIds },
            }
          : {}),
      },
      select: { id: true },
      orderBy: { order: 'asc' },
    });
    return { ids: tables.map((table) => table.id) };
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
      dbTableName,
      ...(table.description !== undefined ? { description: table.description } : {}),
      ...(table.icon !== undefined ? { icon: table.icon } : {}),
      ...(defaultViewId ? { defaultViewId } : {}),
    };
  }

  private async overlayTableMeta(table: ITableVo, tableId: string): Promise<ITableVo> {
    const meta = await this.prismaService.tableMeta.findUnique({
      where: { id: tableId },
      select: { order: true, lastModifiedTime: true },
    });
    return {
      ...table,
      ...(meta?.order != null ? { order: meta.order } : {}),
      ...(meta?.lastModifiedTime ? { lastModifiedTime: meta.lastModifiedTime.toISOString() } : {}),
    };
  }

  private async collectCrossSpaceAffectedFields(
    tableId: string
  ): Promise<Array<{ fieldId: string; fieldName: string; type: string }>> {
    // Delegate to the v1 service so cross-space link, conditional lookup,
    // conditional rollup, and their transitive lookup/rollup dependents are
    // all detected consistently with the duplicate-check endpoint. v2 refuses
    // to silently downgrade those fields.
    return this.tableDuplicateLegacyService.previewCrossSpaceAffectedFields(tableId);
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
    await this.assertBaseWritable(baseId);
    const container = await this.v2ContainerService.getContainerForBase(baseId);
    const commandBus = container.resolve<ICommandBus>(v2CoreTokens.commandBus);
    const context = await this.v2ContextFactory.createContext(container);

    const result = await executeDeleteTableEndpoint(
      context,
      {
        baseId,
        tableId,
        mode,
      },
      commandBus
    );

    if (result.status === 200 && result.body.ok) {
      if (mode === 'permanent') {
        await this.cleanupRecordHistoryAfterPermanentDelete(baseId, tableId);
      }
      return;
    }

    if (!result.body.ok) {
      throwV2Error(result.body.error, result.status);
    }

    throw new HttpException(internalServerError, HttpStatus.INTERNAL_SERVER_ERROR);
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
    await this.assertBaseWritable(baseId);
    await this.assertTableWritable(tableId);
    // The v2 duplicate command does not run cross-space validation when
    // creating fields, so a table containing any cross-space link would
    // silently produce another cross-space copy. Refuse instead of
    // downgrading those fields to single line text on a hidden v1 path.
    const affected = await this.collectCrossSpaceAffectedFields(tableId);
    if (affected.length > 0) {
      throw new CustomHttpException(
        'v2 will not silently downgrade cross-space fields when duplicating a table',
        HttpErrorCode.VALIDATION_ERROR
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

    const legacyPrefix = this.dbProvider.generateDbTableName(baseId, '');
    if (dbTableName.startsWith(legacyPrefix)) {
      return dbTableName;
    }

    return this.dbProvider.generateDbTableName(baseId, dbTableName);
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
