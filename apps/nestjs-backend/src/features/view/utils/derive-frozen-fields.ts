import type { IGridViewOptions, IGridColumnMeta, IGridColumn } from '@teable/core';

export function adjustFrozenField(
  originOptions: IGridViewOptions,
  originColumnMeta: IGridColumnMeta,
  columnMetaUpdate: IGridColumnMeta
): IGridViewOptions | null {
  const frozenFieldId = originOptions?.frozenFieldId;

  if (!frozenFieldId) return null;
  if (!Object.prototype.hasOwnProperty.call(columnMetaUpdate, frozenFieldId)) return null;

  const frozenColumnUpdate: IGridColumn | undefined = frozenFieldId
    ? columnMetaUpdate[frozenFieldId]
    : undefined;
  const originOrders = Object.keys(originColumnMeta).sort(
    (a, b) => originColumnMeta[a].order - originColumnMeta[b].order
  );

  // frozen field has been deleted
  if (frozenColumnUpdate == null) {
    const index = originOrders.indexOf(frozenFieldId);
    const newFrozenId = index > 0 ? originOrders[index - 1] : undefined;
    return {
      ...originOptions,
      frozenFieldId: newFrozenId,
    };
  }

  const oldOrder = originColumnMeta[frozenFieldId]?.order;
  const newOrder = frozenColumnUpdate.order;

  if (oldOrder == null || newOrder == null || newOrder === oldOrder) return null;

  const oldIndex = originOrders.indexOf(frozenFieldId);
  const prevNeighborId = oldIndex > 0 ? originOrders[oldIndex - 1] : undefined;

  const nextOptions: IGridViewOptions = { ...(originOptions as IGridViewOptions) };
  if (prevNeighborId) {
    nextOptions.frozenFieldId = prevNeighborId;
  } else {
    delete (nextOptions as Record<string, unknown>).frozenFieldId;
  }
  return nextOptions;
}
