import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { CellFormat, FieldKeyType, FieldType } from '@teable/core';
import type { IFieldRo, IFieldVo, ILinkFieldOptionsRo, IRecord } from '@teable/core';
import { PrismaService } from '@teable/db-main-prisma';
import type {
  ICreateTableWithDefault,
  IDuplicateTableRo,
  IDuplicateTableVo,
  ITableFullVo,
  ITableVo,
} from '@teable/openapi';
import {
  executeCreateTableEndpoint,
  executeDeleteTableEndpoint,
  executeDuplicateTableEndpoint,
  executeRestoreTableEndpoint,
} from '@teable/v2-contract-http-implementation/handlers';
import { v2CoreTokens } from '@teable/v2-core';
import type { ICommandBus } from '@teable/v2-core';
import { CustomHttpException, getDefaultCodeByStatus } from '../../../custom.exception';
import { InjectDbProvider } from '../../../db-provider/db.provider';
import { IDbProvider } from '../../../db-provider/db.provider.interface';
import { FieldOpenApiService } from '../../field/open-api/field-open-api.service';
import { RecordService } from '../../record/record.service';
import { V2ContainerService } from '../../v2/v2-container.service';
import { V2ExecutionContextFactory } from '../../v2/v2-execution-context.factory';
import { ViewService } from '../../view/view.service';
import { TableService } from '../table.service';
import { mapLegacyCreateTableToV2Input } from './table-open-api-v2.mapper';

const internalServerError = 'Internal server error';

@Injectable()
export class TableOpenApiV2Service {
  constructor(
    private readonly v2ContainerService: V2ContainerService,
    private readonly v2ContextFactory: V2ExecutionContextFactory,
    private readonly tableService: TableService,
    private readonly fieldOpenApiService: FieldOpenApiService,
    private readonly viewService: ViewService,
    private readonly recordService: RecordService,
    private readonly prismaService: PrismaService,
    @InjectDbProvider() private readonly dbProvider: IDbProvider
  ) {}

  private throwV2Error(
    error: {
      code: string;
      message: string;
      tags?: ReadonlyArray<string>;
      details?: Readonly<Record<string, unknown>>;
    },
    status: number
  ): never {
    throw new CustomHttpException(error.message, getDefaultCodeByStatus(status), {
      domainCode: error.code,
      domainTags: error.tags,
      details: error.details,
    });
  }

  async createTable(baseId: string, createTableRo: ICreateTableWithDefault): Promise<ITableFullVo> {
    const container = await this.v2ContainerService.getContainer();
    const commandBus = container.resolve<ICommandBus>(v2CoreTokens.commandBus);
    const context = await this.v2ContextFactory.createContext();
    const normalizedCreateTableRo = await this.normalizeLegacyCreateTableRo(baseId, createTableRo);
    const result = await executeCreateTableEndpoint(
      context,
      mapLegacyCreateTableToV2Input(baseId, normalizedCreateTableRo),
      commandBus
    );

    if (result.status === 201 && result.body.ok) {
      return await this.buildLegacyCreateTableResponse(
        baseId,
        normalizedCreateTableRo,
        result.body.data.table.id
      );
    }

    if (!result.body.ok) {
      this.throwV2Error(result.body.error, result.status);
    }

    throw new HttpException(internalServerError, HttpStatus.INTERNAL_SERVER_ERROR);
  }

  async deleteTable(
    baseId: string,
    tableId: string,
    mode: 'soft' | 'permanent' = 'soft'
  ): Promise<void> {
    const container = await this.v2ContainerService.getContainer();
    const commandBus = container.resolve<ICommandBus>(v2CoreTokens.commandBus);
    const context = await this.v2ContextFactory.createContext();

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
      return;
    }

    if (!result.body.ok) {
      this.throwV2Error(result.body.error, result.status);
    }

    throw new HttpException(internalServerError, HttpStatus.INTERNAL_SERVER_ERROR);
  }

  async restoreTable(baseId: string, tableId: string): Promise<void> {
    const container = await this.v2ContainerService.getContainer();
    const commandBus = container.resolve<ICommandBus>(v2CoreTokens.commandBus);
    const context = await this.v2ContextFactory.createContext();

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
      this.throwV2Error(result.body.error, result.status);
    }

    throw new HttpException(internalServerError, HttpStatus.INTERNAL_SERVER_ERROR);
  }

  async duplicateTable(
    baseId: string,
    tableId: string,
    duplicateTableRo: IDuplicateTableRo
  ): Promise<IDuplicateTableVo> {
    const container = await this.v2ContainerService.getContainer();
    const commandBus = container.resolve<ICommandBus>(v2CoreTokens.commandBus);
    const context = await this.v2ContextFactory.createContext();
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
      await this.syncLegacyDuplicateViews(
        tableId,
        result.body.data.table.id,
        result.body.data.fieldIdMap,
        result.body.data.viewIdMap
      );
      return await this.buildLegacyDuplicateTableResponse(
        baseId,
        tableId,
        result.body.data.table.id,
        result.body.data.fieldIdMap,
        result.body.data.viewIdMap
      );
    }

    if (!result.body.ok) {
      this.throwV2Error(result.body.error, result.status);
    }

    throw new HttpException(internalServerError, HttpStatus.INTERNAL_SERVER_ERROR);
  }

  private async buildLegacyCreateTableResponse(
    baseId: string,
    createTableRo: ICreateTableWithDefault,
    tableId: string
  ): Promise<ITableFullVo> {
    const table = await this.tableService.getTableMeta(baseId, tableId);
    const fields = await this.fieldOpenApiService.getFields(tableId, {
      filterHidden: false,
    });
    const views = await this.viewService.getViews(tableId);
    const records = await this.getCreatedRecords(table, createTableRo);

    return {
      ...table,
      fields,
      views,
      records,
    };
  }

  private async buildLegacyDuplicateTableResponse(
    baseId: string,
    sourceTableId: string,
    tableId: string,
    fieldMap: Record<string, string>,
    viewMap: Record<string, string>
  ): Promise<IDuplicateTableVo> {
    const table = await this.tableService.getTableMeta(baseId, tableId);
    const fields = await this.buildLegacyDuplicateFieldResponse(sourceTableId, tableId, fieldMap);
    const views = await this.viewService.getViews(tableId);

    return {
      ...table,
      fields,
      views,
      fieldMap,
      viewMap,
    };
  }

  private async getCreatedRecords(
    table: ITableVo,
    createTableRo: ICreateTableWithDefault
  ): Promise<IRecord[]> {
    const total = createTableRo.records?.length ?? 0;
    if (total === 0) {
      return [];
    }

    const recordIds: string[] = [];
    for (let skip = 0; skip < total; skip += 1000) {
      const take = Math.min(1000, total - skip);
      const { ids } = await this.recordService.getDocIdsByQuery(table.id, {
        viewId: table.defaultViewId,
        skip,
        take,
      });
      recordIds.push(...ids);
    }

    if (recordIds.length === 0) {
      return [];
    }

    const snapshots = await this.recordService.getSnapshotBulkWithPermission(
      table.id,
      recordIds,
      undefined,
      createTableRo.fieldKeyType ?? FieldKeyType.Name,
      CellFormat.Json
    );
    const recordById = new Map(
      snapshots.map((snapshot) => [snapshot.data.id, snapshot.data] as const)
    );

    return recordIds
      .map((recordId) => recordById.get(recordId))
      .filter((record): record is IRecord => record != null);
  }

  private async buildLegacyDuplicateFieldResponse(
    sourceTableId: string,
    duplicatedTableId: string,
    fieldMap: Record<string, string>
  ): Promise<IFieldVo[]> {
    const [sourceFields, duplicatedFields] = await Promise.all([
      this.fieldOpenApiService.getFields(sourceTableId, {
        filterHidden: false,
      }),
      this.fieldOpenApiService.getFields(duplicatedTableId, {
        filterHidden: false,
      }),
    ]);

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

  private async syncLegacyDuplicateViews(
    sourceTableId: string,
    duplicatedTableId: string,
    fieldMap: Record<string, string>,
    viewMap: Record<string, string>
  ): Promise<void> {
    const sourceViews = await this.prismaService.view.findMany({
      where: {
        tableId: sourceTableId,
        deletedTime: null,
      },
      select: {
        id: true,
        filter: true,
        sort: true,
        group: true,
        options: true,
        columnMeta: true,
        enableShare: true,
      },
    });

    if (!sourceViews.length) {
      return;
    }

    const replacements = new Map<string, string>([
      ...Object.entries(fieldMap),
      ...Object.entries(viewMap),
      [sourceTableId, duplicatedTableId],
    ]);

    await Promise.all(
      sourceViews.map(async (sourceView) => {
        const duplicatedViewId = viewMap[sourceView.id];
        if (!duplicatedViewId) {
          return;
        }

        await this.prismaService.view.update({
          where: {
            id: duplicatedViewId,
          },
          data: {
            filter: this.remapLegacyJsonString(sourceView.filter, replacements),
            sort: this.remapLegacyJsonString(sourceView.sort, replacements),
            group: this.remapLegacyJsonString(sourceView.group, replacements),
            options: this.remapLegacyJsonString(sourceView.options, replacements),
            columnMeta: this.remapLegacyJsonString(sourceView.columnMeta, replacements),
            enableShare: sourceView.enableShare ?? null,
          },
        });
      })
    );
  }

  private remapLegacyJsonString(value: string, replacements: ReadonlyMap<string, string>): string;
  private remapLegacyJsonString(
    value: string | null,
    replacements: ReadonlyMap<string, string>
  ): string | null;
  private remapLegacyJsonString(
    value: string | null,
    replacements: ReadonlyMap<string, string>
  ): string | null {
    if (!value) {
      return value;
    }

    return JSON.stringify(this.remapLegacyStructuredValue(JSON.parse(value), replacements));
  }

  private remapLegacyStructuredValue(
    value: unknown,
    replacements: ReadonlyMap<string, string>
  ): unknown {
    if (typeof value === 'string') {
      return replacements.get(value) ?? value;
    }

    if (Array.isArray(value)) {
      return value.map((entry) => this.remapLegacyStructuredValue(entry, replacements));
    }

    if (value && typeof value === 'object') {
      return Object.entries(value as Record<string, unknown>).reduce<Record<string, unknown>>(
        (acc, [key, entryValue]) => {
          acc[replacements.get(key) ?? key] = this.remapLegacyStructuredValue(
            entryValue,
            replacements
          );
          return acc;
        },
        {}
      );
    }

    return value;
  }

  private async normalizeLegacyCreateTableRo(
    baseId: string,
    createTableRo: ICreateTableWithDefault
  ): Promise<ICreateTableWithDefault> {
    const withLookupFieldIds = await this.populateLegacyLinkLookupFieldIds(createTableRo);
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
    createTableRo: ICreateTableWithDefault
  ): Promise<ICreateTableWithDefault> {
    const fields = createTableRo.fields ?? [];
    const foreignTableIds = [
      ...new Set(
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
          return typeof foreignTableId === 'string' ? [foreignTableId] : [];
        })
      ),
    ];

    if (foreignTableIds.length === 0) {
      return createTableRo;
    }

    const primaryFieldIdByTableId = new Map<string, string>();
    await Promise.all(
      foreignTableIds.map(async (foreignTableId) => {
        const foreignFields = await this.fieldOpenApiService.getFields(foreignTableId, {
          filterHidden: false,
        });
        const primaryField = foreignFields.find(
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
