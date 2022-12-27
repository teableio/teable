import { HttpInternalServerError } from '@belgattitude/http-exception';
import type { PrismaClientDbMain } from '@teable-group/db-main-prisma';
import type { UnPromisify } from '@teable-group/core';
import type { ISearchPoemsParams } from './table.types';

type ITableData = UnPromisify<ReturnType<TableQuery['searchTable']>>;

export class TableQuery {
  constructor(private readonly prisma: PrismaClientDbMain) {}

  execute = async (params: ISearchPoemsParams) => {
    return await this.searchTable(params);
  };
  /**
   * @todo for many-to-many better to use raw query for
   * significantly better performance (n+1...)
   */
  private searchTable = async (params: ISearchPoemsParams) => {
    const { limit, offset } = params ?? {};
    try {
      return await this.prisma.tableMeta.findMany({
        skip: offset,
        take: limit,
        orderBy: { createdTime: 'desc' },
      });
    } catch (e) {
      throw new HttpInternalServerError({
        message: `Poems can't be retrieved`,
        cause: e instanceof Error ? e : undefined,
      });
    }
  };
}
