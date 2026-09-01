import { ok, safeTry } from 'neverthrow';
import type { Result } from 'neverthrow';

import type { DomainError } from '../../shared/DomainError';
import type { Table } from '../Table';
import type { TableUpdateResult } from '../TableMutator';
import type { View } from '../views/View';
import type { ViewId } from '../views/ViewId';
import type { ViewName } from '../views/ViewName';

export type RenameViewMethodResult = {
  readonly previousName: ViewName;
  readonly nextName: ViewName;
  readonly view: View;
  readonly updateResult: TableUpdateResult;
};

export function renameView(
  this: Table,
  viewId: ViewId,
  nextName: ViewName
): Result<RenameViewMethodResult, DomainError> {
  const table = this;
  return safeTry<RenameViewMethodResult, DomainError>(function* () {
    const previousView = yield* table.getView(viewId);
    const previousName = previousView.name();
    const updateResult = yield* table.update((mutator) => mutator.renameView(viewId, nextName));
    const view = yield* updateResult.table.getView(viewId);

    return ok({
      previousName,
      nextName,
      view,
      updateResult,
    });
  });
}
