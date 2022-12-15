import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import type { TableMeta, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma.service';
import { generateTableId } from '../../utils/id-generator';
import { convertNameToValidCharacter } from '../../utils/name-conversion';
import { FieldService } from '../field/field.service';
import { ViewService } from '../view/view.service';
import { DEFAULT_FIELDS, DEFAULT_VIEW } from './constant';
import type { CreateTableDto } from './create-table.dto';

const tableNamePrefix = 'visual';

@Injectable()
export class TableService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly viewService: ViewService,
    private readonly fieldService: FieldService
  ) {}

  generateValidDbTableName(name: string) {
    const validInputName = convertNameToValidCharacter(name);
    return `${tableNamePrefix}_${validInputName}`;
  }

  private async createDefaultField(prisma: Prisma.TransactionClient, tableId: string) {
    const fieldPromise = await this.fieldService.generateMultipleCreateFieldPromise(
      prisma,
      tableId,
      DEFAULT_FIELDS
    );

    for (const index in fieldPromise) {
      const result = await fieldPromise[index];
      console.log(`field task ${+index + 1} / ${fieldPromise.length} succeed: `, result);
    }
  }

  private async createDefaultView(prisma: Prisma.TransactionClient, tableId: string) {
    const viewPromise = await this.viewService.generateCreateViewPromise(
      prisma,
      tableId,
      DEFAULT_VIEW
    );

    for (const index in viewPromise) {
      const result = await viewPromise[index];
      console.log(`view task ${+index + 1} / ${viewPromise.length} succeed: `, result);
    }
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
    };
    const tableMeta = await prisma.tableMeta.create({
      data,
    });
    console.log('table meta create succeed: ', tableMeta);

    // 2. create a real db table
    const dbTable = await prisma.$executeRawUnsafe(`
      CREATE TABLE ${dbTableName} (
        __id TEXT NOT NULL UNIQUE,
        __autoNumber INTEGER PRIMARY KEY AUTOINCREMENT,
        __createdTime DATETIME,
        __lastModifiedTime DATETIME,
        __createdBy TEXT,
        __lastModifiedBy TEXT
      );
    `);
    console.log('dbTable create succeed: ', dbTable);
    return tableMeta;
  }

  async createTable(createTableDto: CreateTableDto): Promise<TableMeta> {
    const tableId = generateTableId();

    return await this.prisma.$transaction(async (prisma) => {
      // 1. create db table

      const tableMeta = await this.createDBTable(prisma, tableId, createTableDto);

      // 2. create field for table
      await this.createDefaultField(prisma, tableId);

      // 3. create view for table
      await this.createDefaultView(prisma, tableId);

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
}
