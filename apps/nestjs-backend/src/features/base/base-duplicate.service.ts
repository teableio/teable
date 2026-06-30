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
  DuplicateBaseCommand,
  v2CoreTokens,
  type DuplicateBaseRecordReadOptions,
  type DotTeaFieldInput,
  type DuplicateBaseResult,
  type DuplicateBaseSource,
  type ICommandBus,
  type NormalizedDotTeaField,
  type NormalizedDotTeaStructure,
} from '@teable/v2-core';
import { normalizeFields } from '@teable/v2-dottea';
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
const v2DuplicateReadBatchSize = 1000;
const v2DuplicateCopyBatchSize = 500;
const v2DuplicateLinkFieldBatchSize = 500;
const v2DuplicateTableIdQueryChunkSize = 100;
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
type DuplicateBaseStructConfigInput = Parameters<
  BaseExportService['generateBaseStructConfig']
>[0] & {
  includeWorkflowRuntimeState?: boolean;
};
type DuplicateLinkFieldRaw = {
  id: string;
  tableId: string;
  dbFieldName: string;
  isMultipleCellValue: boolean | null;
  meta: string | null;
  options: string | null;
};
type V2InternalLinkFieldTableInfo = {
  fieldId: string;
  dbFieldName: string;
  foreignTableId: string;
  lookupFieldId: string;
  relationship: string;
  fkHostTableName: string;
  selfKeyName: string;
  foreignKeyName: string;
  isOneWay: boolean;
  isMultipleCellValue: boolean;
  orderColumnName?: string;
};
type V2LinkCellItem = { id: string; title?: string };

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
        ? await this.getV2CrossBaseLinkFieldTableMap(sourceTableIdMap, spaceId)
        : await this.getV2CrossBaseLinkFieldTableMap(sourceTableIdMap);
      const disconnectedLinkFieldTableMap = await this.getV2DisconnectedLinkFieldTableMap(
        sourceTableIdMap,
        fromBaseId,
        nodes,
        skipParentNodes
      );
      const mergedLinkFieldTableMap = mergeLinkFieldTableMaps(
        crossBaseLinkFieldTableMap,
        disconnectedLinkFieldTableMap
      );
      const internalLinkRelationTableMap =
        await this.getV2InternalLinkRelationTableMap(sourceTableIdMap);
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
      const useBulkRecordCopy =
        Boolean(withRecords) &&
        !onProgress &&
        (await this.isSameDataDatabaseForRecordCopy(fromBaseId, base.id));
      if (withRecords) {
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
        sourceDbTableNameByTableId,
        internalLinkRelationTableMap
      );
      const commandResult = DuplicateBaseCommand.createFromSource({
        baseId: base.id,
        source,
        withRecords: Boolean(withRecords) && !useBulkRecordCopy,
        batchSize: v2DuplicateCopyBatchSize,
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
        onProgress
      );
      if (withRecords) {
        if (useBulkRecordCopy) {
          recordsLength = await this.duplicateTableData(
            base.id,
            tableIdMap,
            fieldIdMap,
            viewIdMap,
            mergedLinkFieldTableMap
          );
          const disconnectedLinkFieldIds = await this.getDisconnectedLinkFieldIds(
            tableIdMap,
            fromBaseId,
            nodes,
            skipParentNodes
          );
          await this.duplicateLinkJunction(
            base.id,
            tableIdMap,
            fieldIdMap,
            allowCrossBase,
            disconnectedLinkFieldIds
          );
          await this.persistedComputedBackfillService.recomputeForTables(Object.values(tableIdMap));
        }
        onProgress?.({
          phase: 'attachments_copying',
          processedRows: recordsLength,
          totalRows: recordsLength,
        });
        await this.duplicateAttachments(base.id, tableIdMap, fieldIdMap);
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
    if (await this.isSameDataDatabaseForRecordCopy(sourceBaseId, targetBaseId)) {
      return;
    }

    throw new CustomHttpException(
      'Duplicating records across different space data databases is not supported yet',
      HttpErrorCode.VALIDATION_ERROR
    );
  }

  private async isSameDataDatabaseForRecordCopy(sourceBaseId: string, targetBaseId: string) {
    const [source, target] = await Promise.all([
      this.dataDbClientManager.getDataDatabaseForBase(sourceBaseId, { useTransaction: true }),
      this.dataDbClientManager.getDataDatabaseForBase(targetBaseId, { useTransaction: true }),
    ]);

    return source.cacheKey === target.cacheKey;
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
    const fieldRaws = await this.baseExportService.findFieldsByTableIds(tableIds);
    const viewRaws = await this.baseExportService.findViewsByTableIds(tableIds);

    const structureInput: DuplicateBaseStructConfigInput = {
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
      includeWorkflowRuntimeState: false,
    };
    const structure = await this.baseExportService.generateBaseStructConfig(structureInput);

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
    sourceDbTableNameByTableId: Record<string, string> = {},
    internalLinkRelationTableMap: Record<string, V2InternalLinkFieldTableInfo[]> = {}
  ): DuplicateBaseSource {
    const tableById = new Map(structure.tables.map((table) => [table.id, table]));
    const readRows = (
      sourceDbTableName: string,
      crossBaseLinkInfo: ILinkFieldTableInfo[],
      internalLinkInfo: V2InternalLinkFieldTableInfo[]
    ) =>
      this.createSourceTableRecordRows(
        sourceBaseId,
        sourceDbTableName,
        crossBaseLinkInfo,
        internalLinkInfo
      );
    const toRecordInput = (table: DuplicateV2TableConfig, row: Record<string, unknown>) =>
      this.toDuplicateBaseRecordInput(table, row);

    return {
      structure,
      async *records(tableId: string, options?: DuplicateBaseRecordReadOptions) {
        const table = tableById.get(tableId);
        const sourceDbTableName = sourceDbTableNameByTableId[tableId] ?? table?.dbTableName;
        if (!table || !sourceDbTableName) {
          return;
        }
        const shouldReadInternalLinks = options?.phase !== 'insert';

        for await (const row of readRows(
          sourceDbTableName,
          disconnectedLinkFieldTableMap[tableId] || [],
          shouldReadInternalLinks ? internalLinkRelationTableMap[tableId] || [] : []
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
        return {
          ...table,
          fields: normalizeFields(table.fields as ReadonlyArray<DotTeaFieldInput>, {
            availableTableIds,
            fieldIdsByTableId,
          }).map((normalized, index) => {
            const field = table.fields[index]!;
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
      lastModifiedTime: null,
      lastModifiedBy: null,
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

  private async findV2DuplicateLinkFields(tableIds: string[]) {
    const prisma = this.prismaService.txClient();
    const fields: DuplicateLinkFieldRaw[] = [];

    for (let index = 0; index < tableIds.length; index += v2DuplicateTableIdQueryChunkSize) {
      const tableIdChunk = tableIds.slice(index, index + v2DuplicateTableIdQueryChunkSize);
      let cursor: string | undefined;
      let hasMore = true;

      while (hasMore) {
        const page = await prisma.field.findMany({
          where: {
            tableId: { in: tableIdChunk },
            type: FieldType.Link,
            OR: [{ isLookup: false }, { isLookup: null }],
            deletedTime: null,
          },
          ...(cursor
            ? {
                cursor: {
                  id: cursor,
                },
                skip: 1,
              }
            : {}),
          select: {
            id: true,
            tableId: true,
            dbFieldName: true,
            isMultipleCellValue: true,
            meta: true,
            options: true,
          },
          orderBy: [{ tableId: 'asc' }, { id: 'asc' }],
          take: v2DuplicateLinkFieldBatchSize,
        });

        fields.push(...page);

        hasMore = page.length === v2DuplicateLinkFieldBatchSize;
        if (hasMore) {
          cursor = page[page.length - 1].id;
        }
      }
    }

    return fields;
  }

  private parseLinkFieldOptions(options: string | null): ILinkFieldOptions | undefined {
    if (!options) {
      return undefined;
    }

    try {
      return JSON.parse(options) as ILinkFieldOptions;
    } catch {
      return undefined;
    }
  }

  private resolveV2LinkOrderColumnName(options: ILinkFieldOptions): string | undefined {
    switch (options.relationship) {
      case 'manyMany':
        return '__order';
      case 'oneMany':
        return options.isOneWay ? '__order' : `${options.selfKeyName}_order`;
      case 'manyOne':
      case 'oneOne':
        return `${options.foreignKeyName}_order`;
      default:
        return undefined;
    }
  }

  private hasV2LinkOrderColumn(meta: string | null): boolean {
    if (!meta) {
      return false;
    }

    try {
      return Boolean((JSON.parse(meta) as { hasOrderColumn?: unknown }).hasOrderColumn);
    } catch {
      return false;
    }
  }

  private buildLinkFieldTableMap(
    tableIdMap: Record<string, string>,
    fields: DuplicateLinkFieldRaw[]
  ): ILinkFieldTableMap {
    const tableId2DbFieldNameMap: ILinkFieldTableMap = {};

    Object.entries(groupBy(fields, 'tableId')).forEach(([tableId, fields]) => {
      const info = fields.flatMap(({ dbFieldName, isMultipleCellValue, options }) => {
        const parsedOptions = this.parseLinkFieldOptions(options);
        if (!parsedOptions?.selfKeyName) {
          return [];
        }
        return [
          {
            dbFieldName,
            selfKeyName: parsedOptions.selfKeyName,
            isMultipleCellValue: !!isMultipleCellValue,
          },
        ];
      });

      if (info.length) {
        tableId2DbFieldNameMap[tableId] = info;
        tableId2DbFieldNameMap[tableIdMap[tableId]] = info;
      }
    });

    return tableId2DbFieldNameMap;
  }

  private async getV2InternalLinkRelationTableMap(
    tableIdMap: Record<string, string>
  ): Promise<Record<string, V2InternalLinkFieldTableInfo[]>> {
    const tableIds = Object.keys(tableIdMap);
    const fields = (await this.findV2DuplicateLinkFields(tableIds)).filter((field) => {
      const options = this.parseLinkFieldOptions(field.options);
      return (
        options?.foreignTableId &&
        !options.baseId &&
        tableIdMap[options.foreignTableId] &&
        options.fkHostTableName &&
        options.selfKeyName &&
        options.foreignKeyName
      );
    });

    if (!fields.length) {
      return {};
    }

    const tableId2Info: Record<string, V2InternalLinkFieldTableInfo[]> = {};
    Object.entries(groupBy(fields, 'tableId')).forEach(([tableId, tableFields]) => {
      const info = tableFields.flatMap((field) => {
        const options = this.parseLinkFieldOptions(field.options);
        const foreignTableId = options?.foreignTableId;
        const lookupFieldId = options?.lookupFieldId;
        if (
          !foreignTableId ||
          !lookupFieldId ||
          !options?.relationship ||
          !options.fkHostTableName ||
          !options.selfKeyName ||
          !options.foreignKeyName
        ) {
          return [];
        }

        return [
          {
            fieldId: field.id,
            dbFieldName: field.dbFieldName,
            foreignTableId,
            lookupFieldId,
            relationship: options.relationship,
            fkHostTableName: options.fkHostTableName,
            selfKeyName: options.selfKeyName,
            foreignKeyName: options.foreignKeyName,
            isOneWay: Boolean(options.isOneWay),
            isMultipleCellValue: !!field.isMultipleCellValue,
            orderColumnName: this.hasV2LinkOrderColumn(field.meta)
              ? this.resolveV2LinkOrderColumnName(options)
              : undefined,
          },
        ];
      });

      if (info.length) {
        tableId2Info[tableId] = info;
        tableId2Info[tableIdMap[tableId]] = info;
      }
    });

    return tableId2Info;
  }

  private async getV2DisconnectedLinkFieldTableMap(
    tableIdMap: Record<string, string>,
    fromBaseId: string,
    nodes?: string[],
    skipParentNodes: boolean = false
  ): Promise<ILinkFieldTableMap> {
    const { excludedTableIds } = await this.collectNodesAndResourceIds(
      fromBaseId,
      nodes,
      skipParentNodes
    );

    if (!nodes?.length || !excludedTableIds?.length) {
      return {};
    }

    const fields = (await this.findV2DuplicateLinkFields(Object.keys(tableIdMap))).filter((field) =>
      excludedTableIds.includes(this.parseLinkFieldOptions(field.options)?.foreignTableId ?? '')
    );

    return this.buildLinkFieldTableMap(tableIdMap, fields);
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

  private async getV2CrossBaseLinkFieldTableMap(
    tableIdMap: Record<string, string>,
    destSpaceId?: string
  ): Promise<ILinkFieldTableMap> {
    const linkFields = (await this.findV2DuplicateLinkFields(Object.keys(tableIdMap))).filter(
      (field) => this.parseLinkFieldOptions(field.options)?.baseId
    );

    let crossBaseLinkFields = linkFields;
    if (destSpaceId) {
      const prisma = this.prismaService.txClient();
      const foreignBaseIds = Array.from(
        new Set(
          linkFields
            .map((field) => this.parseLinkFieldOptions(field.options)?.baseId)
            .filter((baseId): baseId is string => Boolean(baseId))
        )
      );
      const bases = foreignBaseIds.length
        ? await prisma.base.findMany({
            where: { id: { in: foreignBaseIds }, deletedTime: null },
            select: { id: true, spaceId: true },
          })
        : [];
      const crossSpaceBaseIds = new Set(
        bases.filter((base) => base.spaceId !== destSpaceId).map((base) => base.id)
      );
      crossBaseLinkFields = linkFields.filter((field) => {
        const baseId = this.parseLinkFieldOptions(field.options)?.baseId;
        return baseId && crossSpaceBaseIds.has(baseId);
      });
    }

    return this.buildLinkFieldTableMap(tableIdMap, crossBaseLinkFields);
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

  private parsePostgresTextArrayLiteral(value: string): string[] | undefined {
    if (!value.startsWith('{') || !value.endsWith('}')) {
      return undefined;
    }

    const inner = value.slice(1, -1);
    if (!inner) {
      return [];
    }

    const items: string[] = [];
    let item = '';
    let inQuotes = false;

    for (let index = 0; index < inner.length; index += 1) {
      const char = inner[index];

      if (inQuotes) {
        if (char === '\\') {
          index += 1;
          item += inner[index] ?? '';
          continue;
        }
        if (char === '"') {
          inQuotes = false;
          continue;
        }
        item += char;
        continue;
      }

      if (char === '"') {
        inQuotes = true;
        continue;
      }

      if (char === ',') {
        items.push(item);
        item = '';
        continue;
      }

      item += char;
    }

    if (inQuotes) {
      return undefined;
    }

    items.push(item);
    return items;
  }

  private async *createSourceTableRecordRows(
    sourceBaseId: string,
    sourceDbTableName: string,
    crossBaseLinkInfo: ILinkFieldTableInfo[],
    internalLinkInfo: V2InternalLinkFieldTableInfo[] = []
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

      const sourceRecordIds = rows.flatMap((row) =>
        typeof row.__id === 'string' ? [row.__id] : []
      );
      const normalizedRows = await this.normalizeInternalLinkColumns(
        dataKnex,
        rows.map((row) => this.normalizeCrossBaseLinkColumns(row, crossBaseLinkInfo)),
        sourceRecordIds,
        internalLinkInfo
      );

      for (const row of normalizedRows) {
        yield row;
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

  private async normalizeInternalLinkColumns(
    dataKnex: Knex,
    rows: Record<string, unknown>[],
    sourceRecordIds: string[],
    internalLinkInfo: V2InternalLinkFieldTableInfo[]
  ) {
    if (!rows.length || !internalLinkInfo.length) {
      return rows;
    }

    const rowsById = new Map(
      rows.flatMap((row) => (typeof row.__id === 'string' ? ([[row.__id, row]] as const) : []))
    );
    for (const row of rows) {
      for (const { dbFieldName } of internalLinkInfo) {
        delete row[dbFieldName];
      }
    }

    if (!sourceRecordIds.length) {
      return rows;
    }

    for (const info of internalLinkInfo) {
      const relations = await this.findV2InternalLinkRelations(dataKnex, sourceRecordIds, info);
      for (const [sourceRecordId, linkItems] of relations) {
        const row = rowsById.get(sourceRecordId);
        if (!row) continue;
        if (info.isMultipleCellValue) {
          row[info.dbFieldName] = linkItems;
        } else if (linkItems[0]) {
          row[info.dbFieldName] = linkItems[0];
        }
      }
    }

    return rows;
  }

  private async findV2InternalLinkRelations(
    dataKnex: Knex,
    sourceRecordIds: string[],
    info: V2InternalLinkFieldTableInfo
  ): Promise<Map<string, V2LinkCellItem[]>> {
    if (info.relationship === 'manyMany' || (info.relationship === 'oneMany' && info.isOneWay)) {
      return this.findV2JunctionLinkRelations(dataKnex, sourceRecordIds, info);
    }

    if (
      (info.relationship === 'manyOne' || info.relationship === 'oneOne') &&
      info.foreignKeyName !== '__id'
    ) {
      return this.findV2CurrentTableFkLinkRelations(dataKnex, sourceRecordIds, info);
    }

    if (
      info.relationship === 'oneMany' ||
      ((info.relationship === 'manyOne' || info.relationship === 'oneOne') &&
        info.foreignKeyName === '__id')
    ) {
      return this.findV2ForeignTableFkLinkRelations(dataKnex, sourceRecordIds, info);
    }

    return new Map();
  }

  private async findV2JunctionLinkRelations(
    dataKnex: Knex,
    sourceRecordIds: string[],
    info: V2InternalLinkFieldTableInfo
  ): Promise<Map<string, V2LinkCellItem[]>> {
    const relationRows = await dataKnex(info.fkHostTableName)
      .select({
        sourceRecordId: info.selfKeyName,
        foreignRecordId: info.foreignKeyName,
      })
      .whereIn(info.selfKeyName, sourceRecordIds)
      .orderBy(info.orderColumnName || info.foreignKeyName, 'asc');

    return this.groupLinkRelationRows(relationRows);
  }

  private async findV2CurrentTableFkLinkRelations(
    dataKnex: Knex,
    sourceRecordIds: string[],
    info: V2InternalLinkFieldTableInfo
  ): Promise<Map<string, V2LinkCellItem[]>> {
    const relationRows = await dataKnex(info.fkHostTableName)
      .select({
        sourceRecordId: info.selfKeyName,
        foreignRecordId: info.foreignKeyName,
      })
      .whereIn(info.selfKeyName, sourceRecordIds)
      .whereNotNull(info.foreignKeyName);

    return this.groupLinkRelationRows(relationRows);
  }

  private async findV2ForeignTableFkLinkRelations(
    dataKnex: Knex,
    sourceRecordIds: string[],
    info: V2InternalLinkFieldTableInfo
  ): Promise<Map<string, V2LinkCellItem[]>> {
    const query = dataKnex(info.fkHostTableName)
      .select({
        sourceRecordId: info.selfKeyName,
        foreignRecordId: info.foreignKeyName,
      })
      .whereIn(info.selfKeyName, sourceRecordIds);
    const relationRows = info.orderColumnName
      ? await query.orderBy(info.orderColumnName, 'asc')
      : await query;

    return this.groupLinkRelationRows(relationRows);
  }

  private groupLinkRelationRows(
    relationRows: Array<{ sourceRecordId?: unknown; foreignRecordId?: unknown }>
  ): Map<string, V2LinkCellItem[]> {
    const relations = new Map<string, V2LinkCellItem[]>();
    for (const { sourceRecordId, foreignRecordId } of relationRows) {
      if (typeof sourceRecordId !== 'string' || typeof foreignRecordId !== 'string') {
        continue;
      }
      const items = relations.get(sourceRecordId) ?? [];
      items.push({ id: foreignRecordId });
      relations.set(sourceRecordId, items);
    }

    return relations;
  }

  private toCrossBaseLinkTitle(value: unknown, isMultipleCellValue: boolean): unknown {
    if (value == null) {
      return value;
    }

    if (typeof value === 'string') {
      try {
        return this.toCrossBaseLinkTitle(JSON.parse(value), isMultipleCellValue);
      } catch {
        const arrayValue = this.parsePostgresTextArrayLiteral(value);
        if (arrayValue) {
          return this.toCrossBaseLinkTitle(arrayValue, isMultipleCellValue);
        }
        return value;
      }
    }

    if (Array.isArray(value)) {
      const titles = value
        .map((item) => this.toCrossBaseLinkTitle(item, false))
        .filter((item): item is string => typeof item === 'string' && Boolean(item));
      return isMultipleCellValue ? titles.join(', ') : titles[0];
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
}
