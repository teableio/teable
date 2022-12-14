import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import type { TableMeta, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma.service';
import { generateTableId, generateViewId } from '../../utils/id-generator';
import { convertNameToValidCharacter } from '../../utils/name-conversion';
import { getDbFieldTypeByFieldType } from '../../utils/type-transform';
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

  async createTable(createTableDto: CreateTableDto): Promise<TableMeta> {
    const validDbTableName = this.generateValidDbTableName(createTableDto.name);
    const tableId = generateTableId();
    const viewId = generateViewId();
    const rowIndexFieldName = this.viewService.getRowIndexFieldName(viewId);
    const dbTableName = `${validDbTableName}_${tableId}`;
    const data: Prisma.TableMetaCreateInput = {
      id: tableId,
      name: createTableDto.name,
      dbTableName,
      createdBy: 'admin',
      lastModifiedBy: 'admin',
    };

    const createFieldTask = await this.fieldService.generateMultipleCreateFieldPromise(
      tableId,
      DEFAULT_FIELDS
    );

    const createViewTask = await this.viewService.generateCreateViewPromise(tableId, DEFAULT_VIEW);

    const tableSQL = DEFAULT_FIELDS.map((field) => {
      return `${field.name} ${getDbFieldTypeByFieldType(field.type)},`;
    }).join('\n');

    const [tableIndexData] = await this.prisma.$transaction([
      // 1. create table meta
      this.prisma.tableMeta.create({
        data,
      }),
      // 2. create field for table
      ...createFieldTask,
      // 3. create view for table
      ...createViewTask,
      // 4. create a real db table
      this.prisma.$executeRawUnsafe(`
        CREATE TABLE ${dbTableName} (
          ${tableSQL}
          __id TEXT NOT NULL UNIQUE,
          __autoNumber INTEGER PRIMARY KEY AUTOINCREMENT,
          ${rowIndexFieldName} NOT NULL UNIQUE,
          __createdTime DATETIME,
          __lastModifiedTime DATETIME,
          __createdBy TEXT,
          __lastModifiedBy TEXT
        );
      `),
    ]);

    return tableIndexData;
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
