import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import type { Table, Prisma } from '@prisma/client';
import { sqliteDb } from '@teable-group/db-main-prisma';
import { PrismaService } from '../../prisma.service';
import type { CreateTableDto } from './create-table.dto';

@Injectable()
export class TableService {
  constructor(private prisma: PrismaService) {}

  async createTable(createTableDto: CreateTableDto): Promise<Table> {
    const dbTableName = createTableDto.name;
    const data: Prisma.TableCreateInput = {
      ...createTableDto,
      dbTableName,
    };

    const tableIndexData = await this.prisma.table.create({
      data,
    });

    const stmt = sqliteDb.prepare(`
      CREATE TABLE ${dbTableName} (
        id INT NOT NULL,
        field1 TEXT,
        field2 TEXT,
        field3 TEXT,
        PRIMARY KEY (id)
      );
    `);

    const info = stmt.run();

    console.log(info);

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
