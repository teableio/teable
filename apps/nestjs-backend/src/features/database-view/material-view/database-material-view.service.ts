import { Injectable } from '@nestjs/common';
import { PrismaService } from '@teable/db-main-prisma';
import { InjectDbProvider } from '../../../db-provider/db.provider';
import { IDbProvider } from '../../../db-provider/db.provider.interface';
import { IRecordQueryBuilder } from '../../record/query-builder/record-query-builder.interface';
import { InjectRecordQueryBuilder } from '../../record/query-builder/record-query-builder.provider';
import type { ICreateMaterializedViewParams } from './database-material-view.types';

@Injectable()
export class DatabaseMaterialViewService {
  constructor(
    @InjectRecordQueryBuilder()
    private readonly recordQueryBuilder: IRecordQueryBuilder,
    private readonly prismaService: PrismaService,
    @InjectDbProvider() private readonly dbProvider: IDbProvider
  ) {}

  async createMaterializedView(from: string, params: ICreateMaterializedViewParams): Promise<void> {
    const { qb, table } = await this.recordQueryBuilder.prepareMaterializedView(from, params);
    const sql = this.dbProvider.createMaterializedView(table, qb);
    await this.prismaService.$executeRawUnsafe(sql);
  }
}
