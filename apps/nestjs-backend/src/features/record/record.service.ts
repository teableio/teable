import { HttpException, Injectable } from '@nestjs/common';
import type { Prisma } from '@teable-group/db-main-prisma';
import { PrismaService } from '../../prisma.service';
import { generateRecordId } from '../../utils/id-generator';
import { ROW_INDEX_FIELD_PREFIX } from '../view/constant';
import type { CreateRecordsDto } from './create-records.dto';

type IUserFields = { id: string; dbFieldName: string }[];

@Injectable()
export class RecordService {
  constructor(private readonly prisma: PrismaService) {}

  private async getRowIndexFieldNames(prisma: Prisma.TransactionClient, tableId: string) {
    // get rowIndexFieldName by select all views, combine field prefix and ids;
    const views = await prisma.view.findMany({
      where: {
        tableId,
      },
      select: {
        id: true,
      },
    });

    return views.map((view) => `${ROW_INDEX_FIELD_PREFIX}_${view.id}`);
  }

  // get fields create by users
  private async getUserFields(
    prisma: Prisma.TransactionClient,
    tableId: string,
    createRecordsDto: CreateRecordsDto
  ) {
    const fieldIdSet = createRecordsDto.records.reduce<Set<string>>((acc, record) => {
      const fieldIds = Object.keys(record.fields);
      fieldIds.forEach((fieldId) => acc.add(fieldId));
      return acc;
    }, new Set());

    const userFieldIds = Array.from(fieldIdSet);

    const userFields = await prisma.field.findMany({
      where: {
        tableId,
        id: { in: userFieldIds },
      },
      select: {
        id: true,
        dbFieldName: true,
      },
    });

    console.log('userFields: ', userFields, userFieldIds);
    if (userFields.length !== userFieldIds.length) {
      throw new HttpException('some fields not found', 400);
    }

    return userFields;
  }

  async getDbValueMatrix(
    prisma: Prisma.TransactionClient,
    dbTableName: string,
    userFields: IUserFields,
    rowIndexFieldNames: string[],
    createRecordsDto: CreateRecordsDto
  ) {
    // eslint-disable-next-line @typescript-eslint/naming-convention
    const queryResult = await prisma.$queryRawUnsafe<[{ 'MAX(__autoNumber)': null | bigint }]>(`
      SELECT MAX(__autoNumber)
      FROM ${dbTableName};
    `);
    const rowCount = Number(queryResult[0]['MAX(__autoNumber)']);
    console.log('queryResult: ', queryResult);
    const dbValueMatrix: unknown[][] = [];
    for (let i = 0; i < createRecordsDto.records.length; i++) {
      const recordData = createRecordsDto.records[i].fields;
      // 1. collect cellValues
      const recordValues = userFields.map<unknown>((field) => {
        const cellValue = recordData[field.id];
        if (cellValue == null) {
          return null;
        }
        return cellValue;
      });

      // 2. generate rowIndexValues
      const rowIndexValues = rowIndexFieldNames.map(() => rowCount + i);

      // 3. generate id, createdTime, createdBy
      const systemValues = [generateRecordId(), new Date(), 'admin'];

      dbValueMatrix.push([...recordValues, ...rowIndexValues, ...systemValues]);
    }
    return dbValueMatrix;
  }

  async multipleCreateRecordTransaction(
    prisma: Prisma.TransactionClient,
    tableId: string,
    createRecordsDto: CreateRecordsDto
  ) {
    const { dbTableName } = await prisma.tableMeta.findUniqueOrThrow({
      where: {
        id: tableId,
      },
      select: {
        dbTableName: true,
      },
    });

    const userFields = await this.getUserFields(prisma, tableId, createRecordsDto);
    const rowIndexFieldNames = await this.getRowIndexFieldNames(prisma, tableId);

    const allDbFieldNames = [
      ...userFields.map((field) => field.dbFieldName),
      ...rowIndexFieldNames,
      ...['__id', '__createdTime', '__createdBy'],
    ];

    console.log('allDbFieldNames: ', allDbFieldNames);

    const dbValueMatrix = await this.getDbValueMatrix(
      prisma,
      dbTableName,
      userFields,
      rowIndexFieldNames,
      createRecordsDto
    );

    const dbFieldSQL = allDbFieldNames.join(', ');
    const dbValuesSQL = dbValueMatrix
      .map((dbValues) => `(${dbValues.map((value) => JSON.stringify(value)).join(', ')})`)
      .join(',\n');

    console.log('allDbFieldNames: ', allDbFieldNames);
    console.log('dbFieldSQL: ', dbFieldSQL);
    console.log('dbValueMatrix: ', dbValueMatrix);
    console.log('dbValuesSQL: ', dbValuesSQL);

    const result = await prisma.$executeRawUnsafe(`
      INSERT INTO ${dbTableName} (${dbFieldSQL})
      VALUES 
        ${dbValuesSQL};
    `);

    console.log('sqlExecuteResult: ', result);

    return result;
  }

  // we have to support multiple action, because users will do it in batch
  async multipleCreateRecords(tableId: string, createRecordsDto: CreateRecordsDto) {
    return await this.prisma.$transaction(async (prisma) => {
      return this.multipleCreateRecordTransaction(prisma, tableId, createRecordsDto);
    });
  }

  async getRecord(tableId: string, recordId: string) {
    return `get tableId: ${tableId} RecordId: ${recordId}`;
  }
}
