import { Injectable } from '@nestjs/common';
import type { Prisma } from '@teable-group/db-main-prisma';
import { PrismaService } from '../../prisma.service';
import { generateFieldId } from '../../utils/id-generator';
import { convertNameToValidCharacter } from '../../utils/name-conversion';
import { preservedFieldName } from './constant';
import type { CreateFieldDto } from './create-field.dto';

@Injectable()
export class FieldService {
  constructor(private readonly prisma: PrismaService) {}

  async multipleGenerateValidDbFieldName(tableId: string, names: string[]): Promise<string[]> {
    const validNames = names.map((name) => convertNameToValidCharacter(name));
    let newValidNames = [...validNames];
    let index = 1;

    // eslint-disable-next-line no-constant-condition
    while (true) {
      const exist = await this.prisma.field.count({
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

  private generateDbCreatePromise(
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

    return this.prisma.field.create({ data });
  }

  async generateMultipleCreateFieldPromise(
    tableId: string,
    multipleCreateFieldDto: CreateFieldDto[]
  ) {
    const dbFieldNames = await this.multipleGenerateValidDbFieldName(
      tableId,
      multipleCreateFieldDto.map((dto) => dto.name)
    );

    const prismaPromises = multipleCreateFieldDto.map((createFieldDto, i) =>
      this.generateDbCreatePromise(tableId, { ...createFieldDto, dbFieldName: dbFieldNames[i] })
    );

    const { dbTableName } = await this.prisma.tableMeta.findUniqueOrThrow({
      where: {
        id: tableId,
      },
      select: {
        dbTableName: true,
      },
    });

    const createFieldSQL = dbFieldNames
      .map((dbFieldName) => {
        return `ADD ${dbFieldName} ${'TEXT'}`;
      })
      .join('\n');

    return [
      ...prismaPromises,
      this.prisma.$executeRawUnsafe(`
        ALTER TABLE ${dbTableName}
        ${createFieldSQL};
      `),
    ];
  }

  async createField(tableId: string, createFieldDto: CreateFieldDto) {
    return this.multipleCreateField(tableId, [createFieldDto]);
  }

  // we have to support multiple action, because users will do it in batch
  async multipleCreateField(tableId: string, multipleCreateFieldDto: CreateFieldDto[]) {
    const prismaPromises = await this.generateMultipleCreateFieldPromise(
      tableId,
      multipleCreateFieldDto
    );
    return await this.prisma.$transaction(prismaPromises);
  }

  async getField(tableId: string, fieldId: string) {
    return `get tableId: ${tableId} fieldId: ${fieldId}`;
  }
}
