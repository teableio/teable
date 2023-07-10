import { Injectable, Logger } from '@nestjs/common';
import type {
  IAddColumnMetaOpContext,
  IColumnMeta,
  IFieldSnapshot,
  IFieldSnapshotQuery,
  ISetColumnMetaOpContext,
  ISetFieldNameOpContext,
  ISnapshotBase,
} from '@teable-group/core';
import { OpName } from '@teable-group/core';
import type { IDeleteColumnMetaOpContext } from '@teable-group/core/dist/op-builder/field/delete-column-meta';
import type { ISetFieldDefaultValueOpContext } from '@teable-group/core/src/op-builder/field/set-field-default-value';
import type { ISetFieldDescriptionOpContext } from '@teable-group/core/src/op-builder/field/set-field-description';
import type { ISetFieldOptionsOpContext } from '@teable-group/core/src/op-builder/field/set-field-options';
import type { ISetFieldTypeOpContext } from '@teable-group/core/src/op-builder/field/set-field-type';
import type { Field as RawField, Prisma } from '@teable-group/db-main-prisma';
import knex from 'knex';
import { forEach, isEqual, sortBy } from 'lodash';
import { PrismaService } from '../../prisma.service';
import type { IAdapterService } from '../../share-db/interface';
import { convertNameToValidCharacter } from '../../utils/name-conversion';
import { AttachmentsTableService } from '../attachments/attachments-table.service';
import { preservedFieldName } from './constant';
import type { CreateFieldRo } from './model/create-field.ro';
import type { IFieldInstance, IPreparedRo } from './model/factory';
import {
  createFieldInstanceByRo,
  createFieldInstanceByVo,
  rawField2FieldObj,
} from './model/factory';
import type { FieldVo } from './model/field.vo';
import type { GetFieldsRo } from './model/get-fields.ro';
import { dbType2knexFormat } from './util';

type IOpContexts =
  | ISetFieldNameOpContext
  | ISetFieldDescriptionOpContext
  | ISetFieldTypeOpContext
  | ISetFieldOptionsOpContext
  | ISetFieldDefaultValueOpContext
  | IAddColumnMetaOpContext
  | ISetColumnMetaOpContext
  | IDeleteColumnMetaOpContext;

@Injectable()
export class FieldService implements IAdapterService {
  private logger = new Logger(FieldService.name);
  private readonly knex = knex({ client: 'sqlite3' });

  constructor(
    private readonly prismaService: PrismaService,
    private readonly attachmentService: AttachmentsTableService
  ) {}

  async multipleGenerateValidDbFieldName(
    prisma: Prisma.TransactionClient,
    tableId: string,
    field: IFieldInstance[]
  ): Promise<string[]> {
    const validNames = field.map(
      ({ id, name }) => `${convertNameToValidCharacter(name, 50)}_${id}`
    );
    let newValidNames = [...validNames];
    let index = 1;

    // eslint-disable-next-line no-constant-condition
    while (true) {
      const exist = await prisma.field.count({
        where: {
          tableId,
          dbFieldName: { in: newValidNames },
        },
      });
      if (!exist && !newValidNames.some((validName) => preservedFieldName.has(validName))) {
        break;
      }
      newValidNames = validNames.map((name) => `${name}_${index++}`);
    }

    return newValidNames;
  }

  private async dbCreateField(
    prisma: Prisma.TransactionClient,
    tableId: string,
    dbFieldName: string,
    columnMeta: IColumnMeta,
    fieldInstance: IFieldInstance
  ) {
    const {
      id,
      name,
      description,
      type,
      options,
      lookupOptions,
      defaultValue,
      notNull,
      unique,
      isPrimary,
      isComputed,
      dbFieldType,
      cellValueType,
      isMultipleCellValue,
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
      defaultValue: JSON.stringify(defaultValue),
      columnMeta: JSON.stringify(columnMeta),
      isComputed,
      lookupFieldId: lookupOptions?.lookupFieldId,
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
    const dbFieldNames = await this.multipleGenerateValidDbFieldName(
      prisma,
      tableId,
      fieldInstances
    );

    // maintain columnsMeta by view
    const columnsMeta = await this.getColumnsMeta(prisma, tableId, fieldInstances);

    for (let i = 0; i < fieldInstances.length; i++) {
      const fieldInstance = fieldInstances[i];
      const fieldData = await this.dbCreateField(
        prisma,
        tableId,
        dbFieldNames[i],
        columnsMeta[i],
        fieldInstance
      );

      multiFieldData.push(fieldData);
    }
    return multiFieldData;
  }

  async alterVisualTable(
    prisma: Prisma.TransactionClient,
    tableId: string,
    dbFieldNames: string[],
    fieldInstances: IFieldInstance[]
  ) {
    const dbTableName = await this.getDbTableName(prisma, tableId);

    for (let i = 0; i < dbFieldNames.length; i++) {
      const dbFieldName = dbFieldNames[i];

      const alterTableQuery = this.knex.schema
        .alterTable(dbTableName, (table) => {
          const typeKey = dbType2knexFormat(fieldInstances[i].dbFieldType);
          table[typeKey](dbFieldName);
        })
        .toQuery();
      await prisma.$executeRawUnsafe(alterTableQuery);
    }
  }

  async multipleCreateFieldsTransaction(
    prisma: Prisma.TransactionClient,
    tableId: string,
    fieldInstances: IFieldInstance[]
  ) {
    // 1. save field in db
    const multiFieldData = await this.dbCreateMultipleField(prisma, tableId, fieldInstances);

    // 2. alter table with real field in visual table
    await this.alterVisualTable(
      prisma,
      tableId,
      multiFieldData.map((field) => field.dbFieldName),
      fieldInstances
    );

    return multiFieldData;
  }

  async createField(tableId: string, fieldInstance: IFieldInstance) {
    return (await this.multipleCreateFields(tableId, [fieldInstance]))[0];
  }

  // we have to support multiple action, because users will do it in batch
  async multipleCreateFields(tableId: string, fieldInstances: IFieldInstance[]) {
    return await this.prismaService.$transaction(async (prisma) => {
      return this.multipleCreateFieldsTransaction(prisma, tableId, fieldInstances);
    });
  }

  async getField(
    tableId: string,
    fieldId: string,
    prisma?: Prisma.TransactionClient
  ): Promise<FieldVo> {
    if (prisma) {
      const field = await prisma.field.findUniqueOrThrow({
        where: { id: fieldId },
      });

      return rawField2FieldObj(field);
    }

    const field = await this.prismaService.field.findUniqueOrThrow({
      where: { id: fieldId },
    });

    return rawField2FieldObj(field);
  }

  async getFields(tableId: string, query: GetFieldsRo): Promise<FieldVo[]> {
    let viewId = query.viewId;
    if (!viewId) {
      const view = await this.prismaService.view.findFirstOrThrow({
        where: { tableId, deletedTime: null },
        select: { id: true },
      });
      viewId = view.id;
    }

    const fieldsPlain = await this.prismaService.field.findMany({
      where: { tableId, deletedTime: null },
    });

    const fields = fieldsPlain.map(rawField2FieldObj);

    return sortBy(fields, (field) => {
      return field.columnMeta[viewId as string].order;
    });
  }

  async getFieldInstances(tableId: string, query: GetFieldsRo): Promise<IFieldInstance[]> {
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

  async create(prisma: Prisma.TransactionClient, tableId: string, snapshot: IFieldSnapshot) {
    const fieldInstance = createFieldInstanceByRo(snapshot.field as CreateFieldRo & IPreparedRo);

    // 1. save field meta in db
    const multiFieldData = await this.dbCreateMultipleField(prisma, tableId, [fieldInstance]);

    // 2. alter table with real field in visual table
    await this.alterVisualTable(
      prisma,
      tableId,
      multiFieldData.map((field) => field.dbFieldName),
      [fieldInstance]
    );
  }

  async del(prisma: Prisma.TransactionClient, _tableId: string, fieldId: string) {
    await this.attachmentService.delete(prisma, [{ fieldId, tableId: _tableId }]);
    await prisma.field.update({
      where: { id: fieldId },
      data: { deletedTime: new Date() },
    });
  }

  private handleFieldName(params: { opContext: IOpContexts }) {
    const { opContext } = params;
    return { name: (opContext as ISetFieldNameOpContext).newName };
  }

  private handleFieldDescription(params: { opContext: IOpContexts }) {
    const { opContext } = params;
    return { description: (opContext as ISetFieldDescriptionOpContext).newDescription };
  }

  private handleFieldType(params: { opContext: IOpContexts }) {
    const { opContext } = params;
    return { type: (opContext as ISetFieldTypeOpContext).newType };
  }

  private handleFieldOptions(params: { opContext: IOpContexts }) {
    const { opContext } = params;
    return { options: JSON.stringify((opContext as ISetFieldOptionsOpContext).newOptions) };
  }

  private handleFieldDefaultValue(params: { opContext: IOpContexts }) {
    const { opContext } = params;
    return {
      defaultValue: JSON.stringify((opContext as ISetFieldDefaultValueOpContext).newDefaultValue),
    };
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
      [OpName.SetFieldName]: this.handleFieldName,
      [OpName.SetFieldDescription]: this.handleFieldDescription,
      [OpName.SetFieldType]: this.handleFieldType,
      [OpName.SetFieldOptions]: this.handleFieldOptions,
      [OpName.SetFieldDefaultValue]: this.handleFieldDefaultValue,

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
      const updateData = {
        version,
        ...(await this.updateStrategies(opContext, { prisma, fieldId, opContext })),
      };

      this.logger.log(
        `Field update tableId: ${tableId} | fieldId: ${fieldId} | updateData: ${JSON.stringify(
          updateData
        )}`
      );

      await prisma.field.update({
        where: { id: fieldId },
        data: updateData,
      });
    }
  }

  async getSnapshotBulk(
    prisma: Prisma.TransactionClient,
    tableId: string,
    ids: string[]
  ): Promise<ISnapshotBase<IFieldSnapshot>[]> {
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
          data: {
            field: fields[i],
          },
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
        return field.columnMeta[viewId as string].order;
      }).map((field) => field.id),
    };
  }
}
