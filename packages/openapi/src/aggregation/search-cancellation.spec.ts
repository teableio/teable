import { axios } from '../axios';
import { getShareViewAggregations } from '../share/view-aggregations';
import { getShareViewRowCount } from '../share/view-row-count';
import { getAggregation } from './get-aggregation';
import { getRowCount } from './get-row-count';

describe('search statistics cancellation', () => {
  it.each([
    ['count', getRowCount],
    ['aggregation', getAggregation],
    ['share count', getShareViewRowCount],
    ['share aggregation', getShareViewAggregations],
  ] as const)(
    '%s forwards an optional signal without serializing it in query params',
    async (_, get) => {
      const request = vi.spyOn(axios, 'get').mockResolvedValue({ data: {} });
      const controller = new AbortController();
      const query = { search: ['order', '', true] as [string, string, boolean] };
      await get('id', query, { signal: controller.signal });
      expect(request).toHaveBeenLastCalledWith(
        expect.any(String),
        expect.objectContaining({
          signal: controller.signal,
          params: expect.objectContaining({ search: query.search }),
        })
      );
      expect(request.mock.calls[0][1]?.params).not.toHaveProperty('signal');
      // Existing callers do not need to provide a third argument.
      await get('id', query);
      expect(request.mock.calls[1][1]?.signal).toBeUndefined();
    }
  );
});
