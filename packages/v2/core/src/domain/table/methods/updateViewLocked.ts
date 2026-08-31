import { ok, safeTry } from 'neverthrow';
import type { Result } from 'neverthrow';

import type { DomainError } from '../../shared/DomainError';
import type { Table } from '../Table';
import type { TableUpdateResult } from '../TableMutator';
import type { View } from '../views/View';
import type { ViewId } from '../views/ViewId';

export type UpdateViewLockedMethodResult = {
  readonly previousIsLocked: boolean | undefined;
  readonly nextIsLocked: boolean | undefined;
  readonly view: View;
  readonly updateResult: TableUpdateResult;
};

export function updateViewLocked(
  this: Table,
  viewId: ViewId,
  nextIsLocked: boolean | undefined
): Result<UpdateViewLockedMethodResult, DomainError> {
  const table = this;
  return safeTry<UpdateViewLockedMethodResult, DomainError>(function* () {
    const previousView = yield* table.getView(viewId);
    const previousIsLocked = previousView.isLocked();
    const updateResult = yield* table.update((mutator) =>
      mutator.updateViewLocked(viewId, nextIsLocked)
    );
    const view = yield* updateResult.table.getView(viewId);

    return ok({
      previousIsLocked,
      nextIsLocked,
      view,
      updateResult,
    });
  });
}
