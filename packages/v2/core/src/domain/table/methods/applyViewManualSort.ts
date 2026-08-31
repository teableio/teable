import { err, ok, safeTry, type Result } from 'neverthrow';

import { domainError, type DomainError } from '../../shared/DomainError';
import { ViewManualSortApplied } from '../events/ViewManualSortApplied';
import type { Table } from '../Table';
import type { TableUpdateResult } from '../TableMutator';
import { TableEnsureViewRowOrderSpec } from '../specs/TableEnsureViewRowOrderSpec';
import type { ITableSpecVisitor } from '../specs/ITableSpecVisitor';
import type { ISpecification } from '../../shared/specification/ISpecification';
import type { View } from '../views/View';
import type { ViewId } from '../views/ViewId';
import type { ViewQueryDefaults } from '../views/ViewQueryDefaults';
import type { ViewSortDTO, ViewSortItem } from '../views/ViewSort';
import { ViewType } from '../views/ViewType';
import { updateViewSort } from './updateViewSort';

export type ApplyViewManualSortMethodResult = {
  readonly table: Table;
  readonly view: View;
  readonly sort: ReadonlyArray<ViewSortItem>;
  readonly previousSort: ViewSortDTO;
  readonly nextSort: ViewSortDTO;
  readonly previousQueryDefaults: ViewQueryDefaults;
  readonly nextQueryDefaults: ViewQueryDefaults;
  readonly rowOrderStorageSpec: ISpecification<Table, ITableSpecVisitor>;
  readonly updateResult?: TableUpdateResult;
};

export function applyViewManualSort(
  this: Table,
  viewId: ViewId,
  rawSort: unknown
): Result<ApplyViewManualSortMethodResult, DomainError> {
  const table = this;
  return safeTry<ApplyViewManualSortMethodResult, DomainError>(function* () {
    const view = yield* table.getView(viewId);
    if (!view.type().equals(ViewType.grid())) {
      return err(
        domainError.validation({
          code: 'view.manual_sort_unsupported_type',
          message: `Manual sort requires a Grid view, received ${view.type().toString()}`,
        })
      );
    }

    const sortResult = yield* updateViewSort.call(table, viewId, {
      sortObjs: rawSort,
      manualSort: true,
    });
    const sort = sortResult.nextSort?.sortObjs ?? [];
    const rowOrderStorageSpec = TableEnsureViewRowOrderSpec.create(view);

    if (!sortResult.updateResult) {
      return ok({
        table,
        view: sortResult.view,
        sort,
        previousSort: sortResult.previousSort,
        nextSort: sortResult.nextSort,
        previousQueryDefaults: sortResult.previousQueryDefaults,
        nextQueryDefaults: sortResult.nextQueryDefaults,
        rowOrderStorageSpec,
      });
    }

    const nextTable = sortResult.updateResult.table;
    nextTable.addDomainEvent(
      ViewManualSortApplied.create({
        tableId: nextTable.id(),
        baseId: nextTable.baseId(),
        viewId,
        sort,
      })
    );

    return ok({
      table: nextTable,
      view: sortResult.view,
      sort,
      previousSort: sortResult.previousSort,
      nextSort: sortResult.nextSort,
      previousQueryDefaults: sortResult.previousQueryDefaults,
      nextQueryDefaults: sortResult.nextQueryDefaults,
      rowOrderStorageSpec,
      updateResult: sortResult.updateResult,
    });
  });
}
