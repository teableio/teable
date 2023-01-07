import { Injectable } from '@nestjs/common';
import type { IColumnMeta } from '@teable-group/core';
import type { Field, Prisma } from '@teable-group/db-main-prisma';
import { PrismaService } from '../../prisma.service';
import { convertNameToValidCharacter } from '../../utils/name-conversion';
import { preservedFieldName } from './constant';
import type { IFieldInstance } from './model/factory';

@Injectable()
export class FieldService {
  constructor(private readonly prismaService: PrismaService) {}

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
    const { id, name, description, type, options, defaultValue, notNull, unique } =
      fieldInstance.data;

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
      defaultValue: JSON.stringify(defaultValue),
      columnMeta: JSON.stringify(columnMeta),
      dbFieldName,
      dbType: fieldInstance.dbFieldType,
      calculatedType: fieldInstance.calculatedType,
      cellValueType: fieldInstance.cellValueType,
      createdBy: 'admin',
      lastModifiedBy: 'admin',
    };

    console.log('createFieldData: ', data);
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
    const multiFieldData: Field[] = [];
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
      console.log('createField: ', fieldData);
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
    return await this.prismaService.$transaction(async (prisma) => {
      return this.multipleCreateFieldsTransaction(prisma, tableId, fieldInstances);
    });
  }

  async getField(tableId: string, fieldId: string) {
    return `get tableId: ${tableId} fieldId: ${fieldId}`;
  }
}
