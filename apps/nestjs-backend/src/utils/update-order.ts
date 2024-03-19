/**
 * if we have [1,2,3,4,5]
 * --------------------------------
 * case 1:
 * anchorId = 3, position = 'before', order = 2
 * pick the order < 3, we have [1, 2]
 * orderBy desc, we have [2, 1]
 * pick the first one, we have 2
 * --------------------------------
 * case 2:
 * anchorId = 3, position = 'after', order = 2
 * pick the order > 3, we have [4, 5]
 * orderBy asc, we have [4, 5]
 * pick the first one, we have 4
 */
export async function updateOrder(params: {
  parentId: string;
  position: 'before' | 'after';
  item: { id: string; order: number };
  anchorItem: { id: string; order: number };
  getNextItem: (
    whereOrder: { lt?: number; gt?: number },
    align: 'desc' | 'asc'
  ) => Promise<{ id: string; order: number } | null>;
  updateSingle: (
    parentId: string,
    id: string,
    data: { newOrder: number; oldOrder: number }
  ) => Promise<void>;
  shuffle: (parentId: string) => Promise<void>;
}) {
  const { parentId, position, item, anchorItem, getNextItem, updateSingle, shuffle } = params;
  const nextView = await getNextItem(
    { [position === 'before' ? 'lt' : 'gt']: anchorItem.order },
    position === 'before' ? 'desc' : 'asc'
  );

  const order = nextView
    ? (nextView.order + anchorItem.order) / 2
    : anchorItem.order + (position === 'before' ? -1 : 1);

  const { id, order: oldOrder } = item;

  if (Math.abs(order - anchorItem.order) < Number.EPSILON * 2) {
    await shuffle(parentId);
    // recursive call
    await updateOrder(params);
    return;
  }
  await updateSingle(parentId, id, { newOrder: order, oldOrder });
}
