import { Injectable } from '@nestjs/common';
import type { IColumn } from '@teable-group/core';
import type { Field, Prisma } from '@teable-group/db-main-prisma';
import { PrismaService } from '../../prisma.service';
import { convertNameToValidCharacter } from '../../utils/name-conversion';
import { preservedFieldName } from './constant';
import type { IFieldInstance } from './model/factory';

@Injectable()
export class FieldService {
  constructor(private readonly prisma: PrismaService) {}

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

  async getAllViewColumns(prisma: Prisma.TransactionClient, tableId: string) {
    const views = await prisma.view.findMany({
      where: {
        tableId,
      },
      select: {
        id: true,
        columns: true,
      },
    });

    return views.map<{ id: string; columns: IColumn[] }>((view) => ({
      id: view.id,
      columns: JSON.parse(view.columns),
    }));
  }

  private async insertNewColumnsInViews(
    prisma: Prisma.TransactionClient,
    tableId: string,
    fieldInstances: IFieldInstance[]
  ) {
    const allView = await this.getAllViewColumns(prisma, tableId);
    const newColumns = fieldInstances.map((field) => ({ fieldId: field.data.id }));
    const newViewColumns = allView.map((view) => ({
      id: view.id,
      columns: [...view.columns, ...newColumns],
    }));

    for (const view of newViewColumns) {
      await prisma.view.update({
        where: {
          id: view.id,
        },
        data: {
          columns: JSON.stringify(view.columns),
        },
      });
    }
  }

  private async dbCreateMultipleField(
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

    for (let i = 0; i < fieldInstances.length; i++) {
      const fieldInstance = fieldInstances[i];
      const fieldData = await this.dbCreateField(prisma, tableId, dbFieldNames[i], fieldInstance);
      console.log('createField: ', fieldData);
      multiFieldData.push(fieldData);
    }
    return multiFieldData;
  }

  private async alterVisualTable(
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
    // 1. save field meta in db
    const multiFieldData = await this.dbCreateMultipleField(prisma, tableId, fieldInstances);

    // 2. maintain columns in view
    await this.insertNewColumnsInViews(prisma, tableId, fieldInstances);

    // 3. alter table with real field in visual table
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
  async multipleCreateFields(tableId: string, multipleCreateFieldsDto: IFieldInstance[]) {
    return await this.prisma.$transaction(async (prisma) => {
      return this.multipleCreateFieldsTransaction(prisma, tableId, multipleCreateFieldsDto);
    });
  }

  async getField(tableId: string, fieldId: string) {
    return `get tableId: ${tableId} fieldId: ${fieldId}`;
  }
}
