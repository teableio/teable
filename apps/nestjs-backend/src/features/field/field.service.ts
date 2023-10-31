import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import type {
  IDeleteColumnMetaOpContext,
  IAddColumnMetaOpContext,
  IColumnMeta,
  IFieldVo,
  IGetFieldsQuery,
  ISetColumnMetaOpContext,
  ISnapshotBase,
  ISetFieldPropertyOpContext,
  DbFieldType,
  ILookupOptionsVo,
  IOtOperation,
} from '@teable-group/core';
import { FieldOpBuilder, IdPrefix, OpName } from '@teable-group/core';
import type { Field as RawField, Prisma } from '@teable-group/db-main-prisma';
import { PrismaService } from '@teable-group/db-main-prisma';
import { instanceToPlain } from 'class-transformer';
import { Knex } from 'knex';
import { forEach, isEqual, keyBy, sortBy } from 'lodash';
import { InjectModel } from 'nest-knexjs';
import { ClsService } from 'nestjs-cls';
import type { IAdapterService } from '../../share-db/interface';
import { RawOpType } from '../../share-db/interface';
import type { IClsStore } from '../../types/cls';
import { convertNameToValidCharacter } from '../../utils/name-conversion';
import { AttachmentsTableService } from '../attachments/attachments-table.service';
import { BatchService } from '../calculation/batch.service';
import type { IFieldInstance } from './model/factory';
import { createFieldInstanceByVo, rawField2FieldObj } from './model/factory';
import { dbType2knexFormat } from './util';

type IOpContext =
  | IAddColumnMetaOpContext
  | ISetColumnMetaOpContext
  | IDeleteColumnMetaOpContext
  | ISetFieldPropertyOpContext;

@Injectable()
export class FieldService implements IAdapterService {
  private logger = new Logger(FieldService.name);

  constructor(
    private readonly batchService: BatchService,
    private readonly prismaService: PrismaService,
    private readonly attachmentService: AttachmentsTableService,
    private readonly cls: ClsService<IClsStore>,
    @InjectModel('CUSTOM_KNEX') private readonly knex: Knex
  ) {}

  generateDbFieldName(fields: { id: string; name: string }[]): string[] {
    return fields.map(({ id, name }) => `${convertNameToValidCharacter(name, 12)}_${id}`);
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
      columnMeta,
    } = fieldInstance;

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
      version: 1,
      columnMeta: JSON.stringify(columnMeta),
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
      lastModifiedBy: userId,
    };

    return this.prismaService.txClient().field.create({ data });
  }

  async getColumnsMeta(tableId: string, fieldInstances: IFieldInstance[]): Promise<IColumnMeta[]> {
    const views = await this.prismaService.txClient().view.findMany({
      where: { tableId, deletedTime: null },
      select: { id: true },
    });

    const fieldsData = await this.prismaService.txClient().field.findMany({
      where: { tableId, deletedTime: null },
      select: { id: true, columnMeta: true },
    });

    const maxOrder = fieldsData.reduce((max, field) => {
      const columnMeta = JSON.parse(field.columnMeta);
      const maxViewOrder = Object.keys(columnMeta).reduce((mx, viewId) => {
        return Math.max(mx, columnMeta[viewId].order);
      }, -1);
      return Math.max(max, maxViewOrder);
    }, -1);

    return fieldInstances.map(() => {
      const columnMeta: IColumnMeta = {};
      for (const view of views) {
        columnMeta[view.id] = {
          order: maxOrder + 1,
        };
      }
      return columnMeta;
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

  async alterVisualTable(
    dbTableName: string,
    fieldInstances: { dbFieldType: DbFieldType; dbFieldName: string }[]
  ) {
    for (let i = 0; i < fieldInstances.length; i++) {
      const field = fieldInstances[i];

      const alterTableQuery = this.knex.schema
        .alterTable(dbTableName, (table) => {
          const typeKey = dbType2knexFormat(this.knex, field.dbFieldType);
          table[typeKey](field.dbFieldName);
        })
        .toQuery();
      await this.prismaService.txClient().$executeRawUnsafe(alterTableQuery);
    }
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

  async getFields(tableId: string, query: IGetFieldsQuery): Promise<IFieldVo[]> {
    let viewId = query.viewId;
    if (viewId) {
      const view = await this.prismaService.txClient().view.findFirst({
        where: { id: viewId, deletedTime: null },
        select: { id: true },
      });
      if (!view) {
        throw new NotFoundException('view not found');
      }
    }

    if (!viewId) {
      const view = await this.prismaService.txClient().view.findFirst({
        where: { tableId, deletedTime: null },
        select: { id: true },
      });
      if (!view) {
        throw new NotFoundException('table not found');
      }
      viewId = view.id;
    }

    const fieldsPlain = await this.prismaService.txClient().field.findMany({
      where: { tableId, deletedTime: null },
    });

    const fields = fieldsPlain.map(rawField2FieldObj);

    const result = sortBy(fields, (field) => {
      return field.columnMeta[viewId as string].order;
    });

    if (query.filterHidden) {
      return result.filter((field) => !field.columnMeta[viewId as string].hidden);
    }

    return result;
  }

  async getFieldInstances(tableId: string, query: IGetFieldsQuery): Promise<IFieldInstance[]> {
    const fields = await this.getFields(tableId, query);
    return fields.map((field) => createFieldInstanceByVo(field));
  }

  async getDbTableName(tableId: string) {
    const tableMeta = await this.prismaService.txClient().tableMeta.findUniqueOrThrow({
      where: { id: tableId },
      select: { dbTableName: true },
    });
    return tableMeta.dbTableName;
  }

  async getFieldIdByIndex(tableId: string, viewId: string, index: number) {
    const fields = await this.prismaService.txClient().field.findMany({
      where: { tableId, deletedTime: null },
      select: { id: true, columnMeta: true },
    });

    const sortedFields = sortBy(fields, (field) => {
      return JSON.parse(field.columnMeta)[viewId]?.order;
    });

    return sortedFields[index].id;
  }

  async batchUpdateFields(tableId: string, opData: { fieldId: string; ops: IOtOperation[] }[]) {
    if (!opData.length) return;

    const fieldRaw = await this.prismaService.txClient().field.findMany({
      where: { tableId, id: { in: opData.map((data) => data.fieldId) }, deletedTime: null },
      select: { id: true, version: true },
    });

    const fieldMap = keyBy(fieldRaw, 'id');

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
    await this.alterVisualTable(dbTableName, fields);

    await this.batchService.saveRawOps(tableId, RawOpType.Create, IdPrefix.Field, dataList);
  }

  async create(tableId: string, snapshot: IFieldVo) {
    const fieldInstance = createFieldInstanceByVo(snapshot);
    const dbTableName = await this.getDbTableName(tableId);

    // maintain columnsMeta by view
    const [columnsMeta] = await this.getColumnsMeta(tableId, [fieldInstance]);
    fieldInstance.columnMeta = columnsMeta;

    // 1. save field meta in db
    await this.dbCreateMultipleField(tableId, [fieldInstance]);

    // 2. alter table with real field in visual table
    await this.alterVisualTable(dbTableName, [fieldInstance]);
  }

  async deleteMany(tableId: string, fieldData: { docId: string; version: number }[]) {
    const userId = this.cls.get('user.id');
    await this.attachmentService.deleteFields(
      tableId,
      fieldData.map((data) => data.docId)
    );

    for (const data of fieldData) {
      const { docId: id, version } = data;
      await this.prismaService.txClient().field.update({
        where: { id: id },
        data: { deletedTime: new Date(), lastModifiedBy: userId, version },
      });
    }
  }

  async del(version: number, tableId: string, fieldId: string) {
    await this.deleteMany(tableId, [{ docId: fieldId, version }]);
  }

  private handleFieldProperty(_fieldId: string, opContext: IOpContext) {
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

    return { [key]: newValue ?? null };
  }

  private handleColumnMeta = async (fieldId: string, opContext: IOpContext) => {
    const fieldData = await this.prismaService.txClient().field.findUniqueOrThrow({
      where: { id: fieldId },
      select: { columnMeta: true },
    });

    let newColumnMeta = JSON.parse(fieldData.columnMeta);
    if (opContext.name === OpName.AddColumnMeta) {
      const { viewId, newMetaValue } = opContext;

      newColumnMeta = {
        ...newColumnMeta,
        [viewId]: {
          ...newColumnMeta[viewId],
          ...newMetaValue,
        },
      };
    } else if (opContext.name === OpName.SetColumnMeta) {
      const { viewId, metaKey, newMetaValue } = opContext;

      newColumnMeta = {
        ...newColumnMeta,
        [viewId]: {
          ...newColumnMeta[viewId],
          [metaKey]: newMetaValue,
        },
      };
    } else if (opContext.name === OpName.DeleteColumnMeta) {
      const { viewId, oldMetaValue } = opContext;

      forEach(oldMetaValue, (value, key) => {
        if (isEqual(newColumnMeta[viewId][key], value)) {
          delete newColumnMeta[viewId][key];
          if (Object.keys(newColumnMeta[viewId]).length === 0) {
            delete newColumnMeta[viewId];
          }
        }
      });
    }

    return { columnMeta: JSON.stringify(newColumnMeta) };
  };

  private async updateStrategies(fieldId: string, opContext: IOpContext) {
    const opHandlers = {
      [OpName.SetFieldProperty]: this.handleFieldProperty,
      [OpName.AddColumnMeta]: this.handleColumnMeta,
      [OpName.SetColumnMeta]: this.handleColumnMeta,
      [OpName.DeleteColumnMeta]: this.handleColumnMeta,
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
    let viewId = query.viewId;
    if (!viewId) {
      const view = await this.prismaService.txClient().view.findFirstOrThrow({
        where: { tableId, deletedTime: null },
        select: { id: true },
      });
      viewId = view.id;
    }

    const fieldsPlain = await this.prismaService.txClient().field.findMany({
      where: { tableId, deletedTime: null },
      select: { id: true, columnMeta: true },
    });

    let fields = fieldsPlain.map((field) => {
      return {
        ...field,
        columnMeta: JSON.parse(field.columnMeta),
      };
    });

    if (query.filterHidden) {
      fields = fields.filter((field) => !field.columnMeta[viewId as string].hidden);
    }

    return {
      ids: sortBy(fields, (field) => {
        return field.columnMeta[viewId as string]?.order;
      }).map((field) => field.id),
    };
  }
}
