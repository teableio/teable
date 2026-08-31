import { err, ok, safeTry, type Result } from 'neverthrow';

import { domainError, type DomainError } from '../../shared/DomainError';
import { generatePrefixedId } from '../../shared/IdGenerator';
import type { Table } from '../Table';
import type { TableUpdateResult } from '../TableMutator';
import type { View } from '../views/View';
import type { ViewId } from '../views/ViewId';

const shareIdPrefix = 'shr';
const shareIdBodyLength = 16;

export type RefreshViewShareIdMethodResult = {
  readonly view: View;
  readonly previousShareId: string | undefined;
  readonly nextShareId: string;
  readonly updateResult: TableUpdateResult;
};

export function refreshViewShareId(
  this: Table,
  viewId: ViewId
): Result<RefreshViewShareIdMethodResult, DomainError> {
  const table = this;
  return safeTry<RefreshViewShareIdMethodResult, DomainError>(function* () {
    const view = yield* table.getView(viewId);
    if (view.enableShare() !== true) {
      return err(
        domainError.validation({
          message: `View ${viewId.toString()} has not been enabled share`,
        })
      );
    }

    const previousShareId = view.shareId();
    const nextShareId = generatePrefixedId(shareIdPrefix, shareIdBodyLength);
    const updateResult = yield* table.update((mutator) =>
      mutator.updateViewShareId(viewId, nextShareId)
    );
    const nextView = yield* updateResult.table.getView(viewId);
    return ok({
      view: nextView,
      previousShareId,
      nextShareId,
      updateResult,
    });
  });
}
