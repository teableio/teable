import { ok, safeTry, type Result } from 'neverthrow';

import type { DomainError } from '../../shared/DomainError';
import type { Table } from '../Table';
import type { TableUpdateResult } from '../TableMutator';
import type { View } from '../views/View';
import type { ViewId } from '../views/ViewId';
import { mergeAndValidateViewOptions } from '../views/ViewOptions';

export type UpdateViewOptionsMethodResult = {
  readonly view: View;
  readonly previousOptions: unknown;
  readonly nextOptions: unknown;
  readonly updateResult?: TableUpdateResult;
};

export function updateViewOptions(
  this: Table,
  viewId: ViewId,
  patch: unknown
): Result<UpdateViewOptionsMethodResult, DomainError> {
  const table = this;
  return safeTry<UpdateViewOptionsMethodResult, DomainError>(function* () {
    const view = yield* table.getView(viewId);
    const previousOptions = view.options();
    const nextOptions = yield* mergeAndValidateViewOptions(
      view.type().toString(),
      previousOptions,
      patch
    );

    if (JSON.stringify(previousOptions) === JSON.stringify(nextOptions)) {
      return ok({ view, previousOptions, nextOptions });
    }

    const updateResult = yield* table.update((mutator) =>
      mutator.updateViewOptions({
        viewId,
        previousOptions,
        nextOptions,
      })
    );
    const nextView = yield* updateResult.table.getView(viewId);
    return ok({
      view: nextView,
      previousOptions,
      nextOptions,
      updateResult,
    });
  });
}
