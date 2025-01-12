import { Injectable } from '@nestjs/common';
import { PrismaService } from '@teable/db-main-prisma';
import { Knex } from 'knex';
import { InjectModel } from 'nest-knexjs';
import { ClsService } from 'nestjs-cls';
import { InjectDbProvider } from '../../db-provider/db.provider';
import { IDbProvider } from '../../db-provider/db.provider.interface';
import type { IClsStore } from '../../types/cls';

@Injectable()
export class TableFullTextService {
  constructor(
    private readonly cls: ClsService<IClsStore>,
    private readonly prismaService: PrismaService,
    @InjectDbProvider() private readonly dbProvider: IDbProvider,
    @InjectModel('CUSTOM_KNEX') private readonly knex: Knex
  ) {}

  async getFullTextSearchStatus(tableId: string) {
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
}
