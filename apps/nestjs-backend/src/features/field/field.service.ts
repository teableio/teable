import { Injectable } from '@nestjs/common';
import type { Field, Prisma } from '@teable-group/db-main-prisma';
import { PrismaService } from '../../prisma.service';
import { generateFieldId } from '../../utils/id-generator';
import { convertNameToValidCharacter } from '../../utils/name-conversion';
import { getDbFieldTypeByFieldType } from '../../utils/type-transform';
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
    const { name, description, type, options, defaultValue, notNull, unique } = fieldInstance.data;

    const data: Prisma.FieldCreateInput = {
      id: generateFieldId(),
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
      columnIndexes: JSON.stringify({}),
      dbType: fieldInstance.dbFieldType,
      calculatedType: fieldInstance.calculatedType,
      cellValueType: fieldInstance.cellValueType,
      createdBy: 'admin',
      lastModifiedBy: 'admin',
    };

    console.log('createFieldData: ', data);
    return await prisma.field.create({ data });
  }

  async multipleCreateFieldsTransaction(
    prisma: Prisma.TransactionClient,
    tableId: string,
    multipleIFieldInstance: IFieldInstance[]
  ) {
    const dbFieldNames = await this.multipleGenerateValidDbFieldName(
      prisma,
      tableId,
      multipleIFieldInstance.map((dto) => dto.name)
    );

    const { dbTableName } = await prisma.tableMeta.findUniqueOrThrow({
      where: {
        id: tableId,
      },
      select: {
        dbTableName: true,
      },
    });

    console.log('theDbTableName: ', dbTableName);

    const multiFieldData: Field[] = [];
    for (let i = 0; i < multipleIFieldInstance.length; i++) {
      const fieldInstance = multipleIFieldInstance[i];
      const fieldData = await this.dbCreateField(prisma, tableId, dbFieldNames[i], fieldInstance);
      console.log('createField: ', fieldData);
      multiFieldData.push(fieldData);
    }

    for (let i = 0; i < dbFieldNames.length; i++) {
      const dbFieldName = dbFieldNames[i];
      await prisma.$executeRawUnsafe(
        `ALTER TABLE ${dbTableName} ADD ${dbFieldName} ${getDbFieldTypeByFieldType(
          multipleIFieldInstance[i].type
        )};`
      );
    }

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
