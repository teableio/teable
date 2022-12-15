import { Injectable } from '@nestjs/common';
import type { Field, Prisma } from '@teable-group/db-main-prisma';
import { PrismaService } from '../../prisma.service';
import { generateFieldId } from '../../utils/id-generator';
import { convertNameToValidCharacter } from '../../utils/name-conversion';
import { getDbFieldTypeByFieldType } from '../../utils/type-transform';
import { preservedFieldName } from './constant';
import type { CreateFieldDto } from './create-field.dto';

@Injectable()
export class FieldService {
  constructor(private readonly prisma: PrismaService) {}

  async multipleGenerateValidDbFieldName(
    prisma: Prisma.TransactionClient,
    tableId: string,
    names: string[]
  ): Promise<string[]> {
    const validNames = names.map((name) => convertNameToValidCharacter(name));
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
    createFieldDto: CreateFieldDto & { dbFieldName: string }
  ) {
    const { name, dbFieldName, description, type, options, defaultValue, notNull, unique } =
      createFieldDto;

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
      defaultValue,
      columnIndexes: JSON.stringify({}),
      dbFieldName,
      createdBy: 'admin',
      lastModifiedBy: 'admin',
    };

    return prisma.field.create({ data });
  }

  async multipleCreateFieldTransaction(
    prisma: Prisma.TransactionClient,
    tableId: string,
    multipleCreateFieldDto: CreateFieldDto[]
  ) {
    const dbFieldNames = await this.multipleGenerateValidDbFieldName(
      prisma,
      tableId,
      multipleCreateFieldDto.map((dto) => dto.name)
    );

    const { dbTableName } = await prisma.tableMeta.findUniqueOrThrow({
      where: {
        id: tableId,
      },
      select: {
        dbTableName: true,
      },
    });

    const multiFieldData: Field[] = [];
    for (let i = 0; i < multipleCreateFieldDto.length; i++) {
      const createFieldDto = multipleCreateFieldDto[i];
      const fieldData = await this.dbCreateField(prisma, tableId, {
        ...createFieldDto,
        dbFieldName: dbFieldNames[i],
      });
      multiFieldData.push(fieldData);
    }

    for (let i = 0; i < dbFieldNames.length; i++) {
      const dbFieldName = dbFieldNames[i];
      await prisma.$executeRawUnsafe(
        `ALTER TABLE ${dbTableName} ADD ${dbFieldName} ${getDbFieldTypeByFieldType(
          multipleCreateFieldDto[i].type
        )};`
      );
    }

    return multiFieldData;
  }

  async createField(tableId: string, createFieldDto: CreateFieldDto) {
    return (await this.multipleCreateField(tableId, [createFieldDto]))[0];
  }

  // we have to support multiple action, because users will do it in batch
  async multipleCreateField(tableId: string, multipleCreateFieldDto: CreateFieldDto[]) {
    return await this.prisma.$transaction(async (prisma) => {
      return this.multipleCreateFieldTransaction(prisma, tableId, multipleCreateFieldDto);
    });
  }

  async getField(tableId: string, fieldId: string) {
    return `get tableId: ${tableId} fieldId: ${fieldId}`;
  }
}
