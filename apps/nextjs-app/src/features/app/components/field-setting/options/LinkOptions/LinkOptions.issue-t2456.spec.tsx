import { QueryClientProvider } from '@tanstack/react-query';
import { Relationship } from '@teable/core';
import { getTablePermission } from '@teable/openapi';
import { createQueryClient } from '@teable/sdk/context';
import { sonner } from '@teable/ui-lib';
import { render, waitFor } from '@testing-library/react';
import { LinkOptions } from './LinkOptions';

vi.mock('@teable/openapi', async (importOriginal) => {
  const actual = await importOriginal<object>();
  return { ...actual, getTablePermission: vi.fn(), getFields: vi.fn() };
});

vi.mock('@teable/sdk/hooks', async (importOriginal) => {
  const actual = await importOriginal<object>();
  return { ...actual, useBaseId: () => 'bseSelf', useTableId: () => 'tblSelf' };
});

vi.mock('./SelectTable', () => ({ SelectTable: () => null }));
vi.mock('./MoreLinkOptions', () => ({ MoreLinkOptions: () => null }));

describe('LinkOptions foreign table permission (T2456)', () => {
  beforeEach(() => {
    vi.spyOn(sonner.toast, 'error').mockImplementation(() => '');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('does not toast a global error when the foreign table permission request is 403', async () => {
    vi.mocked(getTablePermission).mockRejectedValue({
      status: 403,
      code: 'restricted_resource',
      message: 'not allowed to access table',
    });
    const queryClient = createQueryClient();

    render(
      <QueryClientProvider client={queryClient}>
        <LinkOptions
          fieldId="fldLink"
          options={{
            baseId: 'bseOther',
            foreignTableId: 'tblNoAccess',
            relationship: Relationship.ManyMany,
          }}
        />
      </QueryClientProvider>
    );

    await waitFor(() => expect(getTablePermission).toHaveBeenCalledWith('bseOther', 'tblNoAccess'));
    await waitFor(() =>
      expect(
        queryClient.getQueryState(['table-permission', 'bseOther', 'tblNoAccess'])?.status
      ).not.toBe('pending')
    );

    expect(sonner.toast.error).not.toHaveBeenCalled();
  });
});
