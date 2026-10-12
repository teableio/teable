import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StatisticsFunc } from '@teable/core';
import type * as OpenApi from '@teable/openapi';
import type { IAggregationRo, IAggregationVo } from '@teable/openapi';
import { getAggregation } from '@teable/openapi';
import { render, waitFor } from '@testing-library/react';
import { useContext } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { AnchorContext } from '../anchor';
import { ConnectionContext } from '../app/ConnectionContext';
import { AggregationContext } from './AggregationContext';
import { AggregationProvider } from './AggregationProvider';

vi.mock('@teable/openapi', async (importOriginal) => {
  const actual = await importOriginal<typeof OpenApi>();
  return { ...actual, getAggregation: vi.fn() };
});

const aggregation = (fieldId: string, aggFunc: StatisticsFunc) => ({
  fieldId,
  total: { aggFunc, value: 50 },
});

describe('AggregationProvider', () => {
  it('keeps the previous aggregations while a changed statistic query loads', async () => {
    let resolveNext: (value: { data: IAggregationVo }) => void = () => undefined;
    vi.mocked(getAggregation)
      .mockResolvedValueOnce({
        data: { aggregations: [aggregation('fldA', StatisticsFunc.Count)] },
      } as never)
      .mockReturnValueOnce(new Promise((resolve) => (resolveNext = resolve)) as never);

    let current = null as IAggregationVo | null;
    const Consumer = () => {
      current = useContext(AggregationContext);
      return null;
    };
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const Wrapper = ({ query }: { query: IAggregationRo }) => (
      <QueryClientProvider client={client}>
        <ConnectionContext.Provider value={{ connected: false }}>
          <AnchorContext.Provider value={{ tableId: 'tblA', viewId: 'viwA' }}>
            <AggregationProvider query={query}>
              <Consumer />
            </AggregationProvider>
          </AnchorContext.Provider>
        </ConnectionContext.Provider>
      </QueryClientProvider>
    );

    const { rerender } = render(
      <Wrapper query={{ field: { [StatisticsFunc.Count]: ['fldA'] } }} />
    );
    await waitFor(() => expect(current?.aggregations).toHaveLength(1));

    rerender(
      <Wrapper
        query={{ field: { [StatisticsFunc.Count]: ['fldA'], [StatisticsFunc.Filled]: ['fldB'] } }}
      />
    );
    await waitFor(() => expect(getAggregation).toHaveBeenCalledTimes(2));
    expect(current?.aggregations).toEqual([aggregation('fldA', StatisticsFunc.Count)]);

    resolveNext({
      data: {
        aggregations: [
          aggregation('fldA', StatisticsFunc.Count),
          aggregation('fldB', StatisticsFunc.Filled),
        ],
      },
    });
    await waitFor(() => expect(current?.aggregations).toHaveLength(2));
    client.clear();
  });
});
