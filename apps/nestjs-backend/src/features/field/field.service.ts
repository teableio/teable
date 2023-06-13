import { Injectable } from '@nestjs/common';
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
import type { ISetFieldDefaultValueOpContext } from '@teable-group/core/src/op-builder/field/set-field-default-value';
import type { ISetFieldDescriptionOpContext } from '@teable-group/core/src/op-builder/field/set-field-description';
import type { ISetFieldOptionsOpContext } from '@teable-group/core/src/op-builder/field/set-field-options';
import type { ISetFieldTypeOpContext } from '@teable-group/core/src/op-builder/field/set-field-type';
import type { Field as RawField, Prisma } from '@teable-group/db-main-prisma';
import knex from 'knex';
import { sortBy } from 'lodash';
import { PrismaService } from '../../prisma.service';
import type { IAdapterService } from '../../share-db/interface';
import { convertNameToValidCharacter } from '../../utils/name-conversion';
import { AttachmentsTableService } from '../attachments/attachments-table.service';
import { preservedFieldName } from './constant';
import type { CreateFieldRo } from './model/create-field.ro';
import type { IFieldInstance } from './model/factory';
import {
  createFieldInstanceByVo,
  rawField2FieldObj,
  createFieldInstanceByRo,
} from './model/factory';
import type { FieldVo } from './model/field.vo';
import type { GetFieldsRo } from './model/get-fields.ro';
import { dbType2knexFormat } from './util';

@Injectable()
export class FieldService implements IAdapterService {
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
      defaultValue,
      notNull,
      unique,
      isPrimary,
      isComputed,
      dbFieldType,
      calculatedType,
      cellValueType,
      cellValueElementType,
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
      dbFieldName,
      dbFieldType,
      calculatedType,
      cellValueType,
      cellValueElementType,
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

  async getField(tableId: string, fieldId: string): Promise<FieldVo> {
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
    const fieldInstance = createFieldInstanceByRo(snapshot.field as CreateFieldRo);

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

  async update(
    prisma: Prisma.TransactionClient,
    version: number,
    _tableId: string,
    fieldId: string,
    opContexts: (
      | ISetColumnMetaOpContext
      | ISetFieldNameOpContext
      | IAddColumnMetaOpContext
      | ISetFieldDescriptionOpContext
      | ISetFieldTypeOpContext
      | ISetFieldOptionsOpContext
      | ISetFieldDefaultValueOpContext
    )[]
  ) {
    for (const opContext of opContexts) {
      switch (opContext.name) {
        case OpName.SetFieldName: {
          const { newName } = opContext;
          await prisma.field.update({
            where: { id: fieldId },
            data: { name: newName, version },
          });
          return;
        }
        case OpName.SetFieldDescription: {
          const { newDescription } = opContext;
          await prisma.field.update({
            where: { id: fieldId },
            data: { description: newDescription, version },
          });
          return;
        }
        case OpName.SetFieldType: {
          const { newType } = opContext;
          await prisma.field.update({
            where: { id: fieldId },
            data: { type: newType, version },
          });
          return;
        }
        case OpName.SetFieldOptions: {
          const { newOptions } = opContext;
          await prisma.field.update({
            where: { id: fieldId },
            data: { options: JSON.stringify(newOptions), version },
          });
          return;
        }
        case OpName.SetFieldDefaultValue: {
          const { newDefaultValue } = opContext;
          await prisma.field.update({
            where: { id: fieldId },
            data: { defaultValue: JSON.stringify(newDefaultValue), version },
          });
          return;
        }
        case OpName.SetColumnMeta: {
          const { metaKey, viewId, newMetaValue } = opContext;

          const fieldData = await prisma.field.findUniqueOrThrow({
            where: { id: fieldId },
            select: { columnMeta: true },
          });

          const columnMeta = JSON.parse(fieldData.columnMeta);

          columnMeta[viewId][metaKey] = newMetaValue;

          await prisma.field.update({
            where: { id: fieldId },
            data: { columnMeta: JSON.stringify(columnMeta), version },
          });
          return;
        }
        case OpName.AddColumnMeta: {
          const { viewId, newMetaValue } = opContext;

          const fieldData = await prisma.field.findUniqueOrThrow({
            where: { id: fieldId },
            select: { columnMeta: true },
          });

          const columnMeta = JSON.parse(fieldData.columnMeta);

          Object.entries(newMetaValue).forEach(([key, value]) => {
            columnMeta[viewId][key] = value;
          });

          await prisma.field.update({
            where: { id: fieldId },
            data: { columnMeta: JSON.stringify(columnMeta), version },
          });
          return;
        }
        default:
          throw new Error(`Unknown context ${opContext} for field update`);
      }
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
