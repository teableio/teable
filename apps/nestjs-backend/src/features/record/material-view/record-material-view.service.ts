import { Injectable } from '@nestjs/common';
import { PrismaService } from '@teable/db-main-prisma';
import { InjectDbProvider } from '../../../db-provider/db.provider';
import { IDbProvider } from '../../../db-provider/db.provider.interface';
import { InjectRecordQueryBuilder, IRecordQueryBuilder } from '../query-builder';
import type { ICreateMaterializedViewParams } from './record-material-view.types';

@Injectable()
export class RecordMaterialViewService {
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
