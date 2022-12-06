import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import type { Table, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma.service';
import type { CreateTableDto } from './create-table.dto';

@Injectable()
export class TableService {
  constructor(private prisma: PrismaService) {}

  async createTable(createTableDto: CreateTableDto): Promise<Table> {
    const data: Prisma.TableCreateInput = {
      ...createTableDto,
      dbTableName: createTableDto.name,
    };

    return this.prisma.table.create({
      data,
    });
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
