import { err, ok, safeTry } from 'neverthrow';
import type { Result } from 'neverthrow';

import { domainError, type DomainError } from '../../shared/DomainError';
import type { TableViewOrderChange } from '../specs/TableUpdateViewOrderSpec';
import type { Table } from '../Table';
import type { TableUpdateResult } from '../TableMutator';
import type { View } from '../views/View';
import type { ViewId } from '../views/ViewId';
import { ViewOrder } from '../views/ViewOrder';

export type ViewOrderPosition = 'before' | 'after';

export type UpdateViewOrderMethodResult = {
  readonly sourceViewId: ViewId;
  readonly previousOrder: ViewOrder;
  readonly nextOrder: ViewOrder;
  readonly changes: ReadonlyArray<TableViewOrderChange>;
  readonly updateResult: TableUpdateResult;
};

type OrderedView = { view: View; order: number };

const findNeighbor = (
  views: ReadonlyArray<OrderedView>,
  anchorOrder: number,
  position: ViewOrderPosition
): OrderedView | undefined => {
  const candidates = views.filter(({ order }) =>
    position === 'before' ? order < anchorOrder : order > anchorOrder
  );
  candidates.sort((left, right) =>
    position === 'before' ? right.order - left.order : left.order - right.order
  );
  return candidates[0];
};

const calculateOrder = (
  views: ReadonlyArray<OrderedView>,
  anchorOrder: number,
  position: ViewOrderPosition
): number => {
  const neighbor = findNeighbor(views, anchorOrder, position);
  return neighbor
    ? (neighbor.order + anchorOrder) / 2
    : anchorOrder + (position === 'before' ? -1 : 1);
};

export function updateViewOrder(
  this: Table,
  sourceViewId: ViewId,
  anchorViewId: ViewId,
  position: ViewOrderPosition
): Result<UpdateViewOrderMethodResult, DomainError> {
  const table = this;
  return safeTry<UpdateViewOrderMethodResult, DomainError>(function* () {
    const sourceViewResult = table.getView(sourceViewId);
    if (sourceViewResult.isErr()) {
      return err(
        domainError.notFound({
          code: 'view.not_found',
          message: `View not found: ${sourceViewId.toString()}`,
        })
      );
    }
    const anchorViewResult = table.getView(anchorViewId);
    if (anchorViewResult.isErr()) {
      return err(
        domainError.notFound({
          code: 'view.anchor_not_found',
          message: `Anchor View not found: ${anchorViewId.toString()}`,
        })
      );
    }

    const sourceView = sourceViewResult.value;
    const anchorView = anchorViewResult.value;
    const previousOrder = yield* sourceView.order();
    const anchorOrder = yield* anchorView.order();
    const orderedViews: OrderedView[] = [];
    for (const view of table.views()) {
      orderedViews.push({ view, order: (yield* view.order()).toNumber() });
    }

    let calculated = calculateOrder(orderedViews, anchorOrder.toNumber(), position);
    const changes: TableViewOrderChange[] = [];

    if (Math.abs(calculated - anchorOrder.toNumber()) < Number.EPSILON * 2) {
      for (let index = 0; index < orderedViews.length; index += 1) {
        const item = orderedViews[index]!;
        changes.push({
          viewId: item.view.id(),
          previousOrder: yield* ViewOrder.rehydrate(item.order),
          nextOrder: yield* ViewOrder.rehydrate(index),
        });
        item.order = index;
      }
      const normalizedAnchor = orderedViews.find(({ view }) => view.id().equals(anchorViewId));
      if (!normalizedAnchor) {
        return err(domainError.invariant({ message: 'Normalized anchor View missing' }));
      }
      calculated = calculateOrder(orderedViews, normalizedAnchor.order, position);
    }

    const nextOrder = yield* ViewOrder.rehydrate(calculated);
    changes.push({ viewId: sourceViewId, previousOrder, nextOrder });
    const updateResult = yield* table.update((mutator) => mutator.updateViewOrder(changes));

    return ok({
      sourceViewId,
      previousOrder,
      nextOrder,
      changes,
      updateResult,
    });
  });
}
