import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ILinkFieldOptions } from '@teable/core';
import { Relationship } from '@teable/core';
import type { IGetRecordsRo } from '@teable/openapi';
import { fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import type * as Context from '../../../context';
import type * as I18n from '../../../context/app/i18n';
import type * as Hooks from '../../../hooks';
import { LinkEditorMain } from './EditorMain';

const captured = vi.hoisted(() => ({
  queries: [] as (IGetRecordsRo | undefined)[],
  permissionBaseIds: [] as (string | undefined)[],
}));

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
  CreateRecordModal: ({ children }: { children: ReactNode }) => <>{children}</>,
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

describe('LinkEditorMain', () => {
  it('restores filterLinkCellCandidate when switching back to the all list (T6679)', () => {
    const options = {
      relationship: Relationship.OneMany,
      foreignTableId: 'tblForeign',
    } as ILinkFieldOptions;

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
    const options = {
      relationship: Relationship.OneMany,
      foreignTableId: 'tblForeign',
    } as ILinkFieldOptions;

    captured.permissionBaseIds.length = 0;
    render(
      <QueryClientProvider client={new QueryClient()}>
        <LinkEditorMain fieldId="fldLink" recordId="recHost" options={options} isEditing />
      </QueryClientProvider>
    );

    expect(captured.permissionBaseIds).toEqual(['bseTest']);
  });
});
