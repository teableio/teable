import { Injectable } from '@nestjs/common';
import type { Knex } from 'knex';

export type IWrapViewQuery = {
  keepPrimaryKey?: boolean;
};

@Injectable()
export class RecordPermissionService {
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
