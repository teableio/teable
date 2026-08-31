import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ActorId, type IExecutionContext, type IRecordSearchAccessPath } from '@teable/v2-core';
import type { DependencyContainer } from '@teable/v2-di';
import { v2TableOpsTokens, type TableSearchAccessPathResolver } from '@teable/v2-table-query-ops';

export type TableQuerySearchVectorRuntimeMode = 'off' | 'auto';

export const tableQuerySearchVectorRuntimeEnv = 'V2_TABLE_QUERY_OPS_SEARCH_VECTOR_RUNTIME';
export const tableQuerySearchAccessPathRuntimeEnv = 'V2_TABLE_QUERY_OPS_SEARCH_ACCESS_PATH_RUNTIME';

export const resolveTableQuerySearchVectorRuntimeMode = (
  value: unknown
): TableQuerySearchVectorRuntimeMode => {
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

  async resolveForRecordSearch(input: {
    readonly container: DependencyContainer;
    readonly tableId: string;
    readonly search: unknown;
  }): Promise<IRecordSearchAccessPath | undefined> {
    if (!hasSearchValueForSearchVectorRuntime(input.search) || this.mode() !== 'auto') {
      return undefined;
    }

    try {
      // The config storage is owned by the table-query-ops adapter; read it
      // through its resolver port instead of issuing SQL from the app layer.
      if (!input.container.isRegistered(v2TableOpsTokens.searchAccessPathResolver)) {
        return undefined;
      }
      const resolver = input.container.resolve<TableSearchAccessPathResolver>(
        v2TableOpsTokens.searchAccessPathResolver
      );
      const resolved = await resolver.resolve(this.systemContext(), input.tableId);
      return resolved.isOk() ? resolved.value : undefined;
    } catch {
      return undefined;
    }
  }

  private mode(): TableQuerySearchVectorRuntimeMode {
    return resolveTableQuerySearchVectorRuntimeMode(
      this.configService.get(tableQuerySearchAccessPathRuntimeEnv) ??
        this.configService.get(tableQuerySearchVectorRuntimeEnv)
    );
  }

  private systemContext(): IExecutionContext {
    return {
      actorId: ActorId.create('system')._unsafeUnwrap(),
      requestId: 'table-query-search-vector-runtime',
    };
  }
}
