import { Injectable } from '@nestjs/common';
import type { Knex } from 'knex';

export type IWrapViewQuery = {
  keepPrimaryKey?: boolean;
  viewId?: string;
};

export type IRecordReadQuerySource = {
  tableName: string;
  cteName: string;
  cteSql: string;
  enabledFieldIds?: string[];
};

@Injectable()
export class RecordPermissionService {
  async getReadQuerySource(
    _tableId: string,
    _query?: IWrapViewQuery
  ): Promise<IRecordReadQuerySource | undefined> {
    return undefined;
  }

  async wrapView(
    _tableId: string,
    builder: Knex.QueryBuilder,
    _query?: IWrapViewQuery
  ): Promise<{ viewCte?: string; builder: Knex.QueryBuilder; enabledFieldIds?: string[] }> {
    return {
      viewCte: undefined,
      builder,
    };
  }
}
