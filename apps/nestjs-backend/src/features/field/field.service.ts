import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import type {
  IDeleteColumnMetaOpContext,
  IAddColumnMetaOpContext,
  IColumnMeta,
  IFieldSnapshotQuery,
  IFieldVo,
  IGetFieldsQuery,
  ISetColumnMetaOpContext,
  ISnapshotBase,
  ISetFieldPropertyOpContext,
  DbFieldType,
  ILookupOptionsVo,
} from '@teable-group/core';
import { OpName } from '@teable-group/core';
import type { Field as RawField, Prisma } from '@teable-group/db-main-prisma';
import { PrismaService } from '@teable-group/db-main-prisma';
import knex from 'knex';
import { forEach, isEqual, sortBy } from 'lodash';
import type { IAdapterService } from '../../share-db/interface';
import { convertNameToValidCharacter } from '../../utils/name-conversion';
import { AttachmentsTableService } from '../attachments/attachments-table.service';
import type { IFieldInstance } from './model/factory';
import { createFieldInstanceByVo, rawField2FieldObj } from './model/factory';
import { dbType2knexFormat } from './util';

type IOpContexts =
  | IAddColumnMetaOpContext
  | ISetColumnMetaOpContext
  | IDeleteColumnMetaOpContext
  | ISetFieldPropertyOpContext;

@Injectable()
export class FieldService implements IAdapterService {
  private logger = new Logger(FieldService.name);
  private readonly knex = knex({ client: 'sqlite3' });

  constructor(
    private readonly prismaService: PrismaService,
    private readonly attachmentService: AttachmentsTableService
  ) {}

  generateDbFieldName(fields: { id: string; name: string }[]): string[] {
    return fields.map(({ id, name }) => `${convertNameToValidCharacter(name, 50)}_${id}`);
  }

  private async dbCreateField(
    prisma: Prisma.TransactionClient,
    tableId: string,
    columnMeta: IColumnMeta,
    fieldInstance: IFieldInstance
  ) {
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
      createdBy: 'admin',
      lastModifiedBy: 'admin',
    };

    return await prisma.field.create({ data });
  }

  private async getColumnsMeta(
    prisma: Prisma.TransactionClient,
    tableId: string,
    fieldInstances: IFieldInstance[]
  ): Promise<IColumnMeta[]> {
    const views = await prisma.view.findMany({
      where: { tableId, deletedTime: null },
      select: { id: true },
    });

    const fieldsData = await prisma.field.findMany({
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

  async dbCreateMultipleField(
    prisma: Prisma.TransactionClient,
    tableId: string,
    fieldInstances: IFieldInstance[]
  ) {
    const multiFieldData: RawField[] = [];

    // maintain columnsMeta by view
    const columnsMeta = await this.getColumnsMeta(prisma, tableId, fieldInstances);
    for (let i = 0; i < fieldInstances.length; i++) {
      const fieldInstance = fieldInstances[i];
      const fieldData = await this.dbCreateField(prisma, tableId, columnsMeta[i], fieldInstance);

      multiFieldData.push(fieldData);
    }
    return multiFieldData;
  }

  async alterVisualTable(
    prisma: Prisma.TransactionClient,
    dbTableName: string,
    fieldInstances: { dbFieldType: DbFieldType; dbFieldName: string }[]
  ) {
    for (let i = 0; i < fieldInstances.length; i++) {
      const field = fieldInstances[i];

      const alterTableQuery = this.knex.schema
        .alterTable(dbTableName, (table) => {
          const typeKey = dbType2knexFormat(field.dbFieldType);
          table[typeKey](field.dbFieldName);
        })
        .toQuery();
      await prisma.$executeRawUnsafe(alterTableQuery);
    }
  }

  async getField(tableId: string, fieldId: string): Promise<IFieldVo> {
    const field = await this.prismaService.field.findFirst({
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
      const view = await this.prismaService.view.findFirst({
        where: { id: viewId, deletedTime: null },
        select: { id: true },
      });
      if (!view) {
        throw new NotFoundException('view not found');
      }
    }

    if (!viewId) {
      const view = await this.prismaService.view.findFirst({
        where: { tableId, deletedTime: null },
        select: { id: true },
      });
      if (!view) {
        throw new NotFoundException('table not found');
      }
      viewId = view.id;
    }

    const fieldsPlain = await this.prismaService.field.findMany({
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

  async getDbTableName(prisma: Prisma.TransactionClient, tableId: string) {
    const tableMeta = await prisma.tableMeta.findUniqueOrThrow({
      where: { id: tableId },
      select: { dbTableName: true },
    });
    return tableMeta.dbTableName;
  }

  async create(prisma: Prisma.TransactionClient, tableId: string, snapshot: IFieldVo) {
    const fieldInstance = createFieldInstanceByVo(snapshot);
    const dbTableName = await this.getDbTableName(prisma, tableId);

    // 1. save field meta in db
    await this.dbCreateMultipleField(prisma, tableId, [fieldInstance]);

    // 2. alter table with real field in visual table
    await this.alterVisualTable(prisma, dbTableName, [fieldInstance]);
  }

  async del(prisma: Prisma.TransactionClient, _tableId: string, fieldId: string) {
    await this.attachmentService.delete(prisma, [{ fieldId, tableId: _tableId }]);
    await prisma.field.update({
      where: { id: fieldId },
      data: { deletedTime: new Date() },
    });
  }

  private handleFieldProperty(params: { opContext: IOpContexts }) {
    const { opContext } = params;
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

  private async handleColumnMeta(params: {
    prisma: Prisma.TransactionClient;
    fieldId: string;
    opContext: IOpContexts;
  }) {
    const { prisma, fieldId, opContext } = params;

    const fieldData = await prisma.field.findUniqueOrThrow({
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
  }

  private async updateStrategies(
    opContext: IOpContexts,
    params: {
      prisma: Prisma.TransactionClient;
      fieldId: string;
      opContext: IOpContexts;
    }
  ) {
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

    return handler.constructor.name === 'AsyncFunction' ? await handler(params) : handler(params);
  }

  async update(
    prisma: Prisma.TransactionClient,
    version: number,
    tableId: string,
    fieldId: string,
    opContexts: IOpContexts[]
  ) {
    for (const opContext of opContexts) {
      const result = await this.updateStrategies(opContext, { prisma, fieldId, opContext });

      await prisma.field.update({
        where: { id: fieldId },
        data: {
          version,
          ...result,
        },
      });
    }
  }

  async getSnapshotBulk(
    prisma: Prisma.TransactionClient,
    tableId: string,
    ids: string[]
  ): Promise<ISnapshotBase<IFieldVo>[]> {
    const fieldRaws = await prisma.field.findMany({
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

  async getDocIdsByQuery(
    prisma: Prisma.TransactionClient,
    tableId: string,
    query: IFieldSnapshotQuery
  ) {
    let viewId = query.viewId;
    if (!viewId) {
      const view = await prisma.view.findFirstOrThrow({
        where: { tableId, deletedTime: null },
        select: { id: true },
      });
      viewId = view.id;
    }

    const fieldsPlain = await prisma.field.findMany({
      where: { tableId, deletedTime: null },
      select: { id: true, columnMeta: true },
    });

    const fields = fieldsPlain.map((field) => {
      return {
        ...field,
        columnMeta: JSON.parse(field.columnMeta),
      };
    });

    return {
      ids: sortBy(fields, (field) => {
        return field.columnMeta[viewId as string]?.order;
      }).map((field) => field.id),
    };
  }
}
