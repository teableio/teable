import { Injectable, Logger } from '@nestjs/common';
import type { ILinkFieldOptions } from '@teable/core';
import {
  generateViewId,
  generateShareId,
  FieldType,
  ViewType,
  generatePluginInstallId,
  HttpErrorCode,
} from '@teable/core';
import type { View } from '@teable/db-main-prisma';
import { PrismaService, ProvisionState } from '@teable/db-main-prisma';
import {
  CreateRecordAction,
  type ICrossSpaceTableAffectedField,
  type IDuplicateTableRo,
  type IDuplicateTableVo,
  type IFieldWithTableIdJson,
} from '@teable/openapi';
import { Knex } from 'knex';
import { get, pick, omit } from 'lodash';
import { InjectModel } from 'nest-knexjs';
import { ClsService } from 'nestjs-cls';
import { CustomHttpException } from '../../custom.exception';
import { InjectDbProvider } from '../../db-provider/db.provider';
import { IDbProvider } from '../../db-provider/db.provider.interface';
import { Events } from '../../event-emitter/events';
import { DataDbClientManager } from '../../global/data-db-client-manager.service';
import { CUSTOM_KNEX, DATA_KNEX } from '../../global/knex/knex.module';
import type { IClsStore } from '../../types/cls';
import { AuditScope } from '../audit/audit-scope';
import { Audit } from '../audit/audit.decorator';
import {
  collectCrossSpaceAffectedFieldIds,
  extractForeignTableId,
} from '../base/cross-space-detection.util';
import type { ILinkFieldTableInfo } from '../base/utils';
import { DataLoaderService } from '../data-loader/data-loader.service';
import { FieldDuplicateService } from '../field/field-duplicate/field-duplicate.service';
import { createFieldInstanceByRaw, rawField2FieldObj } from '../field/model/factory';
import type { LinkFieldDto } from '../field/model/field-dto/link-field.dto';
import { FieldOpenApiService } from '../field/open-api/field-open-api.service';
import { ROW_ORDER_FIELD_PREFIX } from '../view/constant';
import { createViewVoByRaw } from '../view/model/factory';
import { TableService } from './table.service';

type IDataPrismaExecutor = {
  $executeRawUnsafe(query: string, ...values: unknown[]): Promise<number>;
  $queryRawUnsafe<T = unknown>(query: string, ...values: unknown[]): Promise<T>;
};

type IDataPrismaScopedClient = IDataPrismaExecutor & {
  txClient?: () => IDataPrismaExecutor;
};

type IDuplicateTableDataProgress = {
  processedRows: number;
  batchProcessedRows: number;
  currentBatch: number;
  totalRows: number;
};

type IDuplicateTableDataOptions = {
  batchSize?: number;
  onProgress?: (progress: IDuplicateTableDataProgress) => void;
};

const duplicateTableDataDefaultBatchSize = 500;
const autoNumberFieldName = '__auto_number';

@Injectable()
export class TableDuplicateService {
  private logger = new Logger(TableDuplicateService.name);

  constructor(
    private readonly cls: ClsService<IClsStore>,
    private readonly prismaService: PrismaService,
    private readonly tableService: TableService,
    private readonly fieldOpenService: FieldOpenApiService,
    private readonly fieldDuplicateService: FieldDuplicateService,
    private readonly dataLoaderService: DataLoaderService,
    @InjectDbProvider() private readonly dbProvider: IDbProvider,
    @InjectModel(CUSTOM_KNEX) private readonly knex: Knex,
    @InjectModel(DATA_KNEX) private readonly dataKnex: Knex,
    private readonly dataDbClientManager: DataDbClientManager,
    private readonly audit: AuditScope
  ) {}

  private getDataPrismaExecutor(prisma: IDataPrismaScopedClient): IDataPrismaExecutor {
    return prisma.txClient?.() ?? prisma;
  }

  private async assertSameDataDatabaseForRecordCopy(sourceTableId: string, targetBaseId: string) {
    const [source, target] = await Promise.all([
      this.dataDbClientManager.getDataDatabaseForTable(sourceTableId, { useTransaction: true }),
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

  private disableTableDomainDataLoader() {
    if (!this.cls.isActive()) {
      return;
    }
    this.cls.set('dataLoaderCache.disabled', true);
    this.cls.set('dataLoaderCache.cacheKeys', []);
    this.dataLoaderService.field.clear();
    this.dataLoaderService.table.clear();
  }

  @Audit({
    // Only open scope when records are being duplicated; structure-only duplication doesn't
    // need a record-mutation source.
    rootAction: (_baseId: string, _tableId: string, ro: IDuplicateTableRo) =>
      ro.includeRecords ? CreateRecordAction.TableDuplicate : undefined,
    resourceId: (_baseId: string, tableId: string) => tableId,
    params: (_baseId: string, _tableId: string, ro: IDuplicateTableRo) =>
      ro as unknown as Record<string, unknown>,
  })
  async duplicateTable(baseId: string, tableId: string, duplicateRo: IDuplicateTableRo) {
    const { includeRecords, name } = duplicateRo;
    this.disableTableDomainDataLoader();
    const {
      id: sourceTableId,
      icon,
      description,
      dbTableName,
    } = await this.prismaService.tableMeta.findUniqueOrThrow({
      where: { id: tableId },
    });

    const userId = this.cls.get('user.id');
    let newTableVo:
      | {
          id: string;
          dbTableName: string;
        }
      | undefined;

    try {
      newTableVo = await this.tableService.createTable(baseId, {
        name,
        icon,
        description,
      });

      await this.prismaService.tableMeta.update({
        where: { id: newTableVo.id },
        data: {
          provisionState: ProvisionState.pending,
          lastModifiedBy: userId,
        },
      });

      const sourceToTargetFieldMap = await this.duplicateFields(sourceTableId, newTableVo.id);
      const sourceToTargetViewMap = await this.duplicateViews(
        sourceTableId,
        newTableVo.id,
        sourceToTargetFieldMap
      );
      await this.repairDuplicateOmit(sourceToTargetFieldMap, sourceToTargetViewMap, newTableVo.id);

      if (includeRecords) {
        await this.assertSameDataDatabaseForRecordCopy(tableId, baseId);
        const dataPrisma = this.getDataPrismaExecutor(
          await this.dataDbClientManager.dataPrismaForTable(newTableVo.id, {
            useTransaction: true,
          })
        );
        await this.duplicateTableData(
          dbTableName,
          newTableVo.dbTableName,
          sourceToTargetViewMap,
          sourceToTargetFieldMap,
          [],
          dataPrisma
        );

        await this.duplicateAttachments(
          sourceTableId,
          newTableVo.id,
          sourceToTargetFieldMap,
          dataPrisma
        );
        await this.duplicateLinkJunction(
          { [sourceTableId]: newTableVo.id },
          sourceToTargetFieldMap,
          true,
          dataPrisma
        );
        // Audit row emitted manually inside duplicateTableData (raw SQL bypasses v2 events).
      }

      const viewPlain = await this.prismaService.txClient().view.findMany({
        where: {
          tableId: newTableVo.id,
          deletedTime: null,
        },
        orderBy: {
          order: 'asc',
        },
      });

      const fieldPlain = await this.prismaService.txClient().field.findMany({
        where: {
          tableId: newTableVo.id,
          deletedTime: null,
        },
        orderBy: {
          createdTime: 'asc',
        },
      });

      await this.prismaService.tableMeta.update({
        where: { id: newTableVo.id },
        data: {
          provisionState: ProvisionState.ready,
          lastModifiedBy: userId,
        },
      });

      return {
        ...newTableVo,
        views: viewPlain.map((v) => createViewVoByRaw(v)),
        fields: fieldPlain.map((f) => omit(rawField2FieldObj(f), ['meta'])),
        viewMap: sourceToTargetViewMap,
        fieldMap: sourceToTargetFieldMap,
        defaultViewId: viewPlain[0]?.id,
      } as IDuplicateTableVo;
    } catch (error) {
      if (newTableVo?.id) {
        await this.prismaService.tableMeta
          .update({
            where: { id: newTableVo.id },
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

  // Raw SQL bulk insert (no v2 events fire). Emits one atomic record-create row using
  // the caller's active operation (TableDuplicate / BaseDuplicate / TemplateApply /
  // ShareBaseCopy).
  @Audit({
    action: Events.TABLE_RECORD_CREATE,
    emit: (result: unknown) => ({ recordCount: result as number }),
  })
  async duplicateTableData(
    sourceDbTableName: string,
    targetDbTableName: string,
    sourceToTargetViewMap: Record<string, string>,
    sourceToTargetFieldMap: Record<string, string>,
    crossBaseLinkInfo: ILinkFieldTableInfo[],
    dataPrisma: IDataPrismaExecutor,
    options?: IDuplicateTableDataOptions
  ): Promise<number> {
    const prisma = dataPrisma;
    const metaPrisma = this.prismaService.txClient();
    const qb = this.dataKnex.queryBuilder();

    const columnInfoQuery = this.dbProvider.columnInfo(sourceDbTableName);

    const newColumnsInfoQuery = this.dbProvider.columnInfo(targetDbTableName);

    const allSourceColumns = (
      await prisma.$queryRawUnsafe<{ name: string }[]>(columnInfoQuery)
    ).map(({ name }) => name);

    // Only filter by crossBaseLinkInfo if it's not empty
    // When crossBaseLinkInfo is empty (normal table duplication), include all columns
    const oldOriginColumns =
      crossBaseLinkInfo.length === 0
        ? allSourceColumns
        : allSourceColumns.filter((name) =>
            crossBaseLinkInfo
              .map(({ selfKeyName }) => selfKeyName)
              .filter((selfKeyName) => selfKeyName !== '__id' && selfKeyName)
              .includes(name)
          );

    const crossBaseLinkDbFieldNames = crossBaseLinkInfo.map(
      ({ dbFieldName, isMultipleCellValue }) => ({
        dbFieldName,
        isMultipleCellValue,
      })
    );

    const newOriginColumns = (
      await prisma.$queryRawUnsafe<{ name: string }[]>(newColumnsInfoQuery)
    ).map(({ name }) => name);

    const oldRowColumns = oldOriginColumns.filter((name) =>
      name.startsWith(ROW_ORDER_FIELD_PREFIX)
    );

    // Exclude computed field columns (formula/lookup/rollup/created time/etc.) from data insertion
    // because generated columns cannot be directly inserted into
    let computedDbFieldNames: string[] = [];
    try {
      const targetTable = await metaPrisma.tableMeta.findFirst({
        where: { dbTableName: targetDbTableName, deletedTime: null },
        select: { id: true },
      });
      if (targetTable?.id) {
        const computedFields = await metaPrisma.field.findMany({
          where: { tableId: targetTable.id, deletedTime: null, isComputed: true },
          select: { dbFieldName: true },
        });
        computedDbFieldNames = computedFields.map((f) => f.dbFieldName);
      }
    } catch (_e) {
      // Best effort; if query fails, fallback to existing filters
      computedDbFieldNames = [];
    }

    const computedSet = new Set(computedDbFieldNames);

    const newFieldColumns = newOriginColumns.filter(
      (name) =>
        !name.startsWith(ROW_ORDER_FIELD_PREFIX) &&
        !name.startsWith('__fk_fld') &&
        !computedSet.has(name)
    );

    const oldFkColumns = oldOriginColumns.filter((name) => name.startsWith('__fk_fld'));

    const newRowColumns = oldRowColumns.map((name) =>
      sourceToTargetViewMap[name.slice(6)] ? `__row_${sourceToTargetViewMap[name.slice(6)]}` : name
    );

    const newFkColumns = oldFkColumns.map((name) =>
      sourceToTargetFieldMap[name.slice(5)] ? `__fk_${sourceToTargetFieldMap[name.slice(5)]}` : name
    );

    for (const name of newRowColumns) {
      await this.createRowOrderField(targetDbTableName, name.slice(6), prisma);
    }

    for (const name of newFkColumns) {
      await this.createFkField(targetDbTableName, name.slice(5), prisma);
    }

    // following field should not be duplicated
    const systemColumns = [
      '__auto_number',
      '__created_time',
      '__last_modified_time',
      '__last_modified_by',
    ];

    const excludeFields = await metaPrisma.field.findMany({
      where: {
        id: {
          in: Object.keys(sourceToTargetFieldMap),
        },
        type: FieldType.Button,
      },
      select: {
        dbFieldName: true,
      },
    });
    const excludeDbFieldNames = excludeFields.map(({ dbFieldName }) => dbFieldName);
    const excludeColumnsSet = new Set([
      ...systemColumns,
      ...excludeDbFieldNames,
      ...computedDbFieldNames,
    ]);

    // use new table field columns info
    // old table contains ghost columns or customer columns
    const oldColumns = newFieldColumns
      .concat(oldRowColumns)
      .concat(oldFkColumns)
      .filter((dbFieldName) => !excludeColumnsSet.has(dbFieldName));

    const newColumns = newFieldColumns
      .concat(newRowColumns)
      .concat(newFkColumns)
      .filter((dbFieldName) => !excludeColumnsSet.has(dbFieldName));

    const buildDuplicateSql = (range?: {
      minAutoNumberExclusive?: number;
      maxAutoNumberInclusive?: number;
    }) =>
      this.dbProvider
        .duplicateTableQuery(this.dataKnex.queryBuilder())
        .duplicateTableData(
          sourceDbTableName,
          targetDbTableName,
          newColumns,
          oldColumns,
          crossBaseLinkDbFieldNames,
          range
        )
        .toQuery();

    const sql = this.dbProvider
      .duplicateTableQuery(qb)
      .duplicateTableData(
        sourceDbTableName,
        targetDbTableName,
        newColumns,
        oldColumns,
        crossBaseLinkDbFieldNames
      )
      .toQuery();

    const sourceTableCountSql = this.dataKnex(sourceDbTableName)
      .count('*', { as: 'count' })
      .toQuery();

    const sourceTableCountResult =
      await prisma.$queryRawUnsafe<[{ count: bigint | number }]>(sourceTableCountSql);
    const totalRows = Number(sourceTableCountResult[0]?.count || 0);

    if (!options?.onProgress || totalRows === 0) {
      await prisma.$executeRawUnsafe(sql);
      return totalRows;
    }

    const batchSize = options.batchSize ?? duplicateTableDataDefaultBatchSize;
    let lastAutoNumber = 0;
    let processedRows = 0;
    let currentBatch = 0;

    while (processedRows < totalRows) {
      const autoNumberRowsSql = this.dataKnex(sourceDbTableName)
        .select(autoNumberFieldName)
        .where(autoNumberFieldName, '>', lastAutoNumber)
        .orderBy(autoNumberFieldName, 'asc')
        .limit(batchSize)
        .toQuery();
      const autoNumberRows =
        await prisma.$queryRawUnsafe<
          Array<Record<typeof autoNumberFieldName, bigint | number | string>>
        >(autoNumberRowsSql);
      if (!autoNumberRows.length) {
        break;
      }

      const batchLastAutoNumber = Number(
        autoNumberRows[autoNumberRows.length - 1]![autoNumberFieldName]
      );
      await prisma.$executeRawUnsafe(
        buildDuplicateSql({
          minAutoNumberExclusive: lastAutoNumber,
          maxAutoNumberInclusive: batchLastAutoNumber,
        })
      );

      currentBatch += 1;
      processedRows += autoNumberRows.length;
      options.onProgress({
        processedRows,
        batchProcessedRows: autoNumberRows.length,
        currentBatch,
        totalRows,
      });
      lastAutoNumber = batchLastAutoNumber;
    }

    return totalRows;
  }

  private async createRowOrderField(
    dbTableName: string,
    viewId: string,
    dataPrisma: IDataPrismaExecutor
  ) {
    const prisma = dataPrisma;

    const rowIndexFieldName = `${ROW_ORDER_FIELD_PREFIX}_${viewId}`;

    const columnExists = await this.dbProvider.checkColumnExist(
      dbTableName,
      rowIndexFieldName,
      prisma
    );

    if (!columnExists) {
      // add a field for maintain row order number
      const addRowIndexColumnSql = this.dataKnex.schema
        .alterTable(dbTableName, (table) => {
          table.double(rowIndexFieldName);
        })
        .toQuery();
      await prisma.$executeRawUnsafe(addRowIndexColumnSql);
    }

    // create index
    const indexName = `idx_${ROW_ORDER_FIELD_PREFIX}_${viewId}`;
    const createRowIndexSQL = this.dataKnex
      .raw(
        `
  CREATE INDEX IF NOT EXISTS ?? ON ?? (??)
`,
        [indexName, dbTableName, rowIndexFieldName]
      )
      .toQuery();

    await prisma.$executeRawUnsafe(createRowIndexSQL);
  }

  private async createFkField(
    dbTableName: string,
    fieldId: string,
    dataPrisma: IDataPrismaExecutor
  ) {
    const prisma = dataPrisma;

    const fkFieldName = `__fk_${fieldId}`;

    const columnExists = await this.dbProvider.checkColumnExist(dbTableName, fkFieldName, prisma);

    if (!columnExists) {
      const addFkColumnSql = this.dataKnex.schema
        .alterTable(dbTableName, (table) => {
          table.string(fkFieldName);
        })
        .toQuery();
      await prisma.$executeRawUnsafe(addFkColumnSql);
    }
  }

  async previewFieldDuplicateCrossSpace(
    tableId: string,
    fieldId: string
  ): Promise<ICrossSpaceTableAffectedField[]> {
    return (await this.previewCrossSpaceAffectedFields(tableId)).filter(
      (f) => f.fieldId === fieldId
    );
  }

  async previewCrossSpaceAffectedFields(
    sourceTableId: string,
    targetTableId: string = sourceTableId
  ): Promise<ICrossSpaceTableAffectedField[]> {
    const prisma = this.prismaService.txClient();

    const fieldsRaw = await prisma.field.findMany({
      where: { tableId: sourceTableId, deletedTime: null },
    });
    if (!fieldsRaw.length) return [];

    const foreignTableIds = Array.from(
      new Set(
        fieldsRaw
          .map((f) => extractForeignTableId(f))
          .filter((ft): ft is string => !!ft && ft !== targetTableId)
      )
    );
    if (foreignTableIds.length === 0) return [];

    const rows = await prisma.tableMeta.findMany({
      where: { id: { in: [targetTableId, ...foreignTableIds] }, deletedTime: null },
      select: { id: true, base: { select: { spaceId: true } } },
    });
    const spaceMap = new Map(rows.map((r) => [r.id, r.base.spaceId]));
    const targetSpace = spaceMap.get(targetTableId);
    if (!targetSpace) return [];

    const affected = collectCrossSpaceAffectedFieldIds({
      fields: fieldsRaw,
      isForeignInternal: (ft) => ft === targetTableId,
      isForeignCrossSpace: (ft) => {
        const s = spaceMap.get(ft);
        return Boolean(s && s !== targetSpace);
      },
    });

    return fieldsRaw
      .filter((f) => affected.has(f.id))
      .map((f) => ({ fieldId: f.id, fieldName: f.name, type: f.type }));
  }

  private async identifyCrossSpaceFieldIds(
    targetTableId: string,
    fields: IFieldWithTableIdJson[]
  ): Promise<Set<string>> {
    const foreignTableIds = Array.from(
      new Set(
        fields
          .map((f) => extractForeignTableId(f))
          .filter((ft): ft is string => !!ft && ft !== targetTableId)
      )
    );
    if (!foreignTableIds.length) return new Set();

    const rows = await this.prismaService.txClient().tableMeta.findMany({
      where: { id: { in: [targetTableId, ...foreignTableIds] }, deletedTime: null },
      select: { id: true, base: { select: { spaceId: true } } },
    });
    const spaceMap = new Map(rows.map((r) => [r.id, r.base.spaceId]));
    const targetSpace = spaceMap.get(targetTableId);
    if (!targetSpace) return new Set();

    return collectCrossSpaceAffectedFieldIds({
      fields,
      isForeignInternal: (ft) => ft === targetTableId,
      isForeignCrossSpace: (ft) => {
        const s = spaceMap.get(ft);
        return Boolean(s && s !== targetSpace);
      },
    });
  }

  private async duplicateFields(sourceTableId: string, targetTableId: string) {
    const fieldsRaw = await this.prismaService.txClient().field.findMany({
      where: { tableId: sourceTableId, deletedTime: null },
      // for promise the link group create order
      orderBy: {
        createdTime: 'asc',
      },
    });
    const fieldsInstances = fieldsRaw
      .map((f) => ({
        ...createFieldInstanceByRaw(f),
        order: f.order,
        createdTime: f.createdTime.toISOString(),
      }))
      .map((f) => {
        return {
          ...f,
          sourceTableId,
          targetTableId,
        } as IFieldWithTableIdJson;
      });
    const sourceToTargetFieldMap: Record<string, string> = {};
    const tableIdMap: Record<string, string> = {
      [sourceTableId]: targetTableId,
    };

    const nonCommonFieldTypes = [
      FieldType.Link,
      FieldType.Rollup,
      FieldType.ConditionalRollup,
      FieldType.Formula,
      FieldType.Button,
    ];

    // Identify cross-space link fields and their direct lookup/rollup dependents.
    // After duplication these would otherwise be rejected by the cross-space
    // assertion in field-supplement; we route them through createCommonFields as
    // single line text instead.
    const crossSpaceIds = await this.identifyCrossSpaceFieldIds(targetTableId, fieldsInstances);

    const downgradeToText = (f: IFieldWithTableIdJson): IFieldWithTableIdJson => {
      const mutable: Record<string, unknown> = { ...f };
      mutable.type = FieldType.SingleLineText;
      delete mutable.options;
      delete mutable.lookupOptions;
      delete mutable.isLookup;
      delete mutable.isConditionalLookup;
      delete mutable.isComputed;
      delete mutable.isMultipleCellValue;
      delete mutable.dbFieldType;
      delete mutable.cellValueType;
      return mutable as IFieldWithTableIdJson;
    };

    const downgradedFields = fieldsInstances
      .filter(({ id }) => crossSpaceIds.has(id))
      .map(downgradeToText);

    const commonFields = fieldsInstances.filter(
      ({ id, type, isLookup, aiConfig }) =>
        !crossSpaceIds.has(id) && !nonCommonFieldTypes.includes(type) && !isLookup && !aiConfig
    );

    // the primary formula which rely on other fields
    const primaryFormulaFields = fieldsInstances.filter(
      ({ id, type, isLookup }) => !crossSpaceIds.has(id) && type === FieldType.Formula && !isLookup
    );

    // these field require other field, we need to merge them and ensure a specific order
    const linkFields = fieldsInstances.filter(
      ({ id, type, isLookup }) => !crossSpaceIds.has(id) && type === FieldType.Link && !isLookup
    );

    const buttonFields = fieldsInstances.filter(
      ({ id, type, isLookup }) => !crossSpaceIds.has(id) && type === FieldType.Button && !isLookup
    );

    // rest fields, like formula, rollup, lookup fields
    const dependencyFields = fieldsInstances.filter(
      ({ id }) =>
        !crossSpaceIds.has(id) &&
        ![...primaryFormulaFields, ...linkFields, ...buttonFields, ...commonFields]
          .map(({ id }) => id)
          .includes(id)
    );

    if (downgradedFields.length) {
      await this.fieldDuplicateService.createCommonFields(downgradedFields, sourceToTargetFieldMap);
    }

    await this.fieldDuplicateService.createCommonFields(commonFields, sourceToTargetFieldMap);

    await this.fieldDuplicateService.createButtonFields(buttonFields, sourceToTargetFieldMap);

    await this.fieldDuplicateService.createTmpPrimaryFormulaFields(
      primaryFormulaFields,
      sourceToTargetFieldMap
    );

    // main fix formula dbField type
    await this.fieldDuplicateService.repairPrimaryFormulaFields(
      primaryFormulaFields,
      sourceToTargetFieldMap
    );

    // duplicate link fields different from duplicate base link field
    await this.duplicateLinkFields(
      sourceTableId,
      targetTableId,
      linkFields,
      sourceToTargetFieldMap
    );

    await this.fieldDuplicateService.createDependencyFields(
      dependencyFields,
      tableIdMap,
      sourceToTargetFieldMap,
      'table'
    );

    // fix formula expression' field map
    await this.fieldDuplicateService.repairPrimaryFormulaFields(
      primaryFormulaFields,
      sourceToTargetFieldMap
    );

    const formulaFields = fieldsInstances.filter(
      ({ type, isLookup }) => type === FieldType.Formula && !isLookup
    );

    // fix formula reference
    await this.fieldDuplicateService.repairFormulaReference(formulaFields, sourceToTargetFieldMap);

    return sourceToTargetFieldMap;
  }

  private async duplicateLinkFields(
    sourceTableId: string,
    targetTableId: string,
    linkFields: IFieldWithTableIdJson[],
    sourceToTargetFieldMap: Record<string, string>
  ) {
    const twoWaySelfLinkFields = linkFields.filter((f) => {
      const options = f.options as ILinkFieldOptions;
      return options.foreignTableId === sourceTableId;
    });

    const mergedTwoWaySelfLinkFields = [] as [IFieldWithTableIdJson, IFieldWithTableIdJson][];

    twoWaySelfLinkFields.forEach((f) => {
      // two-way self link field should only create one of it
      if (!mergedTwoWaySelfLinkFields.some((group) => group.some(({ id: fId }) => fId === f.id))) {
        const groupField = twoWaySelfLinkFields.find(
          ({ options }) => get(options, 'symmetricFieldId') === f.id
        );
        groupField && mergedTwoWaySelfLinkFields.push([f, groupField]);
      }
    });

    const otherLinkFields = linkFields.filter(
      (f) => !twoWaySelfLinkFields.map((f) => f.id).includes(f.id)
    );

    // self link field
    for (let i = 0; i < mergedTwoWaySelfLinkFields.length; i++) {
      const f = mergedTwoWaySelfLinkFields[i][0];
      const { notNull, unique, description } = f;
      const groupField = mergedTwoWaySelfLinkFields[i][1] as unknown as LinkFieldDto;
      const { name, type, dbFieldName, id, order } = f;
      const options = f.options as ILinkFieldOptions;
      const newField = await this.fieldOpenService.createField(targetTableId, {
        type: type as FieldType,
        dbFieldName,
        name,
        description,
        options: {
          ...pick(options, [
            'relationship',
            'isOneWay',
            'filterByViewId',
            'filter',
            'visibleFieldIds',
          ]),
          foreignTableId: targetTableId,
        },
      });
      await this.fieldDuplicateService.replenishmentConstraint(newField.id, targetTableId, order, {
        notNull,
        unique,
        dbFieldName,
      });
      sourceToTargetFieldMap[id] = newField.id;
      sourceToTargetFieldMap[options.symmetricFieldId!] = (
        newField.options as ILinkFieldOptions
      ).symmetricFieldId!;

      // self link should updated the opposite field dbFieldName and name
      const { dbTableName: targetDbTableName } = await this.prismaService
        .txClient()
        .tableMeta.findUniqueOrThrow({
          where: {
            id: targetTableId,
          },
          select: {
            dbTableName: true,
          },
        });

      const { dbFieldName: genDbFieldName } = await this.prismaService
        .txClient()
        .field.findUniqueOrThrow({
          where: {
            id: sourceToTargetFieldMap[groupField.id],
          },
          select: {
            dbFieldName: true,
          },
        });

      await this.prismaService.txClient().field.update({
        where: {
          id: sourceToTargetFieldMap[groupField.id],
        },
        data: {
          dbFieldName: groupField.dbFieldName,
          name: groupField.name,
          options: JSON.stringify({ ...groupField.options, foreignTableId: targetTableId }),
        },
      });

      // Only attempt to rename if a physical column exists.
      // Link fields do not create standard columns; self-link symmetric side definitely doesn't.
      const dataPrisma = this.getDataPrismaExecutor(
        await this.dataDbClientManager.dataPrismaForTable(targetTableId, { useTransaction: true })
      );
      const exists = await this.dbProvider.checkColumnExist(
        targetDbTableName,
        genDbFieldName,
        dataPrisma
      );
      if (exists) {
        const alterTableSql = this.dbProvider.renameColumn(
          targetDbTableName,
          genDbFieldName,
          groupField.dbFieldName
        );
        for (const sql of alterTableSql) {
          await dataPrisma.$executeRawUnsafe(sql);
        }
      }
    }

    // other common link field
    for (let i = 0; i < otherLinkFields.length; i++) {
      const f = otherLinkFields[i];
      const { type, description, name, notNull, unique, options, dbFieldName, order } = f;
      const newField = await this.fieldOpenService.createField(targetTableId, {
        type: type as FieldType,
        description,
        dbFieldName,
        name,
        options: {
          ...pick(options, [
            'baseId',
            'relationship',
            'foreignTableId',
            'isOneWay',
            'filterByViewId',
            'filter',
            'visibleFieldIds',
          ]),
          // duplicate link field always be one-way, consider that advanced auth control etc.
          isOneWay: true,
        } as ILinkFieldOptions,
      });
      await this.fieldDuplicateService.replenishmentConstraint(newField.id, targetTableId, order, {
        notNull,
        unique,
        dbFieldName,
      });
      sourceToTargetFieldMap[f.id] = newField.id;
    }
  }

  private async duplicateViews(
    sourceTableId: string,
    targetTableId: string,
    sourceToTargetFieldMap: Record<string, string>
  ) {
    const views = await this.prismaService.view.findMany({
      where: { tableId: sourceTableId, deletedTime: null },
    });
    const viewsWithoutPlugin = views.filter((v) => v.type !== ViewType.Plugin);
    const pluginViews = views.filter(({ type }) => type === ViewType.Plugin);
    const sourceToTargetViewMap = {} as Record<string, string>;
    const userId = this.cls.get('user.id');
    const prisma = this.prismaService.txClient();
    await prisma.view.createMany({
      data: viewsWithoutPlugin.map((view) => {
        const fieldsToReplace = ['columnMeta', 'options', 'sort', 'group', 'filter'] as const;

        const updatedFields = fieldsToReplace.reduce(
          (acc, field) => {
            if (view[field]) {
              acc[field] = Object.entries(sourceToTargetFieldMap).reduce(
                (result, [key, value]) => result.replaceAll(key, value),
                view[field]!
              );
            }
            return acc;
          },
          {} as Partial<typeof view>
        );

        const newViewId = generateViewId();

        sourceToTargetViewMap[view.id] = newViewId;

        return {
          ...view,
          createdTime: new Date().toISOString(),
          createdBy: userId,
          version: 1,
          tableId: targetTableId,
          id: newViewId,
          shareId: generateShareId(),
          ...updatedFields,
        };
      }),
    });

    // duplicate plugin view
    await this.duplicatePluginViews(
      targetTableId,
      pluginViews,
      sourceToTargetViewMap,
      sourceToTargetFieldMap
    );

    return sourceToTargetViewMap;
  }

  private async duplicatePluginViews(
    targetTableId: string,
    pluginViews: View[],
    sourceToTargetViewMap: Record<string, string>,
    sourceToTargetFieldMap: Record<string, string>
  ) {
    const prisma = this.prismaService.txClient();

    if (!pluginViews.length) return;

    const pluginData = await prisma.pluginInstall.findMany({
      where: {
        id: {
          in: pluginViews.map((v) => (v.options ? JSON.parse(v.options).pluginInstallId : null)),
        },
      },
    });

    for (const view of pluginViews) {
      const plugin = view.options ? JSON.parse(view.options) : null;
      if (!plugin) {
        throw new CustomHttpException(
          `Duplicate plugin view error: plugin not found`,
          HttpErrorCode.NOT_FOUND,
          {
            localization: {
              i18nKey: 'httpErrors.plugin.notFound',
            },
          }
        );
      }
      const { pluginInstallId, pluginId } = plugin;

      const newPluginInsId = generatePluginInstallId();
      const newViewId = generateViewId();

      sourceToTargetViewMap[view.id] = newViewId;

      const pluginInfo = pluginData.find((p) => p.id === pluginInstallId);

      if (!pluginInfo) continue;

      let curPluginStorage = pluginInfo?.storage;
      let pluginOptions = plugin.options;

      if (curPluginStorage) {
        Object.entries(sourceToTargetFieldMap).forEach(([key, value]) => {
          curPluginStorage = curPluginStorage?.replaceAll(key, value) || null;
        });
      }

      if (pluginOptions) {
        Object.entries(sourceToTargetFieldMap).forEach(([key, value]) => {
          pluginOptions = pluginOptions.replaceAll(key, value);
        });
        pluginOptions = pluginOptions.replaceAll(pluginId, newPluginInsId);
      }

      const fieldsToReplace = ['columnMeta', 'options', 'sort', 'group', 'filter'] as const;

      const updatedFields = fieldsToReplace.reduce(
        (acc, field) => {
          if (view[field]) {
            acc[field] = Object.entries(sourceToTargetFieldMap).reduce(
              (result, [key, value]) => result.replaceAll(key, value),
              view[field]!
            );
          }
          return acc;
        },
        {} as Partial<typeof view>
      );

      await prisma.pluginInstall.create({
        data: {
          ...pluginInfo,
          createdBy: this.cls.get('user.id'),
          id: newPluginInsId,
          createdTime: new Date().toISOString(),
          lastModifiedBy: null,
          lastModifiedTime: null,
          storage: curPluginStorage,
          positionId: newViewId,
        },
      });

      await prisma.view.create({
        data: {
          ...view,
          createdTime: new Date().toISOString(),
          createdBy: this.cls.get('user.id'),
          version: 1,
          tableId: targetTableId,
          id: newViewId,
          shareId: generateShareId(),
          options: pluginOptions,
          ...updatedFields,
        },
      });
    }

    return sourceToTargetViewMap;
  }

  private async repairDuplicateOmit(
    sourceToTargetFieldMap: Record<string, string>,
    sourceToTargetViewMap: Record<string, string>,
    targetTableId: string
  ) {
    const fieldRaw = await this.prismaService.txClient().field.findMany({
      where: {
        tableId: targetTableId,
        deletedTime: null,
      },
      orderBy: {
        createdTime: 'asc',
      },
    });

    const selfLinkFields = fieldRaw.filter(
      ({ type, options }) =>
        type === FieldType.Link &&
        options &&
        (JSON.parse(options) as ILinkFieldOptions)?.foreignTableId === targetTableId
    );

    for (const field of selfLinkFields) {
      const { id: fieldId, options } = field;
      if (!options) continue;

      let newOptions = options;

      Object.entries(sourceToTargetFieldMap).forEach(([key, value]) => {
        newOptions = newOptions.replaceAll(key, value);
      });

      Object.entries(sourceToTargetViewMap).forEach(([key, value]) => {
        newOptions = newOptions.replaceAll(key, value);
      });

      await this.prismaService.txClient().field.update({
        where: {
          id: fieldId,
        },
        data: {
          options: newOptions,
        },
      });
    }
  }

  private extractFieldIds(expression: string): string[] {
    const matches = expression.match(/\{fld[a-zA-Z0-9]+\}/g);

    if (!matches) {
      return [];
    }
    return matches.map((match) => match.slice(1, -1));
  }

  async duplicateAttachments(
    sourceTableId: string,
    targetTableId: string,
    fieldIdMap: Record<string, string>,
    dataPrisma: IDataPrismaExecutor
  ) {
    const prisma = dataPrisma;
    const metaPrisma = this.prismaService.txClient();
    const attachmentFieldRaws = await metaPrisma.field.findMany({
      where: {
        tableId: sourceTableId,
        type: FieldType.Attachment,
        deletedTime: null,
      },
      select: {
        id: true,
      },
    });
    const qb = this.knex.queryBuilder();

    const attachmentFieldIds = attachmentFieldRaws.map(({ id }) => id);

    const userId = this.cls.get('user.id');

    for (const attachmentFieldId of attachmentFieldIds) {
      const sql = this.dbProvider
        .duplicateAttachmentTableQuery(qb)
        .duplicateAttachmentTable(
          sourceTableId,
          targetTableId,
          attachmentFieldId,
          fieldIdMap[attachmentFieldId],
          userId
        )
        .toQuery();

      await prisma.$executeRawUnsafe(sql);
    }
  }

  // duplicate link junction table
  async duplicateLinkJunction(
    tableIdMap: Record<string, string>,
    fieldIdMap: Record<string, string>,
    allowCrossBase: boolean,
    routedDataPrisma: IDataPrismaExecutor,
    disconnectedLinkFieldIds?: string[]
  ) {
    const metaPrisma = this.prismaService.txClient();
    const dataPrisma = routedDataPrisma;
    const sourceLinkFieldRaws = await metaPrisma.field.findMany({
      where: {
        tableId: { in: Object.keys(tableIdMap) },
        type: FieldType.Link,
        deletedTime: null,
      },
    });

    const targetLinkFieldRaws = await metaPrisma.field.findMany({
      where: {
        tableId: { in: Object.values(tableIdMap) },
        type: FieldType.Link,
        deletedTime: null,
      },
    });

    const targetFields = targetLinkFieldRaws.map((f) => createFieldInstanceByRaw(f));
    const targetLinkFieldIds = new Set(targetFields.map((f) => f.id));
    const sourceFields = sourceLinkFieldRaws
      .filter(({ isLookup }) => !isLookup)
      .map((f) => createFieldInstanceByRaw(f))
      .filter((field) => {
        if (allowCrossBase) {
          return true;
        }
        // if not allow cross base, filter out it.
        return !(field.options as ILinkFieldOptions).baseId;
      })
      .filter((field) => {
        if (!disconnectedLinkFieldIds?.length) {
          return true;
        }
        return !disconnectedLinkFieldIds.includes(field.id);
      })
      // Drop source links whose target is no longer a Link in the new base —
      // e.g. cross-space links and excluded-table links that base-export
      // structurally degrades to SingleLineText. Without their target column,
      // there's no junction to copy.
      .filter((field) => targetLinkFieldIds.has(fieldIdMap[field.id]));

    const junctionDbTableNameMap = {} as Record<
      string,
      {
        sourceJunctionDbTableName: string;
        sourceSelfKeyName: string;
        sourceForeignKeyName: string;
        targetSelfKeyName: string;
        targetForeignKeyName: string;
        targetFkHostTableName: string;
      }
    >;

    for (const sourceField of sourceFields) {
      const { options: sourceOptions } = sourceField;
      const {
        fkHostTableName: sourceFkHostTableName,
        selfKeyName: sourceSelfKeyName,
        foreignKeyName: sourceForeignKeyName,
      } = sourceOptions as ILinkFieldOptions;
      const targetField = targetFields.find((f) => f.id === fieldIdMap[sourceField.id])!;
      const { options: targetOptions } = targetField;
      const {
        fkHostTableName: targetFkHostTableName,
        selfKeyName: targetSelfKeyName,
        foreignKeyName: targetForeignKeyName,
      } = targetOptions as ILinkFieldOptions;
      if (sourceFkHostTableName.includes('junction_')) {
        junctionDbTableNameMap[`${sourceFkHostTableName}:${targetFkHostTableName}`] = {
          sourceJunctionDbTableName: sourceFkHostTableName,
          sourceSelfKeyName,
          sourceForeignKeyName,
          targetSelfKeyName,
          targetForeignKeyName,
          targetFkHostTableName,
        };
      }
    }
    for (const targetJunctionInfo of Object.values(junctionDbTableNameMap)) {
      const {
        sourceJunctionDbTableName,
        sourceSelfKeyName,
        sourceForeignKeyName,
        targetSelfKeyName,
        targetForeignKeyName,
        targetFkHostTableName,
      } = targetJunctionInfo;
      const sql = this.dataKnex
        .raw(
          `INSERT INTO ?? ("${targetSelfKeyName}","${targetForeignKeyName}") SELECT "${sourceSelfKeyName}", "${sourceForeignKeyName}" FROM ??`,
          [targetFkHostTableName, sourceJunctionDbTableName]
        )
        .toQuery();

      await dataPrisma.$executeRawUnsafe(sql);
    }
  }
}
