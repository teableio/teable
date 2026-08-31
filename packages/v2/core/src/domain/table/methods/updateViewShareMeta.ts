import { ok, safeTry, type Result } from 'neverthrow';

import type { DomainError } from '../../shared/DomainError';
import type { Table } from '../Table';
import type { TableUpdateResult } from '../TableMutator';
import type { View } from '../views/View';
import type { ViewId } from '../views/ViewId';
import { ViewProperties, type ViewShareMetaValue } from '../views/ViewProperties';

export type UpdateViewShareMetaMethodResult = {
  readonly view: View;
  readonly previousShareMeta: ViewShareMetaValue | undefined;
  readonly nextShareMeta: ViewShareMetaValue | undefined;
  readonly updateResult?: TableUpdateResult;
};

export function updateViewShareMeta(
  this: Table,
  viewId: ViewId,
  shareMeta: unknown
): Result<UpdateViewShareMetaMethodResult, DomainError> {
  const table = this;
  return safeTry<UpdateViewShareMetaMethodResult, DomainError>(function* () {
    const view = yield* table.getView(viewId);
    const previousShareMeta = view.shareMeta();
    const properties = yield* ViewProperties.rehydrate({ shareMeta });
    const nextShareMeta = properties.shareMeta();

    if (JSON.stringify(previousShareMeta) === JSON.stringify(nextShareMeta)) {
      return ok({ view, previousShareMeta, nextShareMeta });
    }

    const updateResult = yield* table.update((mutator) =>
      mutator.updateViewShareMeta(viewId, nextShareMeta)
    );
    const nextView = yield* updateResult.table.getView(viewId);
    return ok({
      view: nextView,
      previousShareMeta,
      nextShareMeta,
      updateResult,
    });
  });
}
