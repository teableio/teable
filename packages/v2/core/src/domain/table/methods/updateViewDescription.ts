import { ok, safeTry } from 'neverthrow';
import type { Result } from 'neverthrow';

import type { DomainError } from '../../shared/DomainError';
import type { Table } from '../Table';
import type { TableUpdateResult } from '../TableMutator';
import type { View } from '../views/View';
import type { ViewId } from '../views/ViewId';

export type UpdateViewDescriptionMethodResult = {
  readonly previousDescription: string | undefined;
  readonly nextDescription: string;
  readonly view: View;
  readonly updateResult: TableUpdateResult;
};

export function updateViewDescription(
  this: Table,
  viewId: ViewId,
  nextDescription: string
): Result<UpdateViewDescriptionMethodResult, DomainError> {
  const table = this;
  return safeTry<UpdateViewDescriptionMethodResult, DomainError>(function* () {
    const previousView = yield* table.getView(viewId);
    const previousDescription = previousView.description();
    const updateResult = yield* table.update((mutator) =>
      mutator.updateViewDescription(viewId, nextDescription)
    );
    const view = yield* updateResult.table.getView(viewId);

    return ok({
      previousDescription,
      nextDescription,
      view,
      updateResult,
    });
  });
}
