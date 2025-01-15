import { Injectable } from '@nestjs/common';
import { CellValueType } from '@teable/core';
import { PrismaService } from '@teable/db-main-prisma';
import { TableIndex } from '@teable/openapi';
import type { IGetAbnormalVo, ITableIndexType, IToggleIndexRo } from '@teable/openapi';
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

  async getActivatedTableIndexes(tableId: string): Promise<TableIndex[]> {
    const { dbTableName } = await this.prismaService.tableMeta.findUniqueOrThrow({
      where: {
        id: tableId,
      },
      select: {
        dbTableName: true,
      },
    });

    const trgmIndexSql = this.dbProvider.trgmIndex().getExistTableIndexSql(dbTableName);
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

  async deleteFieldIndex(tableId: string, dbFieldName: string) {
    const tableRaw = await this.prismaService.txClient().tableMeta.findFirstOrThrow({
      where: { id: tableId, deletedTime: null },
      select: { dbTableName: true },
    });
    const { dbTableName } = tableRaw;
    const index = await this.getActivatedTableIndexes(tableId);
    if (index.includes(TableIndex.trgmIndex)) {
      const sql = this.dbProvider.trgmIndex().getDeleteSingleIndexSql(dbTableName, dbFieldName);
      await this.prismaService.$executeRawUnsafe(sql);
    }
  }

  async createFieldSingleIndex(tableId: string, fieldInstance: IFieldInstance) {
    const tableRaw = await this.prismaService.txClient().tableMeta.findFirstOrThrow({
      where: { id: tableId, deletedTime: null },
      select: { dbTableName: true },
    });
    const { dbTableName } = tableRaw;
    const index = await this.getActivatedTableIndexes(tableId);
    const sql = this.dbProvider.trgmIndex().createSingleIndexSql(dbTableName, fieldInstance);
    if (index.includes(TableIndex.trgmIndex) && sql) {
      await this.prismaService.$executeRawUnsafe(sql);
    }
  }

  async updateFieldIndexName(tableId: string, oldDbFieldName: string, newDbFieldName: string) {
    const tableRaw = await this.prismaService.txClient().tableMeta.findFirstOrThrow({
      where: { id: tableId, deletedTime: null },
      select: { dbTableName: true },
    });
    const { dbTableName } = tableRaw;
    const index = await this.getActivatedTableIndexes(tableId);
    if (index.includes(TableIndex.trgmIndex)) {
      const sql = this.dbProvider
        .trgmIndex()
        .getUpdateSingleIndexNameSql(dbTableName, oldDbFieldName, newDbFieldName);
      await this.prismaService.$executeRawUnsafe(sql);
    }
  }

  async getIndexInfoByIndexType(tableId: string) {
    const tableRaw = await this.prismaService.txClient().tableMeta.findFirstOrThrow({
      where: { id: tableId, deletedTime: null },
      select: { dbTableName: true },
    });
    const { dbTableName } = tableRaw;

    const sql = this.dbProvider.trgmIndex().getIndexInfoSql(dbTableName);
    return this.prismaService.$queryRawUnsafe<unknown[]>(sql);
  }

  async getAbnormalTableIndex(tableId: string, type: TableIndex) {
    const index = await this.getActivatedTableIndexes(tableId);
    if (!index.includes(type)) {
      return [] as IGetAbnormalVo;
    }

    const fieldsRaw = await this.prismaService.field.findMany({
      where: {
        tableId,
        deletedTime: null,
      },
    });

    const tableRaw = await this.prismaService.tableMeta.findFirstOrThrow({
      where: {
        id: tableId,
      },
    });

    const { dbTableName } = tableRaw;

    const fieldInstances = fieldsRaw.map((field) => createFieldInstanceByRaw(field));

    const indexInfo = await this.getIndexInfoByIndexType(tableId);

    return await this.dbProvider
      .trgmIndex()
      .getAbnormalIndex(dbTableName, fieldInstances, indexInfo);
  }

  async repairIndex(tableId: string, type: TableIndex) {
    const tableRaw = await this.prismaService.tableMeta.findFirstOrThrow({
      where: {
        id: tableId,
        deletedTime: null,
      },
      select: {
        dbTableName: true,
      },
    });

    const fieldsRaw = await this.prismaService.field.findMany({
      where: {
        tableId,
        deletedTime: null,
      },
    });
    const { dbTableName } = tableRaw;
    const dropSql = this.dbProvider.trgmIndex().getDropIndexSql(dbTableName);
    const fieldInstances = fieldsRaw.map((field) => createFieldInstanceByRaw(field));
    const createSqls = this.dbProvider.trgmIndex().getCreateIndexSql(dbTableName, fieldInstances);
    this.prismaService.$tx(async (prisma) => {
      await prisma.$executeRawUnsafe(dropSql);
      for (let i = 0; i < createSqls.length; i++) {
        await prisma.$executeRawUnsafe(createSqls[i]);
      }
    });
  }
}
