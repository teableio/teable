export const splitRange = (start: number, end: number, parts: number) => {
  const arr = [];
  const step = (end - start) / parts;

  for (let i = 1; i < parts; i++) {
    arr.push(start + step * i);
  }
  return arr;
};

export const reorder = (
  dragElemSize: number,
  dropIndex: number,
  totalSize: number,
  getOrder: (index: number) => number
) => {
  let newOrders = Array.from({ length: dragElemSize }).fill(0) as number[];
  if (dropIndex === 0) {
    newOrders = newOrders.map((_, index) => getOrder(0) - index - 1);
  } else if (dropIndex > totalSize - 1) {
    newOrders = newOrders.map((_, index) => getOrder(totalSize - 1) + index + 1);
  } else {
    const prevOrder = getOrder(dropIndex - 1);
    const nextOrder = getOrder(dropIndex);
    newOrders = splitRange(prevOrder, nextOrder, dragElemSize + 1);
  }
  return newOrders;
};
