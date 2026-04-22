/* eslint-disable sonarjs/no-duplicate-string */
import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { CellValueType, FieldType, HttpErrorCode } from '@teable/core';
import { PrismaService } from '@teable/db-main-prisma';
import { TableIndex } from '@teable/openapi';
import type { IGetAbnormalVo, ITableIndexType, IToggleIndexRo } from '@teable/openapi';
import { Knex } from 'knex';
import { InjectModel } from 'nest-knexjs';
import { ClsService } from 'nestjs-cls';
import { IThresholdConfig, ThresholdConfig } from '../../configs/threshold.config';
import { CustomHttpException } from '../../custom.exception';
import { InjectDbProvider } from '../../db-provider/db.provider';
import { IDbProvider } from '../../db-provider/db.provider.interface';
import type { IClsStore } from '../../types/cls';
import type { IFieldInstance } from '../field/model/factory';
import { createFieldInstanceByRaw } from '../field/model/factory';

const unSupportTableIndex = 'Unsupport table index type';

@Injectable()
export class TableIndexService {
  private logger = new Logger(TableIndexService.name);

  constructor(
    private readonly cls: ClsService<IClsStore>,
    private readonly prismaService: PrismaService,
    @ThresholdConfig() private readonly thresholdConfig: IThresholdConfig,
    @InjectDbProvider() private readonly dbProvider: IDbProvider,
    @InjectModel('CUSTOM_KNEX') private readonly knex: Knex
  ) {}

  async getSearchIndexFields(tableId: string): Promise<IFieldInstance[]> {
    const fieldsRaw = await this.prismaService.field.findMany({
      where: {
        tableId,
        deletedTime: null,
      },
    });
    return fieldsRaw
      .filter(
        ({ cellValueType, type }) =>
          cellValueType !== CellValueType.DateTime && type !== FieldType.Button
      )
      .map((field) => createFieldInstanceByRaw(field))
      .map((field) => ({
        ...field,
        isStructuredCellValue: field.isStructuredCellValue,
      })) as IFieldInstance[];
  }

  async getActivatedTableIndexes(
    tableId: string,
    type: TableIndex = TableIndex.search
  ): Promise<TableIndex[]> {
    const { dbTableName } = await this.prismaService.txClient().tableMeta.findUniqueOrThrow({
      where: {
        id: tableId,
      },
      select: {
        dbTableName: true,
      },
    });

    if (type === TableIndex.search) {
      const searchIndexSql = this.dbProvider.searchIndex().getExistTableIndexSql(dbTableName);
      const [{ exists: searchIndexExist }] = await this.prismaService.$queryRawUnsafe<
        {
          exists: boolean;
        }[]
      >(searchIndexSql);

      const result: ITableIndexType[] = [];

      if (searchIndexExist) {
        result.push(TableIndex.search);
      }

      return result;
    } else {
      throw new CustomHttpException(
        'Table index type not supported',
        HttpErrorCode.VALIDATION_ERROR,
        {
          localization: {
            i18nKey: 'httpErrors.table.notSupportTableIndex',
          },
        }
      );
    }
  }

  async toggleIndex(tableId: string, enableRo: IToggleIndexRo) {
    const { type } = enableRo;
    if (type !== TableIndex.search) {
      throw new CustomHttpException(
        'Table index type not supported',
        HttpErrorCode.VALIDATION_ERROR,
        {
          localization: {
            i18nKey: 'httpErrors.table.notSupportTableIndex',
          },
        }
      );
    }

    const index = await this.getActivatedTableIndexes(tableId);

    const fields = await this.getSearchIndexFields(tableId);

    const { dbTableName } = await this.prismaService.tableMeta.findFirstOrThrow({
      where: {
        id: tableId,
      },
      select: {
        dbTableName: true,
      },
    });

    await this.toggleSearchIndex(dbTableName, fields, !index.includes(type));
  }

  async toggleSearchIndex(dbTableName: string, fields: IFieldInstance[], toEnable: boolean) {
    if (toEnable) {
      const sqls = this.dbProvider.searchIndex().getCreateIndexSql(dbTableName, fields);
      return await this.prismaService.$tx(
        async (prisma) => {
          for (let i = 0; i < sqls.length; i++) {
            const sql = sqls[i];
            try {
              await prisma.$executeRawUnsafe(sql);
            } catch (error) {
              console.error('toggleSearchIndex:create:error', sql);
              throw new CustomHttpException(
                `Create table index error: ${error instanceof Error ? error.message : 'Unknown error'}`,
                HttpErrorCode.VALIDATION_ERROR,
                {
                  localization: {
                    i18nKey: 'httpErrors.table.createTableIndexError',
                  },
                }
              );
            }
          }
        },
        { timeout: this.thresholdConfig.bigTransactionTimeout }
      );
    }

    const sql = this.dbProvider.searchIndex().getDropIndexSql(dbTableName);
    try {
      return await this.prismaService.$executeRawUnsafe(sql);
    } catch (error) {
      console.error('toggleSearchIndex:drop:error', sql);
      throw new CustomHttpException(
        `Drop table index error: ${error instanceof Error ? error.message : 'Unknown error'}`,
        HttpErrorCode.VALIDATION_ERROR,
        {
          localization: {
            i18nKey: 'httpErrors.table.dropTableIndexError',
          },
        }
      );
    }
  }

  async deleteSearchFieldIndex(tableId: string, field: IFieldInstance) {
    const tableRaw = await this.prismaService.txClient().tableMeta.findFirstOrThrow({
      where: { id: tableId, deletedTime: null },
      select: { dbTableName: true },
    });
    const { dbTableName } = tableRaw;
    const index = await this.getActivatedTableIndexes(tableId);
    if (index.includes(TableIndex.search)) {
      const sql = this.dbProvider.searchIndex().getDeleteSingleIndexSql(dbTableName, field);
      // Execute within current transaction if present to keep boundaries consistent
      await this.prismaService.txClient().$executeRawUnsafe(sql);
    }
  }

  async createSearchFieldSingleIndex(tableId: string, fieldInstance: IFieldInstance) {
    if (
      fieldInstance.cellValueType === CellValueType.DateTime ||
      fieldInstance.type === FieldType.Button
    ) {
      return;
    }
    const tableRaw = await this.prismaService.txClient().tableMeta.findFirstOrThrow({
      where: { id: tableId, deletedTime: null },
      select: { dbTableName: true },
    });
    const { dbTableName } = tableRaw;
    const index = await this.getActivatedTableIndexes(tableId);
    const sql = this.dbProvider.searchIndex().createSingleIndexSql(dbTableName, fieldInstance);
    if (index.includes(TableIndex.search) && sql) {
      await this.prismaService.txClient().$executeRawUnsafe(sql);
    }
  }

  async updateSearchFieldIndexName(
    tableId: string,
    oldField: Pick<IFieldInstance, 'id' | 'dbFieldName'>,
    newField: Pick<IFieldInstance, 'id' | 'dbFieldName'>
  ) {
    const tableRaw = await this.prismaService.txClient().tableMeta.findFirstOrThrow({
      where: { id: tableId, deletedTime: null },
      select: { dbTableName: true },
    });
    const { dbTableName } = tableRaw;
    const index = await this.getActivatedTableIndexes(tableId);
    if (index.includes(TableIndex.search)) {
      const sql = this.dbProvider
        .searchIndex()
        .getUpdateSingleIndexNameSql(dbTableName, oldField, newField);
      await this.prismaService.$executeRawUnsafe(sql);
    }
  }

  async getIndexInfo(tableId: string) {
    const tableRaw = await this.prismaService.txClient().tableMeta.findFirstOrThrow({
      where: { id: tableId, deletedTime: null },
      select: { dbTableName: true },
    });
    const { dbTableName } = tableRaw;

    const sql = this.dbProvider.searchIndex().getIndexInfoSql(dbTableName);
    return this.prismaService.$queryRawUnsafe<unknown[]>(sql);
  }

  async getAbnormalTableIndex(tableId: string, type: TableIndex) {
    const index = await this.getActivatedTableIndexes(tableId);
    if (!index.includes(type)) {
      return [] as IGetAbnormalVo;
    }

    const tableRaw = await this.prismaService.tableMeta.findFirstOrThrow({
      where: {
        id: tableId,
      },
    });

    const { dbTableName } = tableRaw;

    const fieldInstances = await this.getSearchIndexFields(tableId);

    const indexInfo = await this.getIndexInfo(tableId);

    return await this.dbProvider
      .searchIndex()
      .getAbnormalIndex(dbTableName, fieldInstances, indexInfo);
  }

  async repairIndex(tableId: string, type: TableIndex) {
    if (type !== TableIndex.search) {
      throw new CustomHttpException(
        'Table index type not supported',
        HttpErrorCode.VALIDATION_ERROR,
        {
          localization: {
            i18nKey: 'httpErrors.table.notSupportTableIndex',
          },
        }
      );
    }

    const tableRaw = await this.prismaService.tableMeta.findFirstOrThrow({
      where: {
        id: tableId,
        deletedTime: null,
      },
      select: {
        dbTableName: true,
      },
    });

    const { dbTableName } = tableRaw;
    const dropSql = this.dbProvider.searchIndex().getDropIndexSql(dbTableName);
    const fieldInstances = await this.getSearchIndexFields(tableId);
    const createSqls = this.dbProvider.searchIndex().getCreateIndexSql(dbTableName, fieldInstances);
    await this.prismaService.$tx(
      async (prisma) => {
        await prisma.$executeRawUnsafe(dropSql);
        for (let i = 0; i < createSqls.length; i++) {
          await prisma.$executeRawUnsafe(createSqls[i]);
        }
      },
      { timeout: this.thresholdConfig.bigTransactionTimeout }
    );
  }
}
