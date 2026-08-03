import { updateOrder, updateMultipleOrders } from './update-order'; // Adjust the import path as necessary

describe('updateOrder', () => {
  // Mock dependencies
  const getNextItemMock = vi.fn();
  const updateMock = vi.fn();
  const shuffleMock = vi.fn();

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('correctly handles reordering before the anchor item', async () => {
    // Setup for case 1
    getNextItemMock.mockResolvedValueOnce({ id: '2', order: 2 });
    const params = {
      query: 'parent1',
      position: 'before' as const,
      item: { id: 'item1', order: 4 },
      anchorItem: { id: 'anchor', order: 3 },
      getNextItem: getNextItemMock,
      update: updateMock,
      shuffle: shuffleMock,
    };

    await updateOrder(params);

    // Verify getNextItem was called correctly
    expect(getNextItemMock).toHaveBeenCalledWith({ lt: 3 }, 'desc');
    // Verify update was called with expected arguments
    expect(updateMock).toHaveBeenCalledWith('parent1', 'item1', {
      newOrder: 2.5,
      oldOrder: 4,
    });
    // Verify shuffle was not called
    expect(shuffleMock).not.toHaveBeenCalled();
  });

  it('correctly handles reordering after the anchor item', async () => {
    // Setup for case 2
    getNextItemMock.mockResolvedValueOnce({ id: '4', order: 4 });
    const params = {
      query: 'parent1',
      position: 'after' as const,
      item: { id: 'item1', order: 2 },
      anchorItem: { id: 'anchor', order: 3 },
      getNextItem: getNextItemMock,
      update: updateMock,
      shuffle: shuffleMock,
    };

    await updateOrder(params);

    // Verify getNextItem was called correctly
    expect(getNextItemMock).toHaveBeenCalledWith({ gt: 3 }, 'asc');
    // Verify update was called with expected arguments
    expect(updateMock).toHaveBeenCalledWith('parent1', 'item1', {
      newOrder: 3.5,
      oldOrder: 2,
    });
    // Verify shuffle was not called
    expect(shuffleMock).not.toHaveBeenCalled();
  });

  it('handles null from getNextItem correctly, indicating no next item', async () => {
    // Setup: getNextItem returns null
    getNextItemMock.mockResolvedValueOnce(null);
    const params = {
      query: 'parent1',
      position: 'after' as const, // Can test 'before' in a similar manner with adjusted logic
      item: { id: 'item1', order: 4 },
      anchorItem: { id: 'anchor', order: 5 },
      getNextItem: getNextItemMock,
      update: updateMock,
      shuffle: shuffleMock,
    };

    await updateOrder(params);

    // When there's no item after the anchor, we expect the item to move just after the anchor
    expect(updateMock).toHaveBeenCalledWith('parent1', 'item1', { newOrder: 6, oldOrder: 4 });
    expect(shuffleMock).not.toHaveBeenCalled();
  });

  it('calls shuffle when the new order is too close to the anchor order', async () => {
    // Setup: getNextItem returns a value that would cause a shuffle due to close orders
    getNextItemMock.mockResolvedValueOnce({ id: 'anchor', order: 3 - Number.EPSILON });
    const params = {
      query: 'parent1',
      position: 'before' as const,
      item: { id: 'item1', order: 4 },
      anchorItem: { id: 'anchor', order: 3 },
      getNextItem: getNextItemMock,
      update: updateMock,
      shuffle: shuffleMock,
    };

    // it will not be endless loop, because getNextItemMock will return null in the next call
    await updateOrder(params);

    // Verify shuffle is called due to the order being too close
    expect(shuffleMock).toHaveBeenCalledOnce();
    expect(updateMock).toHaveBeenCalledOnce(); // Ensure update is called after shuffle
  });
});

describe('update multiple order', () => {
  // Mock dependencies
  const getNextItemMock = vi.fn();
  const updateMock = vi.fn();
  const shuffleMock = vi.fn();

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('correctly handles reordering before the anchor item', async () => {
    // Setup for case 1
    getNextItemMock.mockResolvedValueOnce({ id: '2', order: 2 });
    const params = {
      parentId: 'parent1',
      position: 'before' as const,
      itemLength: 3,
      anchorItem: { id: 'anchor', order: 3 },
      getNextItem: getNextItemMock,
      update: updateMock,
      shuffle: shuffleMock,
    };

    await updateMultipleOrders(params);

    // Verify getNextItem was called correctly
    expect(getNextItemMock).toHaveBeenCalledWith({ lt: 3 }, 'desc');
    // Verify update was called with expected arguments
    expect(updateMock).toHaveBeenCalledWith([2.25, 2.5, 2.75]);
    // Verify shuffle was not called
    expect(shuffleMock).not.toHaveBeenCalled();
  });

  it('correctly handles reordering after the anchor item', async () => {
    // Setup for case 2
    getNextItemMock.mockResolvedValueOnce({ id: '4', order: 4 });
    const params = {
      parentId: 'parent1',
      position: 'after' as const,
      itemLength: 3,
      anchorItem: { id: 'anchor', order: 3 },
      getNextItem: getNextItemMock,
      update: updateMock,
      shuffle: shuffleMock,
    };

    await updateMultipleOrders(params);

    // Verify getNextItem was called correctly
    expect(getNextItemMock).toHaveBeenCalledWith({ gt: 3 }, 'asc');
    // Verify update was called with expected arguments
    expect(updateMock).toHaveBeenCalledWith([3.25, 3.5, 3.75]);
    // Verify shuffle was not called
    expect(shuffleMock).not.toHaveBeenCalled();
  });

  it('handles null from getNextItem correctly, indicating no next item', async () => {
    // Setup: getNextItem returns null
    getNextItemMock.mockResolvedValueOnce(null);
    const params = {
      parentId: 'parent1',
      position: 'after' as const,
      itemLength: 3,
      anchorItem: { id: 'anchor', order: 7 },
      getNextItem: getNextItemMock,
      update: updateMock,
      shuffle: shuffleMock,
    };

    await updateMultipleOrders(params);

    // When there's no item after the anchor, we expect the item to move just after the anchor
    expect(updateMock).toHaveBeenCalledWith([7.25, 7.5, 7.75]);
    expect(shuffleMock).not.toHaveBeenCalled();
  });

  it('calls shuffle when the new order is too close to the anchor order', async () => {
    // Setup: getNextItem returns a value that would cause a shuffle due to close orders
    getNextItemMock.mockResolvedValueOnce({ id: 'anchor', order: 3 - Number.EPSILON });
    const params = {
      parentId: 'parent1',
      position: 'before' as const,
      itemLength: 1,
      anchorItem: { id: 'anchor', order: 3 },
      getNextItem: getNextItemMock,
      update: updateMock,
      shuffle: shuffleMock,
    };

    // it will not be endless loop, because getNextItemMock will return null in the next call
    await updateMultipleOrders(params);

    // Verify shuffle is called due to the order being too close
    expect(shuffleMock).toHaveBeenCalledOnce();
    expect(updateMock).toHaveBeenCalledOnce(); // Ensure update is called after shuffle
  });
});
