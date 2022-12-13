import { Injectable } from '@nestjs/common';
import type { Prisma } from '@teable-group/db-main-prisma';
import { preservedFieldName } from '../../constant/field';
import { PrismaService } from '../../prisma.service';
import { generateFieldId } from '../../utils/id-generator';
import { convertNameToValidCharacter } from '../../utils/name-conversion';
import type { CreateFieldDto } from './create-field.dto';

@Injectable()
export class FieldService {
  constructor(private readonly prisma: PrismaService) {}

  async generateValidDbFieldName(tableId: string, name: string): Promise<string> {
    let validName = convertNameToValidCharacter(name);
    let index = 1;

    // eslint-disable-next-line no-constant-condition
    while (true) {
      const exist = await this.prisma.field.count({
        where: {
          tableId,
          dbFieldName: validName,
        },
      });
      if (!exist && !preservedFieldName.has(validName)) {
        break;
      }
      validName = `${name}_${index++}`;
    }

    return validName;
  }

  async createField(tableId: string, createFieldDto: CreateFieldDto) {
    const { name } = createFieldDto;
    const dbFieldName = await this.generateValidDbFieldName(tableId, name);

    const data: Prisma.FieldCreateInput = {
      id: generateFieldId(),
      table: {
        connect: {
          id: tableId,
        },
      },
      name,
      dbFieldName: dbFieldName,
      createBy: 'admin',
      updateBy: 'admin',
    };

    const { dbTableName } = await this.prisma.tableMeta.findUniqueOrThrow({
      where: {
        id: tableId,
      },
      select: {
        dbTableName: true,
      },
    });

    const [tableIndexData] = await this.prisma.$transaction([
      this.prisma.field.create({
        data,
      }),
      this.prisma.$executeRawUnsafe(`
        ALTER TABLE ${dbTableName}
        ADD ${dbFieldName} ${'TEXT'};
      `),
    ]);

    return tableIndexData;
  }

  async getField(tableId: string, fieldId: string) {
    return `get tableId: ${tableId} fieldId: ${fieldId}`;
  }
}
