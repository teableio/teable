import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { generateTableId } from '@teable-group/core';
import type { Prisma, TableMeta } from '@teable-group/db-main-prisma';
import { visualTableSql } from '@teable-group/db-main-prisma';
import { PrismaService } from '../../prisma.service';
import { convertNameToValidCharacter } from '../../utils/name-conversion';
import { FieldService } from '../field/field.service';
import { createFieldInstance } from '../field/model/factory';
import { RecordService } from '../record/record.service';
import { ViewService } from '../view/view.service';
import { DEFAULT_FIELDS, DEFAULT_RECORDS, DEFAULT_VIEW } from './constant';
import type { CreateTableDto } from './create-table.dto';

const tableNamePrefix = 'visual';

@Injectable()
export class TableService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly viewService: ViewService,
    private readonly fieldService: FieldService,
    private readonly recordService: RecordService
  ) {}

  generateValidDbTableName(name: string) {
    const validInputName = convertNameToValidCharacter(name);
    return `${tableNamePrefix}_${validInputName}`;
  }

  private async createDBTable(
    prisma: Prisma.TransactionClient,
    tableId: string,
    createTableDto: CreateTableDto
  ) {
    const validDbTableName = this.generateValidDbTableName(createTableDto.name);
    const dbTableName = `${validDbTableName}_${tableId}`;
    const data: Prisma.TableMetaCreateInput = {
      id: tableId,
      name: createTableDto.name,
      dbTableName,
      createdBy: 'admin',
      lastModifiedBy: 'admin',
      version: 1,
    };
    const tableMeta = await prisma.tableMeta.create({
      data,
    });
    console.log('table meta create succeed: ', tableMeta);

    // create a real db table
    const dbTable = await prisma.$executeRawUnsafe(visualTableSql(dbTableName));
    console.log('dbTable create succeed: ', dbTable);
    return tableMeta;
  }

  async createTable(createTableDto: CreateTableDto): Promise<TableMeta> {
    const tableId = generateTableId();

    return await this.prisma.$transaction(async (prisma) => {
      // 1. create db table
      const tableMeta = await this.createDBTable(prisma, tableId, createTableDto);

      // 2. create field for table
      await this.fieldService.multipleCreateFieldsTransaction(
        prisma,
        tableId,
        DEFAULT_FIELDS.map(createFieldInstance)
      );

      // 3. create view for table
      await this.viewService.createViewTransaction(prisma, tableId, DEFAULT_VIEW);

      // 4. create records for table
      await this.recordService.multipleCreateRecordTransaction(prisma, tableId, DEFAULT_RECORDS);

      return tableMeta;
    });
  }

  async getTable(tableId: string): Promise<TableMeta> {
    const table = await this.prisma.tableMeta.findUnique({
      where: {
        id: tableId,
      },
    });

    if (!table) {
      throw new HttpException('The table you are looking does not exist', HttpStatus.NOT_FOUND);
    }
    return table;
  }

  /**
   * ! dangerous function, table will be dropped, and all data will be lost
   */
  async deleteTableArbitrary(tableId: string) {
    return await this.prisma.$transaction(async (prisma) => {
      // delete field for table
      await prisma.field.deleteMany({
        where: { tableId },
      });

      // delete view for table
      await prisma.view.deleteMany({
        where: { tableId },
      });

      // clear tableMeta
      const deleteTable = await prisma.tableMeta.delete({
        where: { id: tableId },
      });
      const dbTableName = deleteTable.dbTableName;
      console.log('Dropping: ', dbTableName);

      // drop db table
      await prisma.$executeRawUnsafe(`DROP TABLE ${dbTableName}`);
    });
  }
}
