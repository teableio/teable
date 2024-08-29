import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type {
  IFieldVo,
  IGetFieldsQuery,
  ISnapshotBase,
  ISetFieldPropertyOpContext,
  DbFieldType,
  ILookupOptionsVo,
  IOtOperation,
  ViewType,
  IConvertFieldRo,
  FieldType,
} from '@teable/core';
import {
  FieldOpBuilder,
  HttpErrorCode,
  IdPrefix,
  OpName,
  checkFieldUniqueValidationEnabled,
  checkFieldValidationEnabled,
} from '@teable/core';
import type { Field as RawField, Prisma } from '@teable/db-main-prisma';
import { PrismaService } from '@teable/db-main-prisma';
import { instanceToPlain } from 'class-transformer';
import { Knex } from 'knex';
import { keyBy, sortBy } from 'lodash';
import { InjectModel } from 'nest-knexjs';
import { ClsService } from 'nestjs-cls';
import { CustomHttpException } from '../../custom.exception';
import { InjectDbProvider } from '../../db-provider/db.provider';
import { IDbProvider } from '../../db-provider/db.provider.interface';
import type { IReadonlyAdapterService } from '../../share-db/interface';
import { RawOpType } from '../../share-db/interface';
import type { IClsStore } from '../../types/cls';
import { isNotHiddenField } from '../../utils/is-not-hidden-field';
import { convertNameToValidCharacter } from '../../utils/name-conversion';
import { BatchService } from '../calculation/batch.service';
import type { IFieldInstance } from './model/factory';
import { createFieldInstanceByVo, rawField2FieldObj } from './model/factory';
import { dbType2knexFormat } from './util';

type IOpContext = ISetFieldPropertyOpContext;

@Injectable()
export class FieldService implements IReadonlyAdapterService {
  constructor(
    private readonly batchService: BatchService,
    private readonly prismaService: PrismaService,
    private readonly cls: ClsService<IClsStore>,
    @InjectDbProvider() private readonly dbProvider: IDbProvider,
    @InjectModel('CUSTOM_KNEX') private readonly knex: Knex
  ) {}

  async generateDbFieldName(tableId: string, name: string): Promise<string> {
    let dbFieldName = convertNameToValidCharacter(name, 40);

    const query = this.dbProvider.columnInfo(await this.getDbTableName(tableId));
    const columns = await this.prismaService.txClient().$queryRawUnsafe<{ name: string }[]>(query);
    // fallback logic
    if (columns.some((column) => column.name === dbFieldName)) {
      dbFieldName += new Date().getTime();
    }
    return dbFieldName;
  }

  private async dbCreateField(tableId: string, fieldInstance: IFieldInstance) {
    const userId = this.cls.get('user.id');
    const {
      id,
      name,
      dbFieldName,
      description,
      type,
      options,
      lookupOptions,
      notNull,
      unique,
      isPrimary,
      isComputed,
      hasError,
      dbFieldType,
      cellValueType,
      isMultipleCellValue,
      isLookup,
    } = fieldInstance;

    const agg = await this.prismaService.txClient().field.aggregate({
      where: { tableId, deletedTime: null },
      _max: {
        order: true,
      },
    });
    const order = agg._max.order == null ? 0 : agg._max.order + 1;
    const data: Prisma.FieldCreateInput = {
      id,
      table: {
        connect: {
          id: tableId,
        },
      },
      name,
      description,
      type,
      options: JSON.stringify(options),
      notNull,
      unique,
      isPrimary,
      order,
      version: 1,
      isComputed,
      isLookup,
      hasError,
      // add lookupLinkedFieldId for indexing
      lookupLinkedFieldId: lookupOptions?.linkFieldId,
      lookupOptions: lookupOptions && JSON.stringify(lookupOptions),
      dbFieldName,
      dbFieldType,
      cellValueType,
      isMultipleCellValue,
      createdBy: userId,
    };

    return this.prismaService.txClient().field.upsert({
      where: { id: data.id },
      create: data,
      update: { ...data, deletedTime: null, version: undefined },
    });
  }

  async dbCreateMultipleField(tableId: string, fieldInstances: IFieldInstance[]) {
    const multiFieldData: RawField[] = [];

    for (let i = 0; i < fieldInstances.length; i++) {
      const fieldInstance = fieldInstances[i];
      const fieldData = await this.dbCreateField(tableId, fieldInstance);

      multiFieldData.push(fieldData);
    }
    return multiFieldData;
  }

  private async alterTableAddField(dbTableName: string, fieldInstances: IFieldInstance[]) {
    for (let i = 0; i < fieldInstances.length; i++) {
      const { dbFieldType, dbFieldName, type, isLookup, unique, notNull } = fieldInstances[i];

      const alterTableQuery = this.knex.schema
        .alterTable(dbTableName, (table) => {
          const typeKey = dbType2knexFormat(this.knex, dbFieldType);
          table[typeKey](dbFieldName);
        })
        .toQuery();
      await this.prismaService.txClient().$executeRawUnsafe(alterTableQuery);

      if (unique) {
        if (!checkFieldUniqueValidationEnabled(type, isLookup)) {
          throw new BadRequestException(
            `Field type "${type}" does not support field value unique validation`
          );
        }

        const fieldValidationQuery = this.knex.schema
          .alterTable(dbTableName, (table) => {
            table.unique(dbFieldName);
          })
          .toQuery();
        await this.prismaService.txClient().$executeRawUnsafe(fieldValidationQuery);
      }

      if (notNull) {
        throw new BadRequestException(
          `Field type "${type}" does not support field validation when creating a new field`
        );
      }
    }
  }

  async alterTableDeleteField(dbTableName: string, dbFieldNames: string[]) {
    for (const dbFieldName of dbFieldNames) {
      const alterTableSql = this.dbProvider.dropColumn(dbTableName, dbFieldName);

      for (const alterTableQuery of alterTableSql) {
        await this.prismaService.txClient().$executeRawUnsafe(alterTableQuery);
      }
    }
  }

  private async alterTableModifyFieldName(fieldId: string, newDbFieldName: string) {
    const { dbFieldName, table } = await this.prismaService.txClient().field.findFirstOrThrow({
      where: { id: fieldId, deletedTime: null },
      select: { dbFieldName: true, table: { select: { id: true, dbTableName: true } } },
    });

    const existingField = await this.prismaService.txClient().field.findFirst({
      where: { tableId: table.id, dbFieldName: newDbFieldName, deletedTime: null },
      select: { id: true },
    });

    if (existingField) {
      throw new BadRequestException(`Db Field name ${newDbFieldName} already exists in this table`);
    }

    const alterTableSql = this.dbProvider.renameColumn(
      table.dbTableName,
      dbFieldName,
      newDbFieldName
    );

    for (const alterTableQuery of alterTableSql) {
      await this.prismaService.txClient().$executeRawUnsafe(alterTableQuery);
    }
  }

  private async alterTableModifyFieldType(fieldId: string, newDbFieldType: DbFieldType) {
    const { dbFieldName, table } = await this.prismaService.txClient().field.findFirstOrThrow({
      where: { id: fieldId, deletedTime: null },
      select: { dbFieldName: true, table: { select: { dbTableName: true } } },
    });

    const dbTableName = table.dbTableName;
    const schemaType = dbType2knexFormat(this.knex, newDbFieldType);

    const resetFieldQuery = this.knex(dbTableName)
      .update({ [dbFieldName]: null })
      .toQuery();
    await this.prismaService.txClient().$executeRawUnsafe(resetFieldQuery);

    const modifyColumnSql = this.dbProvider.modifyColumnSchema(
      dbTableName,
      dbFieldName,
      schemaType
    );

    for (const alterTableQuery of modifyColumnSql) {
      await this.prismaService.txClient().$executeRawUnsafe(alterTableQuery);
    }
  }

  private async alterTableModifyFieldValidation(
    fieldId: string,
    newValidationRules: Pick<IConvertFieldRo, 'unique' | 'notNull'>
  ) {
    const { unique, notNull } = newValidationRules;
    const { dbFieldName, table, type, isLookup } = await this.prismaService
      .txClient()
      .field.findFirstOrThrow({
        where: { id: fieldId, deletedTime: null },
        select: {
          dbFieldName: true,
          type: true,
          isLookup: true,
          table: { select: { dbTableName: true } },
        },
      });

    if (!checkFieldValidationEnabled(type as FieldType, isLookup)) {
      throw new BadRequestException(`Field type "${type}" does not support field validation`);
    }

    const dbTableName = table.dbTableName;

    const fieldValidationQuery = this.knex.schema
      .alterTable(dbTableName, (table) => {
        if (unique != null) {
          unique ? table.unique(dbFieldName) : table.dropUnique([dbFieldName]);
        }

        if (notNull != null) {
          notNull ? table.dropNullable(dbFieldName) : table.setNullable(dbFieldName);
        }
      })
      .toQuery();
    await this.prismaService.txClient().$executeRawUnsafe(fieldValidationQuery);
  }

  async getField(tableId: string, fieldId: string): Promise<IFieldVo> {
    const field = await this.prismaService.txClient().field.findFirst({
      where: { id: fieldId, tableId, deletedTime: null },
    });
    if (!field) {
      throw new NotFoundException(`field ${fieldId} in table ${tableId} not found`);
    }
    return rawField2FieldObj(field);
  }

  async getFieldsByQuery(tableId: string, query?: IGetFieldsQuery): Promise<IFieldVo[]> {
    const fieldsPlain = await this.prismaService.txClient().field.findMany({
      where: { tableId, deletedTime: null },
      orderBy: [
        {
          isPrimary: {
            sort: 'asc',
            nulls: 'last',
          },
        },
        {
          order: 'asc',
        },
        {
          createdTime: 'asc',
        },
      ],
    });

    let result = fieldsPlain.map(rawField2FieldObj);

    /**
     * filter by query
     * filterHidden depends on viewId so only judge viewId
     */
    if (query?.viewId) {
      const { viewId } = query;
      const curView = await this.prismaService.txClient().view.findFirst({
        where: { id: viewId, deletedTime: null },
        select: { id: true, type: true, options: true, columnMeta: true },
      });
      if (!curView) {
        throw new CustomHttpException('view is not found', HttpErrorCode.VIEW_NOT_FOUND);
      }
      const view = {
        id: viewId,
        type: curView.type as ViewType,
        options: curView.options ? JSON.parse(curView.options) : curView.options,
        columnMeta: JSON.parse(curView.columnMeta),
      };
      if (query?.filterHidden) {
        result = result.filter((field) => isNotHiddenField(field.id, view));
      }
      result = sortBy(result, (field) => {
        return view?.columnMeta[field.id].order;
      });
    }

    if (query?.excludeFieldIds) {
      const ids = query?.excludeFieldIds;
      result = result.filter((field) => !ids.includes(field.id));
    }

    return result;
  }

  async getFieldInstances(tableId: string, query: IGetFieldsQuery): Promise<IFieldInstance[]> {
    const fields = await this.getFieldsByQuery(tableId, query);
    return fields.map((field) => createFieldInstanceByVo(field));
  }

  async getDbTableName(tableId: string) {
    const tableMeta = await this.prismaService.txClient().tableMeta.findUniqueOrThrow({
      where: { id: tableId },
      select: { dbTableName: true },
    });
    return tableMeta.dbTableName;
  }

  async resolvePending(tableId: string, fieldIds: string[]) {
    await this.batchUpdateFields(
      tableId,
      fieldIds.map((fieldId) => ({
        fieldId,
        ops: [
          FieldOpBuilder.editor.setFieldProperty.build({
            key: 'isPending',
            newValue: null,
            oldValue: true,
          }),
        ],
      }))
    );
  }

  async markError(tableId: string, fieldIds: string[], hasError: boolean) {
    await this.batchUpdateFields(
      tableId,
      fieldIds.map((fieldId) => ({
        fieldId,
        ops: [
          FieldOpBuilder.editor.setFieldProperty.build({
            key: 'hasError',
            newValue: hasError ? true : null,
            oldValue: hasError ? null : true,
          }),
        ],
      }))
    );
  }

  async batchUpdateFields(tableId: string, opData: { fieldId: string; ops: IOtOperation[] }[]) {
    if (!opData.length) return;

    const fieldRaw = await this.prismaService.txClient().field.findMany({
      where: { tableId, id: { in: opData.map((data) => data.fieldId) }, deletedTime: null },
      select: { id: true, version: true },
    });

    const fieldMap = keyBy(fieldRaw, 'id');

    // console.log('opData', JSON.stringify(opData, null, 2));
    for (const { fieldId, ops } of opData) {
      const opContext = ops.map((op) => {
        const ctx = FieldOpBuilder.detect(op);
        if (!ctx) {
          throw new Error('unknown field editing op');
        }
        return ctx as IOpContext;
      });

      await this.update(fieldMap[fieldId].version + 1, tableId, fieldId, opContext);
    }

    const dataList = opData.map((data) => ({
      docId: data.fieldId,
      version: fieldMap[data.fieldId].version,
      data: data.ops,
    }));

    await this.batchService.saveRawOps(tableId, RawOpType.Edit, IdPrefix.Field, dataList);
  }

  async batchDeleteFields(tableId: string, fieldIds: string[]) {
    if (!fieldIds.length) return;

    const fieldRaw = await this.prismaService.txClient().field.findMany({
      where: { tableId, id: { in: fieldIds }, deletedTime: null },
      select: { id: true, version: true },
    });

    if (fieldRaw.length !== fieldIds.length) {
      throw new BadRequestException('delete field not found');
    }

    const fieldRawMap = keyBy(fieldRaw, 'id');

    const dataList = fieldIds.map((fieldId) => ({
      docId: fieldId,
      version: fieldRawMap[fieldId].version,
    }));

    await this.batchService.saveRawOps(tableId, RawOpType.Del, IdPrefix.Field, dataList);

    await this.deleteMany(
      tableId,
      dataList.map((d) => ({ ...d, version: d.version + 1 }))
    );
  }

  async batchCreateFields(tableId: string, dbTableName: string, fields: IFieldInstance[]) {
    if (!fields.length) return;

    const dataList = fields.map((field) => {
      const snapshot = instanceToPlain(field, { excludePrefixes: ['_'] }) as IFieldVo;
      return {
        docId: field.id,
        version: 0,
        data: snapshot,
      };
    });

    // 1. save field meta in db
    await this.dbCreateMultipleField(tableId, fields);

    // 2. alter table with real field in visual table
    await this.alterTableAddField(dbTableName, fields);

    await this.batchService.saveRawOps(tableId, RawOpType.Create, IdPrefix.Field, dataList);
  }

  async create(tableId: string, snapshot: IFieldVo) {
    const fieldInstance = createFieldInstanceByVo(snapshot);
    const dbTableName = await this.getDbTableName(tableId);

    // 1. save field meta in db
    await this.dbCreateMultipleField(tableId, [fieldInstance]);

    // 2. alter table with real field in visual table
    await this.alterTableAddField(dbTableName, [fieldInstance]);
  }

  private async deleteMany(tableId: string, fieldData: { docId: string; version: number }[]) {
    const userId = this.cls.get('user.id');

    for (const data of fieldData) {
      const { docId: id, version } = data;
      await this.prismaService.txClient().field.update({
        where: { id: id },
        data: { deletedTime: new Date(), lastModifiedBy: userId, version },
      });
    }
    const dbTableName = await this.getDbTableName(tableId);
    const fieldIds = fieldData.map((data) => data.docId);
    const fieldsRaw = await this.prismaService.txClient().field.findMany({
      where: { id: { in: fieldIds } },
      select: { dbFieldName: true },
    });
    await this.alterTableDeleteField(
      dbTableName,
      fieldsRaw.map((field) => field.dbFieldName)
    );
  }

  async del(version: number, tableId: string, fieldId: string) {
    await this.deleteMany(tableId, [{ docId: fieldId, version }]);
  }

  private async handleFieldProperty(fieldId: string, opContext: IOpContext) {
    const { key, newValue } = opContext as ISetFieldPropertyOpContext;

    if (key === 'options') {
      if (!newValue) {
        throw new Error('field options is required');
      }
      return { options: JSON.stringify(newValue) };
    }

    if (key === 'lookupOptions') {
      return {
        lookupOptions: newValue ? JSON.stringify(newValue) : null,
        // update lookupLinkedFieldId for indexing
        lookupLinkedFieldId: (newValue as ILookupOptionsVo | null)?.linkFieldId || null,
      };
    }

    if (key === 'dbFieldType') {
      await this.alterTableModifyFieldType(fieldId, newValue as DbFieldType);
    }

    if (key === 'dbFieldName') {
      await this.alterTableModifyFieldName(fieldId, newValue as string);
    }

    if (key === 'unique' || key === 'notNull') {
      await this.alterTableModifyFieldValidation(fieldId, { [key]: newValue });
    }

    return { [key]: newValue ?? null };
  }

  private async updateStrategies(fieldId: string, opContext: IOpContext) {
    const opHandlers = {
      [OpName.SetFieldProperty]: this.handleFieldProperty.bind(this),
    };

    const handler = opHandlers[opContext.name];

    if (!handler) {
      throw new Error(`Unknown context ${opContext.name} for field update`);
    }

    return handler.constructor.name === 'AsyncFunction'
      ? await handler(fieldId, opContext)
      : handler(fieldId, opContext);
  }

  async update(version: number, tableId: string, fieldId: string, opContexts: IOpContext[]) {
    const userId = this.cls.get('user.id');
    const result: Prisma.FieldUpdateInput = { version, lastModifiedBy: userId };
    for (const opContext of opContexts) {
      const updatedResult = await this.updateStrategies(fieldId, opContext);
      Object.assign(result, updatedResult);
    }

    await this.prismaService.txClient().field.update({
      where: { id: fieldId, tableId },
      data: result,
    });
  }

  async getSnapshotBulk(tableId: string, ids: string[]): Promise<ISnapshotBase<IFieldVo>[]> {
    const fieldRaws = await this.prismaService.txClient().field.findMany({
      where: { tableId, id: { in: ids } },
    });
    const fields = fieldRaws.map((field) => rawField2FieldObj(field));

    return fieldRaws
      .map((fieldRaw, i) => {
        return {
          id: fieldRaw.id,
          v: fieldRaw.version,
          type: 'json0',
          data: fields[i],
        };
      })
      .sort((a, b) => ids.indexOf(a.id) - ids.indexOf(b.id));
  }

  async getDocIdsByQuery(tableId: string, query: IGetFieldsQuery) {
    const result = await this.getFieldsByQuery(tableId, query);
    return {
      ids: result.map((field) => field.id),
    };
  }
}
