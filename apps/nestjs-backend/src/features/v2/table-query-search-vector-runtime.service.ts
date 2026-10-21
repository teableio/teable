import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { IRecordSearchAccessPath, ITableReadModel } from '@teable/v2-core';
import { resolveTableSearchAccessPath } from '@teable/v2-table-query-ops';

export type TableQuerySearchVectorRuntimeMode = 'off' | 'auto';

export const tableQuerySearchVectorRuntimeEnv = 'V2_TABLE_QUERY_OPS_SEARCH_VECTOR_RUNTIME';
export const tableQuerySearchAccessPathRuntimeEnv = 'V2_TABLE_QUERY_OPS_SEARCH_ACCESS_PATH_RUNTIME';

export const resolveTableQuerySearchVectorRuntimeMode = (
  value: unknown
): TableQuerySearchVectorRuntimeMode => {
  if (value == null) {
    return 'off';
  }

  if (typeof value === 'boolean') {
    return value ? 'auto' : 'off';
  }

  if (typeof value !== 'string') {
    return 'off';
  }

  const normalized = value.trim().toLowerCase();
  if (['1', 'true', 'yes', 'on', 'enabled', 'auto'].includes(normalized)) {
    return 'auto';
  }

  return 'off';
};

export const hasSearchValueForSearchVectorRuntime = (search: unknown): boolean => {
  if (!Array.isArray(search)) {
    return false;
  }

  const [value] = search;
  return typeof value === 'string' && value.trim().length > 0;
};

@Injectable()
export class TableQuerySearchVectorRuntimeService {
  constructor(private readonly configService: ConfigService) {}

  resolveForRecordSearch(input: {
    readonly table: ITableReadModel;
    readonly search: unknown;
  }): IRecordSearchAccessPath | undefined {
    if (!hasSearchValueForSearchVectorRuntime(input.search) || this.mode() !== 'auto') {
      return undefined;
    }

    return resolveTableSearchAccessPath(input.table);
  }

  private mode(): TableQuerySearchVectorRuntimeMode {
    return resolveTableQuerySearchVectorRuntimeMode(
      this.configService.get(tableQuerySearchAccessPathRuntimeEnv) ??
        this.configService.get(tableQuerySearchVectorRuntimeEnv)
    );
  }
}
