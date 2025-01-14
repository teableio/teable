import { Injectable } from '@nestjs/common';
import { CellValueType } from '@teable/core';
import { PrismaService } from '@teable/db-main-prisma';
import { TableIndex, type ITableIndexType, type IToggleIndexRo } from '@teable/openapi';
import { Knex } from 'knex';
import { InjectModel } from 'nest-knexjs';
import { ClsService } from 'nestjs-cls';
import { IThresholdConfig, ThresholdConfig } from '../../configs/threshold.config';
import { InjectDbProvider } from '../../db-provider/db.provider';
import { IDbProvider } from '../../db-provider/db.provider.interface';
import type { IClsStore } from '../../types/cls';
import type { IFieldInstance } from '../field/model/factory';
import { createFieldInstanceByRaw } from '../field/model/factory';

@Injectable()
export class TableIndexService {
  constructor(
    private readonly cls: ClsService<IClsStore>,
    private readonly prismaService: PrismaService,
    @ThresholdConfig() private readonly thresholdConfig: IThresholdConfig,
    @InjectDbProvider() private readonly dbProvider: IDbProvider,
    @InjectModel('CUSTOM_KNEX') private readonly knex: Knex
  ) {}

  async getSearchStatus(tableId: string) {
    const { dbTableName } = await this.prismaService.tableMeta.findUniqueOrThrow({
      where: {
        id: tableId,
      },
      select: {
        dbTableName: true,
      },
    });
    const sql = this.dbProvider.getExistFtsIndexSql(
      this.knex.queryBuilder(),
      dbTableName
    ) as string;
    const result = await this.prismaService.$queryRawUnsafe<{ exists: boolean }[]>(sql);
    return Boolean(result.pop()?.exists);
  }

  async getActivatedTableIndexes(tableId: string): Promise<TableIndex[]> {
    const { dbTableName } = await this.prismaService.tableMeta.findUniqueOrThrow({
      where: {
        id: tableId,
      },
      select: {
        dbTableName: true,
      },
    });

    const trgmIndexSql = this.dbProvider.trgmIndex().getExistFtsIndexSql(dbTableName);
    const [{ exists: trgmIndexExist }] = await this.prismaService.$queryRawUnsafe<
      {
        exists: boolean;
      }[]
    >(trgmIndexSql);

    const result: ITableIndexType[] = [];

    if (trgmIndexExist) {
      result.push(TableIndex.trgmIndex);
    }

    return result;
  }

  async toggleSearchIndex(tableId: string, enableRo: IToggleIndexRo) {
    const status = await this.getActivatedTableIndexes(tableId);

    const { type } = enableRo;
    const fieldsRaw = await this.prismaService.field.findMany({
      where: {
        tableId,
        deletedTime: null,
      },
    });

    const fields = fieldsRaw
      .map((field) => createFieldInstanceByRaw(field))
      .filter(({ cellValueType }) => cellValueType !== CellValueType.Boolean) as IFieldInstance[];

    const { dbTableName } = await this.prismaService.tableMeta.findFirstOrThrow({
      where: {
        id: tableId,
      },
      select: {
        dbTableName: true,
      },
    });

    if (type === TableIndex.trgmIndex) {
      await this.toggleTrgmIndex(dbTableName, fields, !status.includes(type));
    }
  }

  async toggleTrgmIndex(dbTableName: string, fields: IFieldInstance[], toEnable: boolean) {
    if (toEnable) {
      const sqls = this.dbProvider.trgmIndex().getCreateIndexSql(dbTableName, fields);
      return await this.prismaService.$tx(
        async (prisma) => {
          for (let i = 0; i < sqls.length; i++) {
            const sql = sqls[i];
            try {
              await prisma.$executeRawUnsafe(sql);
            } catch (error) {
              console.error('toggleTrgmIndex:create:error', sql);
              throw error;
            }
          }
        },
        { timeout: this.thresholdConfig.bigTransactionTimeout }
      );
    }

    const sql = this.dbProvider.trgmIndex().getDropIndexSql(dbTableName);
    try {
      return await this.prismaService.$executeRawUnsafe(sql);
    } catch (error) {
      console.error('toggleTrgmIndex:drop:error', sql);
      throw error;
    }
  }
}
