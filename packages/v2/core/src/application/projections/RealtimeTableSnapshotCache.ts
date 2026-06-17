import { err, ok } from 'neverthrow';
import type { Result } from 'neverthrow';

import type { BaseId } from '../../domain/base/BaseId';
import type { DomainError } from '../../domain/shared/DomainError';
import { Table } from '../../domain/table/Table';
import type { TableId } from '../../domain/table/TableId';
import type { IExecutionContext } from '../../ports/ExecutionContext';
import type { ITableMapper, ITablePersistenceDTO } from '../../ports/mappers/TableMapper';
import type { ITableRepository } from '../../ports/TableRepository';

type RealtimeSnapshotCacheContext = IExecutionContext & {
  __realtimeTableSnapshotCache?: Map<string, RealtimeSnapshotCacheEntry>;
};

type RealtimeSnapshotCacheEntry = {
  snapshot?: ITablePersistenceDTO;
  loading?: Promise<Result<ITablePersistenceDTO, DomainError>>;
};

const cacheKey = (baseId: BaseId, tableId: TableId): string =>
  `${baseId.toString()}:${tableId.toString()}`;

const getCache = (context: IExecutionContext): Map<string, RealtimeSnapshotCacheEntry> => {
  const cacheContext = context as RealtimeSnapshotCacheContext;
  cacheContext.__realtimeTableSnapshotCache ??= new Map<string, RealtimeSnapshotCacheEntry>();
  return cacheContext.__realtimeTableSnapshotCache;
};

export const bindRealtimeTableSnapshotCache = (
  source: IExecutionContext,
  target: IExecutionContext
): void => {
  const cache = getCache(source);
  (target as RealtimeSnapshotCacheContext).__realtimeTableSnapshotCache = cache;
};

export const loadRealtimeTableSnapshot = async (
  context: IExecutionContext,
  params: {
    baseId: BaseId;
    tableId: TableId;
    tableRepository: ITableRepository;
    tableMapper: ITableMapper;
    isSnapshotUsable?: (snapshot: ITablePersistenceDTO) => boolean;
  }
): Promise<Result<ITablePersistenceDTO, DomainError>> => {
  const key = cacheKey(params.baseId, params.tableId);
  const cache = getCache(context);
  const cached = cache.get(key);
  if (cached?.snapshot && (params.isSnapshotUsable?.(cached.snapshot) ?? true)) {
    return ok(cached.snapshot);
  }

  if (cached?.loading) {
    const loadingResult = await cached.loading;
    if (loadingResult.isErr()) {
      return err(loadingResult.error);
    }
    if (params.isSnapshotUsable?.(loadingResult.value) ?? true) {
      return ok(loadingResult.value);
    }
  }

  const specResult = Table.specs(params.baseId).byId(params.tableId).build();
  if (specResult.isErr()) {
    return err(specResult.error);
  }

  const loading = (async (): Promise<Result<ITablePersistenceDTO, DomainError>> => {
    const tableResult = await params.tableRepository.findOne(context, specResult.value);
    if (tableResult.isErr()) {
      return err(tableResult.error);
    }

    const snapshotResult = params.tableMapper.toDTO(tableResult.value);
    if (snapshotResult.isErr()) {
      return err(snapshotResult.error);
    }

    return ok(snapshotResult.value);
  })();
  cache.set(key, cached?.snapshot ? { snapshot: cached.snapshot, loading } : { loading });

  const snapshotResult = await loading;
  if (snapshotResult.isErr()) {
    if (cached?.snapshot) {
      cache.set(key, { snapshot: cached.snapshot });
    } else {
      cache.delete(key);
    }
    return err(snapshotResult.error);
  }

  cache.set(key, { snapshot: snapshotResult.value });
  return ok(snapshotResult.value);
};
