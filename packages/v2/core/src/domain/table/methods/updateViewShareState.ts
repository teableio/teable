import { err, ok, safeTry, type Result } from 'neverthrow';

import { domainError, type DomainError } from '../../shared/DomainError';
import { generatePrefixedId } from '../../shared/IdGenerator';
import type { Table } from '../Table';
import type { TableUpdateResult } from '../TableMutator';
import type { View } from '../views/View';
import type { ViewId } from '../views/ViewId';
import type { ViewShareMetaValue } from '../views/ViewProperties';
import { ViewType } from '../views/ViewType';

const shareIdPrefix = 'shr';
const shareIdBodyLength = 16;

type TableUpdateViewShareStateResult = {
  readonly view: View;
  readonly previousShareId: string | undefined;
  readonly updateResult: TableUpdateResult;
};

export type TableEnableViewShareResult = TableUpdateViewShareStateResult & {
  readonly shareId: string;
};

export type TableDisableViewShareResult = TableUpdateViewShareStateResult & {
  readonly shareId: string | undefined;
};

const defaultShareMeta = (view: View): ViewShareMetaValue =>
  view.type().equals(ViewType.form()) ? {} : { includeRecords: true };

export function enableViewShare(
  this: Table,
  viewId: ViewId
): Result<TableEnableViewShareResult, DomainError> {
  const table = this;
  return safeTry<TableEnableViewShareResult, DomainError>(function* () {
    const view = yield* table.getView(viewId);
    if (view.enableShare() === true) {
      return err(
        domainError.validation({
          message: `View ${viewId.toString()} has already been enabled share`,
        })
      );
    }

    const shareId = generatePrefixedId(shareIdPrefix, shareIdBodyLength);
    const updateResult = yield* table.update((mutator) =>
      mutator.updateViewShareState(viewId, {
        enableShare: true,
        shareId,
        shareMeta: view.shareMeta() ?? defaultShareMeta(view),
      })
    );
    const nextView = yield* updateResult.table.getView(viewId);
    return ok({
      view: nextView,
      previousShareId: view.shareId(),
      shareId,
      updateResult,
    });
  });
}

export function disableViewShare(
  this: Table,
  viewId: ViewId
): Result<TableDisableViewShareResult, DomainError> {
  const table = this;
  return safeTry<TableDisableViewShareResult, DomainError>(function* () {
    const view = yield* table.getView(viewId);
    if (view.enableShare() !== true) {
      return err(
        domainError.validation({
          message: `View ${viewId.toString()} has already been disabled share`,
        })
      );
    }

    const updateResult = yield* table.update((mutator) =>
      mutator.updateViewShareState(viewId, {
        enableShare: false,
        shareId: view.shareId(),
        shareMeta: view.shareMeta(),
      })
    );
    const nextView = yield* updateResult.table.getView(viewId);
    return ok({
      view: nextView,
      previousShareId: view.shareId(),
      shareId: view.shareId(),
      updateResult,
    });
  });
}
