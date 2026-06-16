import type { BaseId } from '../../domain/base/BaseId';
import type { Table } from '../../domain/table/Table';
import type { TableId } from '../../domain/table/TableId';
import type { IExecutionContext } from '../../ports/ExecutionContext';

type PreloadedTableExecutionContext = IExecutionContext & {
  __preloadedTables?: Map<string, Table>;
};

const cacheKey = (baseId: BaseId, tableId: TableId): string =>
  `${baseId.toString()}:${tableId.toString()}`;

const getCache = (context: IExecutionContext): Map<string, Table> => {
  const cacheContext = context as PreloadedTableExecutionContext;
  cacheContext.__preloadedTables ??= new Map<string, Table>();
  return cacheContext.__preloadedTables;
};

export const bindPreloadedTableToExecutionContext = (
  context: IExecutionContext,
  table: Table
): void => {
  if (
    typeof (table as { baseId?: unknown }).baseId !== 'function' ||
    typeof (table as { id?: unknown }).id !== 'function'
  ) {
    return;
  }

  getCache(context).set(cacheKey(table.baseId(), table.id()), table);
};

export const consumePreloadedTableFromExecutionContext = (
  context: IExecutionContext,
  params: {
    baseId: BaseId;
    tableId: TableId;
  }
): Table | undefined => {
  const cache = getCache(context);
  const key = cacheKey(params.baseId, params.tableId);
  const table = cache.get(key);
  if (!table) {
    return undefined;
  }

  cache.delete(key);
  return table;
};
