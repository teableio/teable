import type { Readable } from 'stream';
import { BadGatewayException, Injectable, Logger } from '@nestjs/common';
import type { IFormulaFieldOptions, ILinkFieldOptions, ILookupOptionsRo } from '@teable/core';
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
  IFieldJson,
  IFieldWithTableIdJson,
} from '@teable/openapi';

import { Knex } from 'knex';
import { get, pick } from 'lodash';
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
import { createFieldInstanceByRaw } from '../field/model/factory';
import { FieldOpenApiService } from '../field/open-api/field-open-api.service';
import { dbType2knexFormat } from '../field/util';
import { TableService } from '../table/table.service';
import { ViewOpenApiService } from '../view/open-api/view-open-api.service';
import { BaseImportAttachmentsQueueProcessor } from './base-import-processor/base-import-attachments.processor';
import { BaseImportCsvQueueProcessor } from './base-import-processor/base-import-csv.processor';
import { DEFAULT_EXPRESSION } from './constant';
import { replaceStringByMap } from './utils';

@Injectable()
export class BaseImportService {
  private logger = new Logger(BaseImportService.name);

  constructor(
    private readonly prismaService: PrismaService,
    private readonly cls: ClsService<IClsStore>,
    private readonly tableService: TableService,
    private readonly fieldOpenApiService: FieldOpenApiService,
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

  async createBaseStructure(spaceId: string, structure: IBaseJson) {
    const { name, icon, tables, plugins } = structure;

    // create base
    const newBase = await this.createBase(spaceId, name, icon || undefined);

    // create table
    const { tableIdMap, fieldIdMap, viewIdMap, fkMap } = await this.createTables(
      newBase.id,
      tables
    );

    // create plugins
    await this.createPlugins(newBase.id, plugins, tableIdMap, fieldIdMap, viewIdMap);

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
    }

    const { fieldMap: fieldIdMap, fkMap } = await this.createFields(tables, tableIdMap);

    const viewIdMap = await this.createViews(tables, tableIdMap, fieldIdMap);

    await this.repairFieldOptions(tables, tableIdMap, fieldIdMap, viewIdMap);

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
      .sort((a, b) => a.createTime.localeCompare(b.createTime));

    const nonCommonFieldTypes = [FieldType.Link, FieldType.Rollup, FieldType.Formula];

    const commonFields = allFields.filter(
      ({ type, isLookup }) => !nonCommonFieldTypes.includes(type) && !isLookup
    );

    // the primary formula which rely on other fields
    const primaryFormulaFields = allFields.filter(
      ({ type, isLookup }) => type === FieldType.Formula && !isLookup
    );

    // link fields
    const linkFields = allFields.filter(
      ({ type, isLookup }) => type === FieldType.Link && !isLookup
    );

    // rest fields, like formula, rollup, lookup fields
    const dependencyFields = allFields.filter(
      ({ id }) =>
        ![...primaryFormulaFields, ...linkFields, ...commonFields].map(({ id }) => id).includes(id)
    );

    await this.createCommonFields(commonFields, fieldMap);

    await this.createTmpPrimaryFormulaFields(primaryFormulaFields, fieldMap);

    await this.repairPrimaryFormulaFields(primaryFormulaFields, fieldMap);

    await this.createLinkFields(linkFields, tableIdMap, fieldMap, fkMap);

    await this.createDependencyFields(dependencyFields, tableIdMap, fieldMap);

    await this.repairPrimaryFormulaFields(primaryFormulaFields, fieldMap);

    return { fieldMap, fkMap };
  }

  private async createTmpPrimaryFormulaFields(
    primaryFormulaFields: IFieldWithTableIdJson[],
    fieldMap: Record<string, string>
  ) {
    for (const field of primaryFormulaFields) {
      const {
        type,
        dbFieldName,
        name,
        options,
        id,
        notNull,
        unique,
        description,
        isPrimary,
        targetTableId,
        order,
        hasError,
      } = field;
      const newField = await this.fieldOpenApiService.createField(targetTableId, {
        type,
        dbFieldName,
        description,
        options: {
          ...options,
          expression: DEFAULT_EXPRESSION,
        },
        name,
      });
      await this.replenishmentConstraint(newField.id, targetTableId, order, {
        notNull,
        unique,
        dbFieldName,
        isPrimary,
      });
      fieldMap[id] = newField.id;

      if (hasError) {
        await this.prismaService.txClient().field.update({
          where: {
            id: newField.id,
          },
          data: {
            hasError,
          },
        });
      }
    }
  }

  private async repairPrimaryFormulaFields(
    primaryFormulaFields: IFieldWithTableIdJson[],
    fieldMap: Record<string, string>
  ) {
    for (const field of primaryFormulaFields) {
      const {
        id,
        options,
        dbFieldType,
        targetTableId,
        dbFieldName,
        cellValueType,
        isMultipleCellValue,
      } = field;
      const { dbTableName } = await this.prismaService.txClient().tableMeta.findUniqueOrThrow({
        where: {
          id: targetTableId,
        },
        select: {
          dbTableName: true,
        },
      });
      const newOptions = replaceStringByMap(options, { fieldMap });
      const { dbFieldType: currentDbFieldType } = await this.prismaService.txClient().field.update({
        where: {
          id: fieldMap[id],
        },
        data: {
          options: newOptions,
          cellValueType,
        },
      });
      if (currentDbFieldType !== dbFieldType) {
        const schemaType = dbType2knexFormat(this.knex, dbFieldType);
        const modifyColumnSql = this.dbProvider.modifyColumnSchema(
          dbTableName,
          dbFieldName,
          schemaType
        );

        for (const alterTableQuery of modifyColumnSql) {
          await this.prismaService.txClient().$executeRawUnsafe(alterTableQuery);
        }
        await this.prismaService.txClient().field.update({
          where: {
            id: fieldMap[id],
          },
          data: {
            cellValueType,
            dbFieldType,
            isMultipleCellValue,
          },
        });
      }
    }
  }

  private async createCommonFields(
    fields: IFieldWithTableIdJson[],
    fieldMap: Record<string, string>
  ) {
    for (const field of fields) {
      const {
        name,
        type,
        options,
        targetTableId,
        isPrimary,
        notNull,
        dbFieldName,
        description,
        unique,
      } = field;
      const newFieldVo = await this.fieldOpenApiService.createField(targetTableId, {
        name,
        type,
        options,
        dbFieldName,
        description,
      });
      await this.replenishmentConstraint(newFieldVo.id, targetTableId, field.order, {
        notNull,
        unique,
        dbFieldName: newFieldVo.dbFieldName,
        isPrimary,
      });
      fieldMap[field.id] = newFieldVo.id;
      await this.prismaService.txClient().field.update({
        where: {
          id: newFieldVo.id,
        },
        data: {
          order: field.order,
        },
      });
    }
  }

  private async createLinkFields(
    // filter lookup fields
    linkFields: IFieldWithTableIdJson[],
    tableIdMap: Record<string, string>,
    fieldMap: Record<string, string>,
    fkMap: Record<string, string>
  ) {
    const selfLinkFields = linkFields.filter(
      ({ options, sourceTableId }) =>
        (options as ILinkFieldOptions).foreignTableId === sourceTableId
    );

    // cross base link fields should convert to one-way link field
    // only for base-duplicate
    const crossBaseLinkFields = linkFields
      .filter(({ options }) => Boolean((options as ILinkFieldOptions)?.baseId))
      .map((f) => ({
        ...f,
        options: {
          ...f.options,
          isOneWay: true,
        },
      })) as IFieldWithTableIdJson[];

    // already converted to text field in export side, prevent unexpected error
    // if (crossBaseLinkFields.length > 0) {
    //   throw new BadRequestException('cross base link fields are not supported');
    // }

    // common cross table link fields
    const commonLinkFields = linkFields.filter(
      ({ id }) => ![...selfLinkFields, ...crossBaseLinkFields].map(({ id }) => id).includes(id)
    );

    await this.createSelfLinkFields(selfLinkFields, fieldMap, fkMap);

    // deal with cross base link fields
    await this.createCommonLinkFields(crossBaseLinkFields, tableIdMap, fieldMap, fkMap, true);

    await this.createCommonLinkFields(commonLinkFields, tableIdMap, fieldMap, fkMap);
  }

  private async createSelfLinkFields(
    fields: IFieldWithTableIdJson[],
    fieldMap: Record<string, string>,
    fkMap: Record<string, string>
  ) {
    const twoWaySelfLinkFields = fields.filter(
      ({ options }) => !(options as ILinkFieldOptions).isOneWay
    );

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

    const oneWaySelfLinkFields = fields.filter(
      ({ options }) => (options as ILinkFieldOptions).isOneWay
    );

    for (const field of oneWaySelfLinkFields) {
      const {
        name,
        targetTableId,
        type,
        options,
        description,
        notNull,
        unique,
        dbFieldName,
        isPrimary,
      } = field;
      const { relationship } = options as ILinkFieldOptions;
      const newFieldVo = await this.fieldOpenApiService.createField(targetTableId, {
        name,
        type,
        dbFieldName,
        description,
        options: {
          foreignTableId: targetTableId,
          relationship,
          isOneWay: true,
        },
      });
      await this.replenishmentConstraint(newFieldVo.id, targetTableId, field.order, {
        notNull,
        unique,
        dbFieldName,
        isPrimary,
      });
      fieldMap[field.id] = newFieldVo.id;
      if ((field.options as ILinkFieldOptions).selfKeyName.startsWith('__fk_')) {
        fkMap[(field.options as ILinkFieldOptions).selfKeyName] = (
          newFieldVo.options as ILinkFieldOptions
        ).selfKeyName;
      }
    }

    for (const field of mergedTwoWaySelfLinkFields) {
      const passiveIndex = field.findIndex(
        (f) => (f.options as ILinkFieldOptions).isOneWay === undefined
      )!;
      const driverIndex = passiveIndex === 0 ? 1 : 0;

      const groupField = field[passiveIndex];
      const {
        name,
        type,
        id,
        description,
        targetTableId,
        notNull,
        unique,
        dbFieldName,
        isPrimary,
        order,
      } = field[driverIndex];
      const options = field[driverIndex].options as ILinkFieldOptions;
      const newField = await this.fieldOpenApiService.createField(targetTableId, {
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
      await this.replenishmentConstraint(newField.id, targetTableId, order, {
        notNull,
        unique,
        dbFieldName,
        isPrimary,
      });
      fieldMap[id] = newField.id;
      if ((options as ILinkFieldOptions).selfKeyName.startsWith('__fk_')) {
        fkMap[(options as ILinkFieldOptions).selfKeyName] = (
          newField.options as ILinkFieldOptions
        ).selfKeyName;
      }
      fieldMap[groupField.id] = (newField.options as ILinkFieldOptions).symmetricFieldId!;

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
            id: fieldMap[groupField.id],
          },
          select: {
            dbFieldName: true,
          },
        });

      await this.prismaService.txClient().field.update({
        where: {
          id: fieldMap[groupField.id],
        },
        data: {
          dbFieldName: groupField.dbFieldName,
          name: groupField.name,
          description: groupField.description,
          order: groupField.order,
        },
      });

      if (genDbFieldName !== groupField.dbFieldName) {
        const alterTableSql = this.dbProvider.renameColumn(
          targetDbTableName,
          genDbFieldName,
          groupField.dbFieldName
        );

        for (const sql of alterTableSql) {
          await this.prismaService.txClient().$executeRawUnsafe(sql);
        }
      }
    }
  }

  private async createCommonLinkFields(
    fields: IFieldWithTableIdJson[],
    tableIdMap: Record<string, string>,
    fieldMap: Record<string, string>,
    fkMap: Record<string, string>,
    allowCrossBase: boolean = false
  ) {
    const oneWayFields = fields.filter(({ options }) => (options as ILinkFieldOptions).isOneWay);
    const twoWayFields = fields.filter(({ options }) => !(options as ILinkFieldOptions).isOneWay);

    for (const field of oneWayFields) {
      const {
        name,
        type,
        options,
        targetTableId,
        description,
        notNull,
        unique,
        dbFieldName,
        isPrimary,
      } = field;
      const { foreignTableId, relationship } = options as ILinkFieldOptions;
      const newFieldVo = await this.fieldOpenApiService.createField(targetTableId, {
        name,
        type,
        description,
        options: {
          foreignTableId: allowCrossBase ? foreignTableId : tableIdMap[foreignTableId],
          relationship,
          isOneWay: true,
        },
      });
      fieldMap[field.id] = newFieldVo.id;
      if ((field.options as ILinkFieldOptions).selfKeyName.startsWith('__fk_')) {
        fkMap[(field.options as ILinkFieldOptions).selfKeyName] = (
          newFieldVo.options as ILinkFieldOptions
        ).selfKeyName;
      }
      await this.replenishmentConstraint(newFieldVo.id, targetTableId, field.order, {
        notNull,
        unique,
        dbFieldName,
        isPrimary,
      });
    }

    const groupedTwoWayFields = [] as [IFieldWithTableIdJson, IFieldWithTableIdJson][];

    twoWayFields.forEach((f) => {
      // two-way link field should only create one of it
      if (!groupedTwoWayFields.some((group) => group.some(({ id: fId }) => fId === f.id))) {
        const symmetricField = twoWayFields.find(
          ({ options }) => get(options, 'symmetricFieldId') === f.id
        );
        symmetricField && groupedTwoWayFields.push([f, symmetricField]);
      }
    });

    for (const field of groupedTwoWayFields) {
      // fk would like in this table
      const passiveIndex = field.findIndex(
        (f) => (f.options as ILinkFieldOptions).isOneWay === undefined
      )!;
      const driverIndex = passiveIndex === 0 ? 1 : 0;
      const {
        name,
        type,
        options,
        targetTableId,
        description,
        id: fieldId,
        notNull,
        unique,
        dbFieldName,
        isPrimary,
        order,
      } = field[passiveIndex];
      const symmetricField = field[driverIndex];
      const { foreignTableId, relationship } = options as ILinkFieldOptions;
      const newFieldVo = await this.fieldOpenApiService.createField(targetTableId, {
        name,
        type,
        description,
        dbFieldName,
        options: {
          foreignTableId: tableIdMap[foreignTableId],
          relationship,
          isOneWay: false,
        },
      });
      fieldMap[fieldId] = newFieldVo.id;
      fieldMap[symmetricField.id] = (newFieldVo.options as ILinkFieldOptions).symmetricFieldId!;
      if ((field[passiveIndex].options as ILinkFieldOptions).selfKeyName.startsWith('__fk_')) {
        fkMap[(field[passiveIndex].options as ILinkFieldOptions).selfKeyName] = (
          newFieldVo.options as ILinkFieldOptions
        ).selfKeyName;
      }
      await this.replenishmentConstraint(newFieldVo.id, targetTableId, order, {
        notNull,
        unique,
        dbFieldName,
        isPrimary,
      });
      await this.repairSymmetricField(
        symmetricField,
        (newFieldVo.options as ILinkFieldOptions).foreignTableId,
        (newFieldVo.options as ILinkFieldOptions).symmetricFieldId!
      );
    }
  }

  // create two-way link, the symmetricFieldId created automatically, and need to update config
  private async repairSymmetricField(
    symmetricField: IFieldWithTableIdJson,
    targetTableId: string,
    newFieldId: string
  ) {
    const { notNull, unique, dbFieldName, isPrimary, description, name, order } = symmetricField;
    await this.replenishmentConstraint(newFieldId, targetTableId, order, {
      notNull,
      unique,
      dbFieldName,
      isPrimary,
    });
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
          id: newFieldId,
        },
        select: {
          dbFieldName: true,
        },
      });

    await this.prismaService.txClient().field.update({
      where: {
        id: newFieldId,
      },
      data: {
        dbFieldName,
        name,
        description,
      },
    });

    if (genDbFieldName !== dbFieldName) {
      const alterTableSql = this.dbProvider.renameColumn(
        targetDbTableName,
        genDbFieldName,
        dbFieldName
      );

      for (const sql of alterTableSql) {
        await this.prismaService.txClient().$executeRawUnsafe(sql);
      }
    }
  }

  private async repairFieldOptions(
    tables: IBaseJson['tables'],
    tableIdMap: Record<string, string>,
    fieldIdMap: Record<string, string>,
    viewIdMap: Record<string, string>
  ) {
    const prisma = this.prismaService.txClient();

    const sourceFields = tables.map(({ fields }) => fields).flat();

    const targetFieldRaws = await prisma.field.findMany({
      where: {
        id: { in: Object.values(fieldIdMap) },
      },
    });

    const targetFields = targetFieldRaws.map((fieldRaw) => createFieldInstanceByRaw(fieldRaw));

    const linkFields = targetFields.filter(
      (field) => field.type === FieldType.Link && !field.isLookup
    );
    const lookupFields = targetFields.filter((field) => field.isLookup);
    const rollupFields = targetFields.filter((field) => field.type === FieldType.Rollup);

    for (const field of linkFields) {
      const { options, id } = field;
      const sourceField = sourceFields.find((f) => fieldIdMap[f.id] === id);
      const { filter, filterByViewId, visibleFieldIds } = sourceField?.options as ILinkFieldOptions;
      const moreConfigStr = {
        filter,
        filterByViewId,
        visibleFieldIds,
      };

      const newMoreConfigStr = replaceStringByMap(moreConfigStr, {
        tableIdMap,
        fieldIdMap,
        viewIdMap,
      });

      const newOptions = {
        ...options,
        ...JSON.parse(newMoreConfigStr || '{}'),
      };

      await prisma.field.update({
        where: {
          id,
        },
        data: {
          options: JSON.stringify(newOptions),
        },
      });
    }
    for (const field of [...lookupFields, ...rollupFields]) {
      const { lookupOptions, id } = field;
      const sourceField = sourceFields.find((f) => fieldIdMap[f.id] === id);
      const { filter } = sourceField?.lookupOptions as ILookupOptionsRo;
      const moreConfigStr = {
        filter,
      };

      const newMoreConfigStr = replaceStringByMap(moreConfigStr, {
        tableIdMap,
        fieldIdMap,
        viewIdMap,
      });

      const newLookupOptions = {
        ...lookupOptions,
        ...JSON.parse(newMoreConfigStr || '{}'),
      };

      await prisma.field.update({
        where: {
          id,
        },
        data: {
          lookupOptions: JSON.stringify(newLookupOptions),
        },
      });
    }
  }

  /* eslint-disable sonarjs/cognitive-complexity */
  private async createDependencyFields(
    dependFields: IFieldWithTableIdJson[],
    tableIdMap: Record<string, string>,
    fieldMap: Record<string, string>
  ): Promise<void> {
    if (!dependFields.length) return;

    const maxCount = dependFields.length * 10;

    const checkedField = [] as IFieldJson[];

    const countMap = {} as Record<string, number>;

    while (dependFields.length) {
      const curField = dependFields.shift();
      if (!curField) continue;

      const { sourceTableId, targetTableId } = curField;

      const isChecked = checkedField.some((f) => f.id === curField.id);
      // InDegree all ready
      const isInDegreeReady = this.isInDegreeReady(curField, fieldMap);

      if (isInDegreeReady) {
        await this.duplicateSingleDependField(
          sourceTableId,
          targetTableId,
          curField,
          tableIdMap,
          fieldMap
        );
        continue;
      }

      if (isChecked) {
        if (curField.hasError) {
          await this.duplicateSingleDependField(
            sourceTableId,
            targetTableId,
            curField,
            tableIdMap,
            fieldMap,
            true
          );
        } else if (!countMap[curField.id] || countMap[curField.id] < maxCount) {
          dependFields.push(curField);
          checkedField.push(curField);
          countMap[curField.id] = (countMap[curField.id] || 0) + 1;
        } else {
          throw new BadGatewayException('Create circular field');
        }
      } else {
        dependFields.push(curField);
        checkedField.push(curField);
      }
    }
  }

  private async duplicateSingleDependField(
    sourceTableId: string,
    targetTableId: string,
    field: IFieldWithTableIdJson,
    tableIdMap: Record<string, string>,
    sourceToTargetFieldMap: Record<string, string>,
    hasError = false
  ) {
    if (field.type === FieldType.Formula && !field.isLookup) {
      await this.duplicateFormulaField(targetTableId, field, sourceToTargetFieldMap, hasError);
    } else if (field.isLookup) {
      await this.duplicateLookupField(
        sourceTableId,
        targetTableId,
        field,
        tableIdMap,
        sourceToTargetFieldMap
      );
    } else if (field.type === FieldType.Rollup) {
      await this.duplicateRollupField(
        sourceTableId,
        targetTableId,
        field,
        tableIdMap,
        sourceToTargetFieldMap
      );
    }
  }

  private async duplicateLookupField(
    sourceTableId: string,
    targetTableId: string,
    field: IFieldWithTableIdJson,
    tableIdMap: Record<string, string>,
    sourceToTargetFieldMap: Record<string, string>
  ) {
    const {
      dbFieldName,
      name,
      lookupOptions,
      id,
      hasError,
      options,
      notNull,
      unique,
      description,
      isPrimary,
      type: lookupFieldType,
    } = field;
    const { foreignTableId, linkFieldId, lookupFieldId } = lookupOptions as ILookupOptionsRo;
    const isSelfLink = foreignTableId === sourceTableId;

    const mockFieldId = Object.values(sourceToTargetFieldMap)[0];
    const { type: mockType } = await this.prismaService.txClient().field.findUniqueOrThrow({
      where: {
        id: mockFieldId,
        deletedTime: null,
      },
      select: {
        type: true,
      },
    });
    const newField = await this.fieldOpenApiService.createField(targetTableId, {
      type: (hasError ? mockType : lookupFieldType) as FieldType,
      dbFieldName,
      description,
      isLookup: true,
      lookupOptions: {
        // foreignTableId may are cross base table id, so we need to use tableIdMap to get the target table id
        foreignTableId: (isSelfLink ? targetTableId : tableIdMap[foreignTableId]) || foreignTableId,
        linkFieldId: sourceToTargetFieldMap[linkFieldId],
        lookupFieldId: isSelfLink
          ? hasError
            ? mockFieldId
            : sourceToTargetFieldMap[lookupFieldId]
          : hasError
            ? mockFieldId
            : sourceToTargetFieldMap[lookupFieldId] || lookupFieldId,
      },
      name,
    });
    await this.replenishmentConstraint(newField.id, targetTableId, field.order, {
      notNull,
      unique,
      dbFieldName,
      isPrimary,
    });
    sourceToTargetFieldMap[id] = newField.id;
    if (hasError) {
      await this.prismaService.txClient().field.update({
        where: {
          id: newField.id,
        },
        data: {
          hasError,
          type: lookupFieldType,
          lookupOptions: JSON.stringify({
            ...newField.lookupOptions,
            lookupFieldId: lookupFieldId,
          }),
          options: JSON.stringify(options),
        },
      });
    }
  }

  private async duplicateRollupField(
    sourceTableId: string,
    targetTableId: string,
    fieldInstance: IFieldWithTableIdJson,
    tableIdMap: Record<string, string>,
    sourceToTargetFieldMap: Record<string, string>
  ) {
    const {
      dbFieldName,
      name,
      lookupOptions,
      id,
      hasError,
      options,
      notNull,
      unique,
      description,
      isPrimary,
      type: lookupFieldType,
    } = fieldInstance;
    const { foreignTableId, linkFieldId, lookupFieldId } = lookupOptions as ILookupOptionsRo;
    const isSelfLink = foreignTableId === sourceTableId;

    const mockFieldId = Object.values(sourceToTargetFieldMap)[0];
    const newField = await this.fieldOpenApiService.createField(targetTableId, {
      type: FieldType.Rollup,
      dbFieldName,
      description,
      lookupOptions: {
        // foreignTableId may are cross base table id, so we need to use tableIdMap to get the target table id
        foreignTableId: (isSelfLink ? targetTableId : tableIdMap[foreignTableId]) || foreignTableId,
        linkFieldId: sourceToTargetFieldMap[linkFieldId],
        lookupFieldId: isSelfLink
          ? hasError
            ? mockFieldId
            : sourceToTargetFieldMap[lookupFieldId]
          : hasError
            ? mockFieldId
            : sourceToTargetFieldMap[lookupFieldId] || lookupFieldId,
      },
      options,
      name,
    });
    await this.replenishmentConstraint(newField.id, targetTableId, fieldInstance.order, {
      notNull,
      unique,
      dbFieldName,
      isPrimary,
    });
    sourceToTargetFieldMap[id] = newField.id;
    if (hasError) {
      await this.prismaService.txClient().field.update({
        where: {
          id: newField.id,
        },
        data: {
          hasError,
          type: lookupFieldType,
          lookupOptions: JSON.stringify({
            ...newField.lookupOptions,
            lookupFieldId: lookupFieldId,
          }),
          options: JSON.stringify(options),
        },
      });
    }
  }

  private async duplicateFormulaField(
    targetTableId: string,
    fieldInstance: IFieldWithTableIdJson,
    sourceToTargetFieldMap: Record<string, string>,
    hasError: boolean = false
  ) {
    const {
      type,
      dbFieldName,
      name,
      options,
      id,
      notNull,
      unique,
      description,
      isPrimary,
      dbFieldType,
      cellValueType,
      isMultipleCellValue,
    } = fieldInstance;
    const { expression } = options as IFormulaFieldOptions;
    const newExpression = replaceStringByMap(expression, { sourceToTargetFieldMap });
    const newField = await this.fieldOpenApiService.createField(targetTableId, {
      type,
      dbFieldName: dbFieldName,
      description,
      options: {
        ...options,
        expression: hasError
          ? DEFAULT_EXPRESSION
          : newExpression
            ? JSON.parse(newExpression)
            : undefined,
      },
      name,
    });
    await this.replenishmentConstraint(newField.id, targetTableId, fieldInstance.order, {
      notNull,
      unique,
      dbFieldName,
      isPrimary,
    });
    sourceToTargetFieldMap[id] = newField.id;

    if (hasError) {
      await this.prismaService.txClient().field.update({
        where: {
          id: newField.id,
        },
        data: {
          hasError,
          options: JSON.stringify({
            ...options,
            expression: newExpression ? JSON.parse(newExpression) : undefined,
          }),
        },
      });
    }

    if (dbFieldType !== newField.dbFieldType) {
      const { dbTableName } = await this.prismaService.txClient().tableMeta.findUniqueOrThrow({
        where: {
          id: targetTableId,
        },
        select: {
          dbTableName: true,
        },
      });
      const schemaType = dbType2knexFormat(this.knex, dbFieldType);
      const modifyColumnSql = this.dbProvider.modifyColumnSchema(
        dbTableName,
        dbFieldName,
        schemaType
      );

      for (const alterTableQuery of modifyColumnSql) {
        await this.prismaService.txClient().$executeRawUnsafe(alterTableQuery);
      }

      await this.prismaService.txClient().field.update({
        where: {
          id: newField.id,
        },
        data: {
          dbFieldType,
          cellValueType,
          isMultipleCellValue,
        },
      });
    }
  }

  // field could not set constraint when create
  private async replenishmentConstraint(
    fId: string,
    targetTableId: string,
    order: number,
    {
      notNull,
      unique,
      dbFieldName,
      isPrimary,
    }: { notNull?: boolean; unique?: boolean; dbFieldName: string; isPrimary?: boolean }
  ) {
    await this.prismaService.txClient().field.update({
      where: {
        id: fId,
      },
      data: {
        order,
      },
    });
    if (!notNull && !unique && !isPrimary) {
      return;
    }

    const { dbTableName } = await this.prismaService.txClient().tableMeta.findUniqueOrThrow({
      where: {
        id: targetTableId,
        deletedTime: null,
      },
      select: {
        dbTableName: true,
      },
    });

    await this.prismaService.txClient().field.update({
      where: {
        id: fId,
      },
      data: {
        notNull: notNull ?? null,
        unique: unique ?? null,
        isPrimary: isPrimary ?? null,
      },
    });

    if (notNull || unique) {
      const fieldValidationQuery = this.knex.schema
        .alterTable(dbTableName, (table) => {
          if (unique) table.dropUnique([dbFieldName]);
          if (notNull) table.setNullable(dbFieldName);
        })
        .toQuery();

      await this.prismaService.txClient().$executeRawUnsafe(fieldValidationQuery);
    }
  }

  private isInDegreeReady(field: IFieldWithTableIdJson, fieldMap: Record<string, string>) {
    const { isLookup, type } = field;
    if (type === FieldType.Formula && !isLookup) {
      const formulaOptions = field.options as IFormulaFieldOptions;
      const referencedFields = this.extractFieldIds(formulaOptions.expression);
      const keys = Object.keys(fieldMap);
      return referencedFields.every((field) => keys.includes(field));
    }

    if (isLookup || type === FieldType.Rollup) {
      const { lookupOptions } = field;
      const { linkFieldId, lookupFieldId } = lookupOptions as ILookupOptionsRo;
      // const isSelfLink = foreignTableId === sourceTableId;
      return Boolean(fieldMap[lookupFieldId] && fieldMap[linkFieldId]);
      // return isSelfLink ? Boolean(fieldMap[lookupFieldId] && fieldMap[linkFieldId]) : true;
    }

    return false;
  }

  private extractFieldIds(expression: string): string[] {
    const matches = expression.match(/\{fld[a-zA-Z0-9]+\}/g);

    if (!matches) {
      return [];
    }
    return matches.map((match) => match.slice(1, -1));
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

  private async createDashboard(
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

  private async createPanel(
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
