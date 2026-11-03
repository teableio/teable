import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { getFieldDeleteReferences } from '@teable/openapi';
import { renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { useMultiFieldReferences } from './useDeleteAnalysis';

vi.mock('@teable/openapi', () => ({ getFieldDeleteReferences: vi.fn() }));

const renderAnalysis = () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return renderHook(() => useMultiFieldReferences('tbl1', ['fld1', 'fld2'], true), { wrapper });
};

const emptyReferences = {
  dependentFields: [],
  views: [],
  workflowNodes: [],
  authorityMatrixRoles: [],
};

describe('useMultiFieldReferences', () => {
  it('requires a reference result for every requested field', async () => {
    vi.mocked(getFieldDeleteReferences).mockResolvedValueOnce({
      data: { fld1: emptyReferences },
    } as never);
    const { result } = renderAnalysis();
    await waitFor(() => expect(result.current.hasError).toBe(true));
    expect(result.current.isAllLoaded).toBe(false);
  });

  it('does not classify a failed request as loaded', async () => {
    vi.mocked(getFieldDeleteReferences).mockRejectedValueOnce(new Error('request failed'));
    const { result } = renderAnalysis();
    await waitFor(() => expect(result.current.hasError).toBe(true));
    expect(result.current.isAllLoaded).toBe(false);
  });

  it('marks complete results as loaded', async () => {
    vi.mocked(getFieldDeleteReferences).mockResolvedValueOnce({
      data: { fld1: emptyReferences, fld2: emptyReferences },
    } as never);
    const { result } = renderAnalysis();
    await waitFor(() => expect(result.current.isAllLoaded).toBe(true));
    expect(result.current.hasError).toBe(false);
  });
});
