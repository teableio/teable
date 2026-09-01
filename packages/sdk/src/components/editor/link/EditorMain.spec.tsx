import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ILinkFieldOptions } from '@teable/core';
import { Relationship } from '@teable/core';
import type * as OpenApi from '@teable/openapi';
import type { IGetRecordsRo } from '@teable/openapi';
import { act, fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import type * as Context from '../../../context';
import type * as I18n from '../../../context/app/i18n';
import type * as Hooks from '../../../hooks';
import { LinkEditorMain } from './EditorMain';

const captured = vi.hoisted(() => ({
  queries: [] as (IGetRecordsRo | undefined)[],
  permissionBaseIds: [] as (string | undefined)[],
  createRecord: undefined as ((recordId: string) => void) | undefined,
}));

vi.mock('@teable/openapi', async (importOriginal) => {
  const actual = await importOriginal<typeof OpenApi>();
  return {
    ...actual,
    getRecordIndex: vi.fn().mockResolvedValue({ data: { index: 0 } }),
  };
});

vi.mock('../../../hooks', async (importOriginal) => {
  const actual = await importOriginal<typeof Hooks>();
  return {
    ...actual,
    useBaseId: () => 'bseTest',
    useTableId: () => 'tblForeign',
    useViewId: () => undefined,
    useTables: () => [],
    useRowCount: () => 10,
    useSearch: () => ({ searchQuery: undefined }),
  };
});

vi.mock('../../../context', async (importOriginal) => {
  const actual = await importOriginal<typeof Context>();
  return {
    ...actual,
    LinkViewProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
    RowCountProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
    TablePermissionProvider: ({
      baseId,
      children,
    }: {
      baseId: string | undefined;
      children: ReactNode;
    }) => {
      captured.permissionBaseIds.push(baseId);
      return <>{children}</>;
    },
  };
});

vi.mock('../../../context/app/i18n', async (importOriginal) => {
  const actual = await importOriginal<typeof I18n>();
  return {
    ...actual,
    useTranslation: () => ({ t: (key: string) => key }),
  };
});

vi.mock('../../search', () => ({
  SearchInput: () => null,
}));

vi.mock('../../create-record', () => ({
  CreateRecordModal: ({
    children,
    callback,
  }: {
    children: ReactNode;
    callback?: (recordId: string) => void;
  }) => {
    captured.createRecord = callback;
    return <>{children}</>;
  },
}));

vi.mock('./LinkList', async () => {
  const { forwardRef } = await import('react');
  return {
    LinkList: forwardRef<unknown, { recordQuery?: IGetRecordsRo }>((props, _ref) => {
      captured.queries.push(props.recordQuery);
      return null;
    }),
  };
});

const options = {
  relationship: Relationship.OneMany,
  foreignTableId: 'tblForeign',
} as ILinkFieldOptions;

describe('LinkEditorMain', () => {
  it('restores filterLinkCellCandidate when switching back to the all list (T6679)', () => {
    render(
      <QueryClientProvider client={new QueryClient()}>
        <LinkEditorMain fieldId="fldLink" recordId="recHost" options={options} isEditing />
      </QueryClientProvider>
    );

    const lastQuery = () => captured.queries.at(-1);

    expect(lastQuery()?.filterLinkCellCandidate).toEqual(['fldLink', 'recHost']);
    expect(lastQuery()?.filterLinkCellSelected).toBeUndefined();

    fireEvent.click(screen.getByText('editor.link.selected'));
    expect(lastQuery()?.filterLinkCellSelected).toEqual(['fldLink', 'recHost']);
    expect(lastQuery()?.filterLinkCellCandidate).toBeUndefined();

    fireEvent.click(screen.getByText('editor.link.all'));
    expect(lastQuery()?.filterLinkCellCandidate).toEqual(['fldLink', 'recHost']);
    expect(lastQuery()?.filterLinkCellSelected).toBeUndefined();
  });

  it('wraps the create-record modal with the real table permission (T6683)', () => {
    captured.permissionBaseIds.length = 0;
    render(
      <QueryClientProvider client={new QueryClient()}>
        <LinkEditorMain fieldId="fldLink" recordId="recHost" options={options} isEditing />
      </QueryClientProvider>
    );

    expect(captured.permissionBaseIds).toEqual(['bseTest']);
  });

  it('invalidates share-view list caches by link field id after creating a record (T7056)', async () => {
    const queryClient = new QueryClient();
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

    render(
      <QueryClientProvider client={queryClient}>
        <LinkEditorMain fieldId="fldLink" recordId="recHost" options={options} isEditing />
      </QueryClientProvider>
    );

    expect(captured.createRecord).toBeTypeOf('function');
    invalidateSpy.mockClear();

    await act(async () => {
      captured.createRecord?.('recNew');
    });
    const keys = invalidateSpy.mock.calls
      .map((call) => (call[0] as { queryKey?: unknown } | undefined)?.queryKey)
      .filter(Boolean);
    expect(keys).toContainEqual(['link-editor-records', 'fldLink']);
    expect(keys).toContainEqual(['share-view-row-count', 'fldLink']);
    expect(keys).not.toContainEqual(['link-editor-records', 'tblForeign']);
    expect(keys).not.toContainEqual(['row-count', 'tblForeign']);
  });
});
