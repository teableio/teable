/* eslint-disable @typescript-eslint/naming-convention */
import { Injectable, Logger } from '@nestjs/common';
import type { ILinkFieldOptions } from '@teable/core';
import { FieldType, HttpErrorCode } from '@teable/core';
import { PrismaService, ProvisionState } from '@teable/db-main-prisma';
import {
  BaseDuplicateMode,
  type ICreateBaseVo,
  type ICrossSpaceBaseAffectedField,
  type IDuplicateBaseRo,
} from '@teable/openapi';
import { v2PostgresDbTokens } from '@teable/v2-adapter-db-postgres-pg';
import {
  v2RecordRepositoryPostgresTokens,
  type ComputedFieldBackfillService,
} from '@teable/v2-adapter-table-repository-postgres';
import {
  DuplicateBaseCommand,
  TableByIdSpec,
  TableId,
  v2CoreTokens,
  type DotTeaFieldInput,
  type DuplicateBaseResult,
  type DuplicateBaseSource,
  type ICommandBus,
  type IExecutionContext,
  type ITableRepository,
  type NormalizedDotTeaField,
  type NormalizedDotTeaStructure,
} from '@teable/v2-core';
import type { DependencyContainer } from '@teable/v2-di';
import { normalizeField } from '@teable/v2-dottea';
import { Knex } from 'knex';
import type { Kysely } from 'kysely';
import { groupBy, omit } from 'lodash';
import { InjectModel } from 'nest-knexjs';
import { ClsService } from 'nestjs-cls';
import { CustomHttpException } from '../../custom.exception';
import { InjectDbProvider } from '../../db-provider/db.provider';
import { IDbProvider } from '../../db-provider/db.provider.interface';
import { DataDbClientManager } from '../../global/data-db-client-manager.service';
import { DATA_KNEX } from '../../global/knex/knex.module';
import type { IClsStore } from '../../types/cls';
import { AuditScope } from '../audit/audit-scope';
import { createFieldInstanceByRaw } from '../field/model/factory';
import { PersistedComputedBackfillService } from '../record/computed/services/persisted-computed-backfill.service';
import { TableDuplicateService } from '../table/table-duplicate.service';
import { V2ContainerService } from '../v2/v2-container.service';
import { V2ExecutionContextFactory } from '../v2/v2-execution-context.factory';
import { BaseExportService } from './base-export.service';
import type { BaseImportProgressCallback } from './base-import.service';
import { BaseImportService } from './base-import.service';
import {
  collectCrossSpaceAffectedFieldIds,
  extractForeignTableId,
} from './cross-space-detection.util';
import { mergeLinkFieldTableMaps } from './utils';
import type { ILinkFieldTableInfo, ILinkFieldTableMap } from './utils';

type DuplicatedBase = Awaited<ReturnType<BaseImportService['createBaseStructure']>>['base'];
const v2DuplicateReadBatchSize = 500;
const v2DuplicateCopyBatchSize = 500;
type DuplicateStructureConfig = Awaited<ReturnType<BaseExportService['generateBaseStructConfig']>>;
type DuplicateV2FieldConfig = Omit<
  DuplicateStructureConfig['tables'][number]['fields'][number],
  keyof NormalizedDotTeaField
> &
  NormalizedDotTeaField;
type DuplicateV2TableConfig = Omit<DuplicateStructureConfig['tables'][number], 'fields'> & {
  fields: DuplicateV2FieldConfig[];
};
type DuplicateV2StructureConfig = Omit<DuplicateStructureConfig, 'tables'> &
  Omit<NormalizedDotTeaStructure, 'tables'> & {
    tables: DuplicateV2TableConfig[];
  };
type DuplicateStructureConfigResult = {
  structure: DuplicateStructureConfig;
  sourceDbTableNameByTableId: Record<string, string>;
};

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
  private logger = new Logger(BaseDuplicateService.name);

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
    private readonly v2ContainerService: V2ContainerService,
    private readonly v2ContextFactory: V2ExecutionContextFactory,
    private readonly audit: AuditScope
  ) {}

  private getDataPrismaExecutor(prisma: IDataPrismaScopedClient): IDataPrismaExecutor {
    return prisma.txClient?.() ?? prisma;
  }

  async duplicateBase(
    duplicateBaseRo: IDuplicateBaseRo,
    allowCrossBase: boolean = true,
    duplicateMode: BaseDuplicateMode = BaseDuplicateMode.Normal
  ) {
    const { fromBaseId, spaceId, withRecords, name, baseId, nodes } = duplicateBaseRo;
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
        duplicateMode
      );

      ({ base } = duplicated);
      // Patch the active audit operation's resourceId to the newly created base id. Outer
      // decorators (BaseDuplicate / TemplateApply / ShareBaseCopy) opened the operation with
      // fromBaseId/targetBaseId placeholders before the new base existed; without this,
      // every inner atomic audit row would point at the source base instead of the copy.
      this.audit.setResourceId(base.id);
      const { base: _base, tableIdMap, fieldIdMap, viewIdMap, ...rest } = duplicated;

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
          mergedLinkFieldTableMap
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

  async duplicateBaseV2(
    duplicateBaseRo: IDuplicateBaseRo,
    allowCrossBase: boolean = true,
    duplicateMode: BaseDuplicateMode = BaseDuplicateMode.Normal,
    onProgress?: BaseImportProgressCallback
  ) {
    const { fromBaseId, spaceId, withRecords, name, baseId, nodes } = duplicateBaseRo;
    const userId = this.cls.get('user.id');
    const prisma = this.prismaService.txClient();
    const skipParentNodes = duplicateMode === BaseDuplicateMode.CopyShareBase;
    let base: ICreateBaseVo | undefined;

    try {
      onProgress?.({ phase: 'structure_creating' });
      const { structure, sourceDbTableNameByTableId } = await this.buildDuplicateStructureConfig(
        fromBaseId,
        name,
        allowCrossBase,
        nodes,
        duplicateMode,
        spaceId
      );

      const sourceTableIdMap = Object.fromEntries(
        structure.tables.flatMap((table) => (table.id ? ([[table.id, table.id]] as const) : []))
      );
      // Cross-space links can't survive duplication (per-space data-DB sharding),
      // so their cell values are always downgraded to text — even when
      // allowCrossBase=true keeps same-space cross-base links intact. Mirrors
      // the v1 branch in duplicateBase above.
      const crossBaseLinkFieldTableMap: ILinkFieldTableMap = allowCrossBase
        ? await this.getCrossBaseLinkFieldTableMap(sourceTableIdMap, spaceId)
        : await this.getCrossBaseLinkFieldTableMap(sourceTableIdMap);
      const disconnectedLinkFieldTableMap = await this.getDisconnectedLinkFieldTableMap(
        sourceTableIdMap,
        fromBaseId,
        nodes,
        skipParentNodes
      );
      const mergedLinkFieldTableMap = mergeLinkFieldTableMaps(
        crossBaseLinkFieldTableMap,
        disconnectedLinkFieldTableMap
      );
      const disconnectedLinkFieldIds = await this.getDisconnectedLinkFieldIds(
        sourceTableIdMap,
        fromBaseId,
        nodes,
        skipParentNodes
      );
      const container = await this.v2ContainerService.getContainerForSpace(spaceId);
      const commandBus = container.resolve<ICommandBus>(v2CoreTokens.commandBus);
      const db = container.resolve<Kysely<unknown>>(v2PostgresDbTokens.db);
      const context = await this.v2ContextFactory.createContext(container);
      base = await this.baseImportService.createBaseV2(
        db,
        spaceId,
        structure.name,
        structure.icon || undefined,
        baseId,
        duplicateMode !== BaseDuplicateMode.CopyShareBase
      );
      if (withRecords) {
        await this.assertSameDataDatabaseForRecordCopy(fromBaseId, base.id);
        await prisma.base.update({
          where: { id: base.id },
          data: {
            provisionState: ProvisionState.pending,
            lastModifiedBy: userId,
          },
        });
      }

      const normalizedStructure = this.normalizeDuplicateStructureForV2(structure);
      const source = this.createDuplicateBaseSource(
        fromBaseId,
        normalizedStructure,
        mergedLinkFieldTableMap,
        sourceDbTableNameByTableId
      );
      const commandResult = DuplicateBaseCommand.createFromSource({
        baseId: base.id,
        source,
        withRecords: false,
      });
      if (commandResult.isErr()) {
        throw new Error(commandResult.error.message);
      }
      const result = await commandBus.execute<DuplicateBaseCommand, DuplicateBaseResult>(
        context,
        commandResult.value
      );
      if (result.isErr()) {
        throw new Error(result.error.message);
      }

      let tableIdMap: Record<string, string> = {};
      let fieldIdMap: Record<string, string> = {};
      let viewIdMap: Record<string, string> = {};
      let recordsLength = 0;
      for await (const event of result.value) {
        if (event.id === 'error') {
          throw new Error(event.message);
        }

        if (event.id === 'progress') {
          onProgress?.(event);
          continue;
        }

        tableIdMap = event.tableIdMap;
        fieldIdMap = event.fieldIdMap;
        viewIdMap = event.viewIdMap;
        recordsLength = event.recordsLength;
      }

      onProgress?.({ phase: 'structure_created', detail: base.id });
      const { appIdMap } = await this.baseImportService.restoreBaseExtrasV2(
        db,
        base.id,
        structure,
        { tableIdMap, fieldIdMap, viewIdMap },
        duplicateMode,
        onProgress,
        { restoreEeResources: true }
      );
      if (withRecords) {
        recordsLength = await this.duplicateTableData(
          base.id,
          tableIdMap,
          fieldIdMap,
          viewIdMap,
          mergedLinkFieldTableMap,
          onProgress
        );
        onProgress?.({
          phase: 'attachments_copying',
          processedRows: recordsLength,
          totalRows: recordsLength,
        });
        await this.duplicateAttachments(base.id, tableIdMap, fieldIdMap);
        await this.duplicateLinkJunction(
          base.id,
          tableIdMap,
          fieldIdMap,
          allowCrossBase,
          disconnectedLinkFieldIds
        );
        await this.persistedComputedBackfillService.recomputeForTables(Object.values(tableIdMap));
        await this.backfillDuplicatedBaseComputedFields(
          container,
          context,
          Object.values(tableIdMap)
        );
        await prisma.base.update({
          where: { id: base.id },
          data: {
            provisionState: ProvisionState.ready,
            lastModifiedBy: userId,
          },
        });
      }
      onProgress?.({
        phase: 'duplicate_done',
        processedRows: recordsLength,
        totalRows: recordsLength,
      });

      return { base, tableIdMap, fieldIdMap, viewIdMap, recordsLength, structure, appIdMap };
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
    const [source, target] = await Promise.all([
      this.dataDbClientManager.getDataDatabaseForBase(sourceBaseId, { useTransaction: true }),
      this.dataDbClientManager.getDataDatabaseForBase(targetBaseId, { useTransaction: true }),
    ]);

    if (source.cacheKey === target.cacheKey) {
      return;
    }

    throw new CustomHttpException(
      'Duplicating records across different space data databases is not supported yet',
      HttpErrorCode.VALIDATION_ERROR
    );
  }

  private async buildDuplicateStructureConfig(
    fromBaseId: string,
    baseName?: string,
    allowCrossBase?: boolean,
    nodes?: string[],
    duplicateMode: BaseDuplicateMode = BaseDuplicateMode.Normal,
    destSpaceId?: string
  ): Promise<DuplicateStructureConfigResult> {
    const prisma = this.prismaService.txClient();
    const baseRaw = await prisma.base.findUniqueOrThrow({
      where: {
        id: fromBaseId,
        deletedTime: null,
      },
    });
    baseRaw.name = baseName || `${baseRaw.name} (Copy)`;

    const skipParentNodes = duplicateMode === BaseDuplicateMode.CopyShareBase;
    const {
      finalIncludeNodes,
      includedTableIds,
      includedFolderIds,
      includedDashboardIds,
      includedWorkflowIds,
      includedAppIds,
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
        tableId: { in: tableIds },
        deletedTime: null,
      },
    });
    const viewRaws = await prisma.view.findMany({
      where: {
        tableId: { in: tableIds },
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
      rootNodeIds,
      destSpaceId,
    });

    return {
      structure,
      sourceDbTableNameByTableId: Object.fromEntries(
        tableRaws.flatMap(({ id, dbTableName }) =>
          dbTableName ? ([[id, dbTableName]] as const) : []
        )
      ),
    };
  }

  private createDuplicateBaseSource(
    sourceBaseId: string,
    structure: DuplicateV2StructureConfig,
    disconnectedLinkFieldTableMap: ILinkFieldTableMap,
    sourceDbTableNameByTableId: Record<string, string> = {}
  ): DuplicateBaseSource {
    const tableById = new Map(structure.tables.map((table) => [table.id, table]));
    const readRows = (sourceDbTableName: string, crossBaseLinkInfo: ILinkFieldTableInfo[]) =>
      this.createSourceTableRecordRows(sourceBaseId, sourceDbTableName, crossBaseLinkInfo);
    const toRecordInput = (table: DuplicateV2TableConfig, row: Record<string, unknown>) =>
      this.toDuplicateBaseRecordInput(table, row);

    return {
      structure,
      async *records(tableId: string) {
        const table = tableById.get(tableId);
        const sourceDbTableName = sourceDbTableNameByTableId[tableId] ?? table?.dbTableName;
        if (!table || !sourceDbTableName) {
          return;
        }

        for await (const row of readRows(
          sourceDbTableName,
          disconnectedLinkFieldTableMap[tableId] || []
        )) {
          yield toRecordInput(table, row);
        }
      },
    };
  }

  private normalizeDuplicateStructureForV2(
    structure: DuplicateStructureConfig
  ): DuplicateV2StructureConfig {
    const availableTableIds = new Set(
      structure.tables.flatMap((table) => (table.id ? [table.id] : []))
    );
    for (const table of structure.tables) {
      for (const field of table.fields) {
        const options = field.options as ILinkFieldOptions | undefined;
        if (
          field.type === FieldType.Link &&
          options?.baseId &&
          typeof options.foreignTableId === 'string'
        ) {
          availableTableIds.add(options.foreignTableId);
        }
      }
    }
    const fieldIdsByTableId = new Map(
      structure.tables.flatMap((table) =>
        table.id
          ? [
              [
                table.id,
                new Set(table.fields.flatMap((field) => (field.id ? [field.id] : []))),
              ] as const,
            ]
          : []
      )
    );

    return {
      ...structure,
      tables: structure.tables.map((table) => {
        const tableFieldTypesById = new Map(
          table.fields
            .filter((field) => field.id)
            .map(
              (field) =>
                [
                  field.id!,
                  field.isConditionalLookup
                    ? 'conditionalLookup'
                    : field.isLookup
                      ? 'lookup'
                      : field.type,
                ] as const
            )
        );

        return {
          ...table,
          fields: table.fields.map((field) => {
            const normalized = normalizeField(field as DotTeaFieldInput, tableFieldTypesById, {
              availableTableIds,
              fieldIdsByTableId,
            });
            const normalizedField = { ...field, ...normalized };

            if (
              normalized.type === FieldType.SingleLineText &&
              (field.isLookup ||
                field.isConditionalLookup ||
                field.type === FieldType.Rollup ||
                field.type === FieldType.ConditionalRollup)
            ) {
              return omit(normalizedField, ['isLookup', 'isConditionalLookup', 'lookupOptions']);
            }

            return normalizedField;
          }),
        };
      }),
    };
  }

  private shouldSkipDuplicateRecordColumn(columnName: string) {
    return (
      columnName === '__id' ||
      columnName.startsWith('__row_') ||
      this.isRestoreSystemColumn(columnName)
    );
  }

  private shouldSkipDuplicateRecordField(field: DuplicateV2FieldConfig) {
    if (field.isLookup) {
      return true;
    }

    switch (field.type) {
      case FieldType.Button:
      case FieldType.Formula:
      case FieldType.Rollup:
      case FieldType.ConditionalRollup:
      case 'lookup':
      case 'conditionalLookup':
        return true;
      default:
        return false;
    }
  }

  private toDuplicateRecordFieldValue(field: DuplicateV2FieldConfig, value: unknown) {
    return this.isJsonDbField(field.dbFieldType) ? this.parseJsonCellValue(value) : value;
  }

  private toDuplicateBaseRecordInput(table: DuplicateV2TableConfig, row: Record<string, unknown>) {
    const fields: Record<string, unknown> = {};
    const fieldsByDbFieldName = new Map(table.fields.map((field) => [field.dbFieldName, field]));
    for (const [columnName, value] of Object.entries(row)) {
      if (this.shouldSkipDuplicateRecordColumn(columnName)) {
        continue;
      }

      const field = fieldsByDbFieldName.get(columnName);
      if (!field?.id || this.shouldSkipDuplicateRecordField(field)) {
        continue;
      }

      const fieldId = field.id;
      fields[fieldId] = this.toDuplicateRecordFieldValue(field, value);
    }

    const orders = Object.fromEntries(
      Object.entries(row).flatMap(([columnName, value]) => {
        if (!columnName.startsWith('__row_')) {
          return [];
        }
        const order = Number(value);
        return Number.isFinite(order) ? [[columnName.slice('__row_'.length), order]] : [];
      })
    );

    return {
      recordId: typeof row.__id === 'string' ? row.__id : undefined,
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
    };
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
      rootNodeIds,
      destSpaceId: spaceId,
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
      duplicateMode,
      undefined,
      { useTransaction: true }
    );

    return { base: newBase, tableIdMap, fieldIdMap, viewIdMap, ...rest };
  }

  /**
   * Collect nodes and their resource IDs by type
   * This method processes the selected nodes and collects all their parent nodes (unless skipParentNodes is true)
   * Then extracts resource IDs grouped by resource type
   *
   * @param fromBaseId - The base ID to collect nodes from
   * @param nodes - The selected node IDs
   * @param skipParentNodes - If true, don't collect parent nodes (used for share base copy)
   */
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

  async previewCrossSpaceAffectedFields(
    fromBaseId: string,
    destSpaceId: string
  ): Promise<ICrossSpaceBaseAffectedField[]> {
    const prisma = this.prismaService.txClient();
    const tables = await prisma.tableMeta.findMany({
      where: { baseId: fromBaseId, deletedTime: null },
      select: { id: true, name: true },
    });
    if (!tables.length) return [];
    const tableNameMap = new Map(tables.map((t) => [t.id, t.name]));
    const tableIds = tables.map((t) => t.id);

    const allFields = await prisma.field.findMany({
      where: { tableId: { in: tableIds }, deletedTime: null },
      select: {
        id: true,
        name: true,
        type: true,
        tableId: true,
        isLookup: true,
        isConditionalLookup: true,
        options: true,
        lookupOptions: true,
      },
    });

    const inBaseTableIds = new Set(tableIds);
    const foreignTableIds = Array.from(
      new Set(
        allFields
          .map((f) => extractForeignTableId(f))
          .filter((ft): ft is string => !!ft && !inBaseTableIds.has(ft))
      )
    );
    if (!foreignTableIds.length) return [];

    const foreignTables = await prisma.tableMeta.findMany({
      where: { id: { in: foreignTableIds }, deletedTime: null },
      select: { id: true, base: { select: { spaceId: true } } },
    });
    const foreignSpaceMap = new Map(foreignTables.map((t) => [t.id, t.base.spaceId]));

    const affected = collectCrossSpaceAffectedFieldIds({
      fields: allFields,
      isForeignInternal: (ft) => inBaseTableIds.has(ft),
      isForeignCrossSpace: (ft) => {
        const s = foreignSpaceMap.get(ft);
        return Boolean(s && s !== destSpaceId);
      },
    });

    return allFields
      .filter((f) => affected.has(f.id))
      .map((f) => ({
        fieldId: f.id,
        fieldName: f.name,
        type: f.type,
        tableId: f.tableId,
        tableName: tableNameMap.get(f.tableId) ?? '',
      }));
  }

  private async getCrossBaseLinkFieldTableMap(
    tableIdMap: Record<string, string>,
    destSpaceId?: string
  ): Promise<ILinkFieldTableMap> {
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
    onProgress?: BaseImportProgressCallback
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
      });
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
    } = params;
    const targetTableId = tableIdMap[tableId];
    const sourceDbTableName = tableId2DbTableNameMap[tableId];
    const targetDbTableName = tableId2DbTableNameMap[targetTableId];
    const tableName = tableId2NameMap[tableId] ?? sourceDbTableName;
    const processedRowsBeforeTable = progressState.processedRows;

    try {
      const tableRows = await this.tableDuplicateService.duplicateTableData(
        sourceDbTableName,
        targetDbTableName,
        viewIdMap,
        fieldIdMap,
        crossBaseLinkFieldTableMap[tableId] || [],
        prisma,
        this.createDuplicateTableProgressOptions(
          onProgress,
          progressState,
          targetTableId,
          tableName
        )
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

  private isRestoreSystemColumn(columnName: string) {
    return [
      '__version',
      '__auto_number',
      '__created_time',
      '__created_by',
      '__last_modified_time',
      '__last_modified_by',
    ].includes(columnName);
  }

  private parseJsonCellValue(value: unknown) {
    if (typeof value !== 'string') {
      return value;
    }

    try {
      return JSON.parse(value);
    } catch {
      return value;
    }
  }

  private isJsonDbField(dbFieldType?: string | null) {
    return typeof dbFieldType === 'string' && dbFieldType.toLowerCase() === 'json';
  }

  private toRestoreString(value: unknown) {
    if (value instanceof Date) {
      return value.toISOString();
    }
    return String(value);
  }

  private async *createSourceTableRecordRows(
    sourceBaseId: string,
    sourceDbTableName: string,
    crossBaseLinkInfo: ILinkFieldTableInfo[]
  ): AsyncGenerator<Record<string, unknown>> {
    const dataKnex = await this.dataDbClientManager.dataKnexForBase(sourceBaseId, {
      useTransaction: true,
    });
    let lastAutoNumber = 0;

    while (true) {
      const rows = await dataKnex<Record<string, unknown>>(sourceDbTableName)
        .select('*')
        .where('__auto_number', '>', lastAutoNumber)
        .orderBy('__auto_number', 'asc')
        .limit(v2DuplicateReadBatchSize);
      if (!rows.length) {
        return;
      }

      for (const row of rows) {
        yield this.normalizeCrossBaseLinkColumns(row, crossBaseLinkInfo);
      }

      lastAutoNumber = Number(rows[rows.length - 1]?.__auto_number ?? lastAutoNumber);
    }
  }

  private normalizeCrossBaseLinkColumns(
    row: Record<string, unknown>,
    crossBaseLinkInfo: ILinkFieldTableInfo[]
  ) {
    if (!crossBaseLinkInfo.length) {
      return row;
    }

    const nextRow = { ...row };
    for (const { dbFieldName, isMultipleCellValue } of crossBaseLinkInfo) {
      if (!(dbFieldName in nextRow)) {
        continue;
      }

      nextRow[dbFieldName] = this.toCrossBaseLinkTitle(nextRow[dbFieldName], isMultipleCellValue);
    }

    return nextRow;
  }

  private toCrossBaseLinkTitle(value: unknown, isMultipleCellValue: boolean): unknown {
    if (value == null) {
      return value;
    }

    if (typeof value === 'string') {
      try {
        return this.toCrossBaseLinkTitle(JSON.parse(value), isMultipleCellValue);
      } catch {
        return value;
      }
    }

    if (isMultipleCellValue) {
      return Array.isArray(value)
        ? value
            .map((item) =>
              item && typeof item === 'object' && 'title' in item
                ? String((item as { title?: unknown }).title ?? '')
                : ''
            )
            .filter(Boolean)
            .join(', ')
        : value;
    }

    return value && typeof value === 'object' && 'title' in value
      ? String((value as { title?: unknown }).title ?? '')
      : value;
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

  private async backfillDuplicatedBaseComputedFields(
    container: DependencyContainer,
    context: IExecutionContext,
    targetTableIds: string[]
  ) {
    if (!targetTableIds.length) {
      return;
    }

    const tableRepository = container.resolve<ITableRepository>(v2CoreTokens.tableRepository);
    const backfillService = container.resolve<ComputedFieldBackfillService>(
      v2RecordRepositoryPostgresTokens.computedFieldBackfillService
    );

    for (const rawTableId of targetTableIds) {
      const tableIdResult = TableId.create(rawTableId);
      if (tableIdResult.isErr()) {
        throw new Error(tableIdResult.error.message);
      }

      const tableResult = await tableRepository.findOne(
        context,
        TableByIdSpec.create(tableIdResult.value)
      );
      if (tableResult.isErr()) {
        throw new Error(tableResult.error.message);
      }

      const backfillResult = await backfillService.executeSyncMany(context, {
        table: tableResult.value,
        fields: tableResult.value.getFields(),
        skipDistinctFilter: true,
        includeOneManyTwoWay: true,
      });
      if (backfillResult.isErr()) {
        throw new Error(backfillResult.error.message);
      }
    }
  }
}
