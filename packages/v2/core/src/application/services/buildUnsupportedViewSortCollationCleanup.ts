import { err, ok, type Result } from 'neverthrow';

import type { DomainError } from '../../domain/shared/DomainError';
import { TableUpdateViewQueryDefaultsSpec } from '../../domain/table/specs/TableUpdateViewQueryDefaultsSpec';
import type { TableViewQueryDefaultsUpdate } from '../../domain/table/specs/TableUpdateViewQueryDefaultsSpec';
import type { Table } from '../../domain/table/Table';
import { validateViewSortCollations } from '../../domain/table/views/validateViewSortCollations';
import { ViewQueryDefaults } from '../../domain/table/views/ViewQueryDefaults';

/** Field conversion changes collation eligibility, not the user's sort priority or direction. */
export const buildUnsupportedViewSortCollationCleanup = (
  table: Table
): Result<TableUpdateViewQueryDefaultsSpec | undefined, DomainError> => {
  const updates: TableViewQueryDefaultsUpdate[] = [];
  for (const view of table.views()) {
    const defaultsResult = view.queryDefaults();
    if (defaultsResult.isErr()) return err(defaultsResult.error);
    const previousQueryDefaults = defaultsResult.value;
    let changed = false;
    const sort = previousQueryDefaults.sort()?.map((item) => {
      if (item.collation !== 'zh-pinyin') return item;
      const validation = validateViewSortCollations(table, [item]);
      if (validation.isOk() || validation.error.code !== 'sort.unsupported_collation') return item;
      changed = true;
      const { collation: _collation, ...preservedSort } = item;
      return preservedSort;
    });
    if (!changed) continue;
    const nextDefaults = ViewQueryDefaults.rehydrate(
      { ...previousQueryDefaults.toDto(), sort },
      { sourceFilter: previousQueryDefaults.sourceFilter() }
    );
    if (nextDefaults.isErr()) return err(nextDefaults.error);
    updates.push({ viewId: view.id(), previousQueryDefaults, queryDefaults: nextDefaults.value });
  }
  return ok(updates.length ? TableUpdateViewQueryDefaultsSpec.create(updates) : undefined);
};
