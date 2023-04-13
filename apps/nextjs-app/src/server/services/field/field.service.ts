import type {
  CellValueType,
  DbFieldType,
  FieldType,
  IAddColumnMetaOpContext,
  IColumnMeta,
  IFieldSnapshot,
  IFieldSnapshotQuery,
  ISetColumnMetaOpContext,
  ISetFieldNameOpContext,
  ISnapshotBase,
} from '@teable-group/core';
import { nullsToUndefined, OpName } from '@teable-group/core';
import type { Field as RawField, Prisma } from '@teable-group/db-main-prisma';
import { instanceToPlain } from 'class-transformer';
import knex from 'knex';
import { sortBy } from 'lodash';
import { prismaClient } from '@/backend/config/container.config';
import { convertNameToValidCharacter } from 'server/helper';
import { preservedFieldName } from './constant';
import type { CreateFieldRo } from './model/create-field.ro';
import type { IFieldInstance } from './model/factory';
import { createFieldInstanceByRaw, createFieldInstanceByRo } from './model/factory';
import type { FieldVo } from './model/field.vo';
import type { GetFieldsRo } from './model/get-fields.ro';

export class FieldService {
  queryBuilder: ReturnType<typeof knex>;

  constructor() {
    this.queryBuilder = knex({ client: 'sqlite3' });
  }

  async multipleGenerateValidDbFieldName(
    prisma: Prisma.TransactionClient,
    tableId: string,
    names: string[]
  ): Promise<string[]> {
    const validNames = names.map((name) => convertNameToValidCharacter(name, 50));
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
    const { id, name, description, type, options, defaultValue, notNull, unique, isPrimary } =
      fieldInstance;

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
      dbFieldName,
      dbFieldType: fieldInstance.dbFieldType,
      calculatedType: fieldInstance.calculatedType,
      cellValueType: fieldInstance.cellValueType,
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
      where: { tableId },
      select: { id: true },
    });

    const fieldsData = await prisma.field.findMany({
      where: { tableId },
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
      fieldInstances.map((dto) => dto.name)
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
    const { dbTableName } = await prisma.tableMeta.findUniqueOrThrow({
      where: {
        id: tableId,
      },
      select: {
        dbTableName: true,
      },
    });

    for (let i = 0; i < dbFieldNames.length; i++) {
      const dbFieldName = dbFieldNames[i];
      await prisma.$executeRawUnsafe(
        `ALTER TABLE ${dbTableName} ADD ${dbFieldName} ${fieldInstances[i].dbFieldType};`
      );
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
    return await prismaClient.$transaction(async (prisma) => {
      return this.multipleCreateFieldsTransaction(prisma, tableId, fieldInstances);
    });
  }

  private rawField2FieldObj(field: RawField): FieldVo {
    return nullsToUndefined({
      ...field,
      type: field.type as FieldType,
      calculatedType: field.calculatedType as FieldType,
      cellValueType: field.cellValueType as CellValueType,
      dbFieldType: field.dbFieldType as DbFieldType,
      options: JSON.parse(field.options as string),
      defaultValue: JSON.parse(field.defaultValue as string),
      columnMeta: JSON.parse(field.columnMeta),
    });
  }

  async getField(tableId: string, fieldId: string): Promise<FieldVo> {
    const field = await prismaClient.field.findUniqueOrThrow({
      where: { id: fieldId },
    });

    return this.rawField2FieldObj(field);
  }

  async getFields(tableId: string, query: GetFieldsRo): Promise<FieldVo[]> {
    let viewId = query.viewId;
    if (!viewId) {
      const view = await prismaClient.view.findFirstOrThrow({
        where: { tableId },
        select: { id: true },
      });
      viewId = view.id;
    }

    const fieldsPlain = await prismaClient.field.findMany({
      where: { tableId },
    });

    const fields = fieldsPlain.map(this.rawField2FieldObj);

    return sortBy(fields, (field) => {
      return field.columnMeta[viewId as string].order;
    });
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

    // TODO: 3. add order in every columnMeta view
  }

  async update(
    prisma: Prisma.TransactionClient,
    version: number,
    _tableId: string,
    fieldId: string,
    opContexts: (ISetColumnMetaOpContext | ISetFieldNameOpContext | IAddColumnMetaOpContext)[]
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
    const fields = await prisma.field.findMany({
      where: { tableId, id: { in: ids } },
    });
    const fieldInstances = fields.map((field) => createFieldInstanceByRaw(field));

    return fields
      .map((field, i) => {
        return {
          id: field.id,
          v: field.version,
          type: 'json0',
          data: {
            field: instanceToPlain(fieldInstances[i]) as FieldVo,
          },
        };
      })
      .sort((a, b) => ids.indexOf(a.id) - ids.indexOf(b.id));
  }

  async getDocIdsByQuery(
    prisma: Prisma.TransactionClient,
    tableId: string,
    query: IFieldSnapshotQuery
  ): Promise<string[]> {
    let viewId = query.viewId;
    if (!viewId) {
      const view = await prisma.view.findFirstOrThrow({
        where: { tableId },
        select: { id: true },
      });
      viewId = view.id;
    }

    const fieldsPlain = await prisma.field.findMany({
      where: { tableId },
      select: { id: true, columnMeta: true },
    });

    const fields = fieldsPlain.map((field) => {
      return {
        ...field,
        columnMeta: JSON.parse(field.columnMeta),
      };
    });

    return sortBy(fields, (field) => {
      return field.columnMeta[viewId as string].order;
    }).map((field) => field.id);
  }
}

export const fieldService = new FieldService();
