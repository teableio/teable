import { renderHook } from '@testing-library/react';
import { useExpandRecord } from './useExpandRecord';

const push = vi.fn();

vi.mock('next/router', () => ({
  useRouter: () => ({
    pathname: '/base/[baseId]/[tableId]/[viewId]',
    query: { baseId: 'bse1', tableId: 'tbl1', viewId: 'viw1' },
    push,
  }),
}));

describe('useExpandRecord', () => {
  beforeEach(() => push.mockReset());

  it('puts the record id in the url so the expanded record stays linkable', async () => {
    const { result } = renderHook(() => useExpandRecord());

    await result.current('rec1');

    expect(push).toHaveBeenCalledWith(
      {
        pathname: '/base/[baseId]/[tableId]/[viewId]',
        query: { baseId: 'bse1', tableId: 'tbl1', viewId: 'viw1', recordId: 'rec1' },
      },
      undefined,
      { shallow: true }
    );
  });
});
