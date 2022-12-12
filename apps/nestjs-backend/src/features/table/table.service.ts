import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import type { Table, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma.service';
import { generateTableId } from '../../utils/id-generator';
import type { CreateTableDto } from './create-table.dto';

const tableNamePrefix = 'visual';

@Injectable()
export class TableService {
  constructor(private prisma: PrismaService) {}

  generateValidDbTableName(name: string) {
    const matchedArray = name.match(/\w*/g);
    const validInputName = matchedArray?.join('').substring(0, 10) || 'unnamed';
    return `${tableNamePrefix}_${validInputName}`;
  }

  async createTable(createTableDto: CreateTableDto): Promise<Table> {
    const validDbTableName = this.generateValidDbTableName(createTableDto.name);
    const tableId = generateTableId();
    const dbTableName = `${validDbTableName}_${tableId}`;
    const data: Prisma.TableCreateInput = {
      id: tableId,
      name: createTableDto.name,
      dbTableName,
    };

    const [tableIndexData] = await this.prisma.$transaction([
      this.prisma.table.create({
        data,
      }),
      this.prisma.$executeRawUnsafe(`
        CREATE TABLE ${dbTableName} (
          id INT NOT NULL,
          field1 TEXT,
          field2 TEXT,
          field3 TEXT,
          PRIMARY KEY (id)
        );
      `),
    ]);

    return tableIndexData;
  }

  async getTable(tableId: string): Promise<Table> {
    const table = await this.prisma.table.findUnique({
      where: {
        id: tableId,
      },
    });

    if (!table) {
      throw new HttpException('The table you are looking does not exist', HttpStatus.NOT_FOUND);
    }
    return table;
  }
}
