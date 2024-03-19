import { updateOrder } from './update-order'; // Adjust the import path as necessary

describe('updateOrder', () => {
  // Mock dependencies
  const getNextItemMock = vi.fn();
  const updateSingleMock = vi.fn();
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
      item: { id: 'item1', order: 4 },
      anchorItem: { id: 'anchor', order: 3 },
      getNextItem: getNextItemMock,
      updateSingle: updateSingleMock,
      shuffle: shuffleMock,
    };

    await updateOrder(params);

    // Verify getNextItem was called correctly
    expect(getNextItemMock).toHaveBeenCalledWith({ lt: 3 }, 'desc');
    // Verify updateSingle was called with expected arguments
    expect(updateSingleMock).toHaveBeenCalledWith('parent1', 'item1', {
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
      parentId: 'parent1',
      position: 'after' as const,
      item: { id: 'item1', order: 2 },
      anchorItem: { id: 'anchor', order: 3 },
      getNextItem: getNextItemMock,
      updateSingle: updateSingleMock,
      shuffle: shuffleMock,
    };

    await updateOrder(params);

    // Verify getNextItem was called correctly
    expect(getNextItemMock).toHaveBeenCalledWith({ gt: 3 }, 'asc');
    // Verify updateSingle was called with expected arguments
    expect(updateSingleMock).toHaveBeenCalledWith('parent1', 'item1', {
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
      parentId: 'parent1',
      position: 'after' as const, // Can test 'before' in a similar manner with adjusted logic
      item: { id: 'item1', order: 4 },
      anchorItem: { id: 'anchor', order: 5 },
      getNextItem: getNextItemMock,
      updateSingle: updateSingleMock,
      shuffle: shuffleMock,
    };

    await updateOrder(params);

    // When there's no item after the anchor, we expect the item to move just after the anchor
    expect(updateSingleMock).toHaveBeenCalledWith('parent1', 'item1', { newOrder: 6, oldOrder: 4 });
    expect(shuffleMock).not.toHaveBeenCalled();
  });

  it('calls shuffle when the new order is too close to the anchor order', async () => {
    // Setup: getNextItem returns a value that would cause a shuffle due to close orders
    getNextItemMock.mockResolvedValueOnce({ id: 'anchor', order: 3 - Number.EPSILON });
    const params = {
      parentId: 'parent1',
      position: 'before' as const,
      item: { id: 'item1', order: 4 },
      anchorItem: { id: 'anchor', order: 3 },
      getNextItem: getNextItemMock,
      updateSingle: updateSingleMock,
      shuffle: shuffleMock,
    };

    // it will not be endless loop, because getNextItemMock will return null in the next call
    await updateOrder(params);

    // Verify shuffle is called due to the order being too close
    expect(shuffleMock).toHaveBeenCalledOnce();
    expect(updateSingleMock).toHaveBeenCalledOnce(); // Ensure updateSingle is called after shuffle
  });
});
