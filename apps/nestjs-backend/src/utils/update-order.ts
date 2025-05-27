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
export async function updateOrder<T>(params: {
  query: T;
  position: 'before' | 'after';
  item: { id: string; order: number };
  anchorItem: { id: string; order: number };
  getNextItem: (
    whereOrder: { lt?: number; gt?: number },
    align: 'desc' | 'asc'
  ) => Promise<{ id: string; order: number } | null>;
  update: (query: T, id: string, data: { newOrder: number; oldOrder: number }) => Promise<void>;
  shuffle: (query: T) => Promise<void>;
  shouldShuffle?: boolean;
}) {
  const { query, position, item, anchorItem, getNextItem, update, shuffle, shouldShuffle } = params;
  const nextView = await getNextItem(
    { [position === 'before' ? 'lt' : 'gt']: anchorItem.order },
    position === 'before' ? 'desc' : 'asc'
  );

  const order = nextView
    ? (nextView.order + anchorItem.order) / 2
    : anchorItem.order + (position === 'before' ? -1 : 1);

  const { id, order: oldOrder } = item;

  if (Math.abs(order - anchorItem.order) < Number.EPSILON * 2 || shouldShuffle) {
    await shuffle(query);
    // recursive call
    await updateOrder(params);
    return;
  }
  await update(query, id, { newOrder: order, oldOrder });
}

/**
 * if we have [1,2,3,4,5]
 * --------------------------------
 * case 1:
 * anchor = 3, position = 'before', item.length = 2
 * pick the order < 3, we have [1, 2]
 * orderBy desc, we have [2, 1]
 * pick the first one, we have 2 for the next order
 * gap = ABS((anchor - next) / (item.length + 1)) = (3 - 2) / (2 + 1) = 0.333
 * new item orders = next + gap * item.index = [2.333, 2.667]
 * --------------------------------
 * case 2:
 * anchor = 3, position = 'after', item.length = 2
 * pick the order > 3, we have [4, 5]
 * orderBy asc, we have [4, 5]
 * pick the first one, we have 4 for the next order
 * gap = ABS((anchor - next) / (item.length + 1)) = ABS((3 - 4) / (2 + 1)) = 0.333
 * new item orders = anchor + gap * item.index = [3.333, 3.667]
 */
export async function updateMultipleOrders(params: {
  parentId: string;
  position: 'before' | 'after';
  itemLength: number;
  anchorItem: { id: string; order: number };
  getNextItem: (
    whereOrder: { lt?: number; gt?: number },
    align: 'desc' | 'asc'
  ) => Promise<{ id: string; order: number } | null>;
  update: (indexes: number[]) => Promise<void>;
  shuffle: (parentId: string) => Promise<void>;
}) {
  const { parentId, position, itemLength, anchorItem, getNextItem, update, shuffle } = params;
  const nextView = await getNextItem(
    { [position === 'before' ? 'lt' : 'gt']: anchorItem.order },
    position === 'before' ? 'desc' : 'asc'
  );

  const nextOrder = nextView ? nextView.order : anchorItem.order + (position === 'before' ? -1 : 1);
  const gap = Math.abs((anchorItem.order - nextOrder) / (itemLength + 1));

  if (gap < Number.EPSILON * 2) {
    await shuffle(parentId);
    // recursive call
    await updateMultipleOrders(params);
    return;
  }

  const orderBase = position === 'before' ? nextOrder : anchorItem.order;
  const newItems = Array.from({ length: itemLength }).map(
    (_, index) => orderBase + gap * (index + 1)
  );

  await update(newItems);
}
