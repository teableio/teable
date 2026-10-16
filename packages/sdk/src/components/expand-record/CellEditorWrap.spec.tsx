import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ILinkCellValue, ILinkFieldOptions } from '@teable/core';
import { FieldType, Relationship } from '@teable/core';
import type * as OpenApi from '@teable/openapi';
import type { ShareViewGetVo } from '@teable/openapi';
import { fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { ShareViewContext } from '../../context/table/ShareViewContext';
import { TableContext } from '../../context/table/TableContext';
import type { Field, Table } from '../../model';
import type { ICellValueEditor } from '../cell-value-editor/type';
import { CellEditorWrap } from './CellEditorWrap';

const captured = vi.hoisted(() => ({
  expandedRecordIds: [] as (string | undefined)[],
  expandRecorders: [] as { tableId: string; recordId?: string }[],
  foreignTableListBaseIds: [] as string[],
  foreignTables: [] as { id: string }[],
  deferForeignTableList: false,
  resolveForeignTableList: undefined as undefined | (() => void),
}));

vi.mock('../../context/app/i18n', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

// A cross-base link reads the foreign base's table list; keep the answer per case.
vi.mock('@teable/openapi', async (importOriginal) => {
  const actual = await importOriginal<typeof OpenApi>();
  return {
    ...actual,
    getTableList: vi.fn((baseId: string) => {
      captured.foreignTableListBaseIds.push(baseId);
      if (captured.deferForeignTableList) {
        const { promise, resolve } = Promise.withResolvers<{ data: { id: string }[] }>();
        captured.resolveForeignTableList = () => resolve({ data: captured.foreignTables });
        return promise;
      }
      return Promise.resolve({ data: captured.foreignTables });
    }),
  };
});

// The child table only has to prove it is the grid rendering, not to fetch records.
vi.mock('../editor/link/LinkList', async () => {
  const { forwardRef } = await import('react');
  return {
    LinkList: forwardRef<unknown, object>((_props, _ref) => (
      <div data-testid="linked-child-table" />
    )),
  };
});

vi.mock('../../context/table/LinkViewProvider', () => ({
  LinkViewProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

vi.mock('../../context/aggregation/RowCountProvider', () => ({
  RowCountProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

// The linked record is opened by this mechanism; capture what it was asked to open
// instead of mounting the whole record-detail modal.
vi.mock('./index', () => ({
  ExpandRecorder: (props: { tableId: string; recordId?: string }) => {
    captured.expandedRecordIds.push(props.recordId);
    captured.expandRecorders.push({ tableId: props.tableId, recordId: props.recordId });
    return null;
  },
  isLinkedRecordOpen: () => false,
}));

const linkField = {
  id: 'fldProduct',
  tableId: 'tblHost',
  type: FieldType.Link,
  isComputed: false,
  options: {
    foreignTableId: 'tblProduct',
    relationship: Relationship.ManyMany,
    isOneWay: false,
  } as ILinkFieldOptions,
} as unknown as Field;

// Same foreign table, reached from another base: the current base's table list cannot
// say whether it is readable.
const crossBaseLinkField = {
  ...linkField,
  options: { ...linkField.options, baseId: 'bseOther' } as ILinkFieldOptions,
} as unknown as Field;

const hostTables = [{ id: 'tblHost' }];

const cellValue: ILinkCellValue[] = [
  { id: 'recApple', title: '苹果' },
  { id: 'recBanana', title: '香蕉' },
];

// The record detail reads the current user's readable tables from this context; a
// restricted project only lists its authority-matrix tables there.
const renderLinkCell = (
  options: {
    tables?: { id: string }[];
    field?: Field;
    shareId?: string;
    deferForeignTableList?: boolean;
  } & Partial<ICellValueEditor> = {}
) => {
  const {
    tables = [...hostTables, { id: 'tblProduct' }],
    field = linkField,
    shareId,
    deferForeignTableList = false,
    ...props
  } = options;
  captured.expandedRecordIds = [];
  captured.expandRecorders = [];
  captured.foreignTableListBaseIds = [];
  captured.deferForeignTableList = deferForeignTableList;
  captured.resolveForeignTableList = undefined;
  return render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <ShareViewContext.Provider value={{ shareId } as ShareViewGetVo}>
        <TableContext.Provider value={{ tables: tables as unknown as Table[] }}>
          <CellEditorWrap
            field={field}
            recordId="recOrder1"
            cellValue={cellValue}
            onChange={vi.fn()}
            readonly={false}
            {...props}
          />
        </TableContext.Provider>
      </ShareViewContext.Provider>
    </QueryClientProvider>
  );
};

const tag = (title: string) => screen.getByText(title).closest('[role="button"]') as HTMLElement;

describe('expanded record link cell', () => {
  it('renders the embedded child table while the project lists the linked table', () => {
    const { container } = renderLinkCell();

    expect(screen.queryByTestId('linked-child-table')).not.toBeNull();
    // The child table's own scroll box, not a list of tags.
    expect(container.querySelector('.h-40')).not.toBeNull();
    expect(screen.queryByText('苹果')).toBeNull();
  });

  it('mounts the linked record detail behind a readonly child table', () => {
    renderLinkCell({ readonly: true });

    expect(screen.queryByTestId('linked-child-table')).not.toBeNull();
    expect(captured.expandRecorders.some((it) => it.tableId === 'tblProduct')).toBe(true);
  });

  it('renders the embedded child table when the host mounts no table list', () => {
    renderLinkCell({ tables: [] });

    expect(screen.queryByTestId('linked-child-table')).not.toBeNull();
  });

  it('keeps the linked record expander off a readonly cell inside a share view', () => {
    renderLinkCell({ readonly: true, shareId: 'shrShare' });

    expect(captured.expandRecorders).toHaveLength(0);
  });

  it('mounts the linked record detail for an editable cell inside a share view', () => {
    renderLinkCell({ shareId: 'shrShare' });

    expect(captured.expandRecorders.some((it) => it.tableId === 'tblProduct')).toBe(true);
  });

  it('renders the compact tags for a field without its own table id when the list hides the linked table', () => {
    renderLinkCell({
      field: { ...linkField, tableId: undefined } as unknown as Field,
      tables: [...hostTables, { id: 'tblUnrelated' }],
    });

    expect(screen.queryByTestId('linked-child-table')).toBeNull();
    expect(screen.getByText('苹果')).toBeDefined();
  });

  it('renders the compact tags for a readonly record when the host mounts no table list', () => {
    renderLinkCell({ tables: [], readonly: true });

    expect(screen.queryByTestId('linked-child-table')).toBeNull();
    expect(screen.getByText('苹果')).toBeDefined();
  });

  it('renders the embedded child table when an editable cell mounted another base list', () => {
    renderLinkCell({ tables: [{ id: 'tblOtherBase' }] });

    expect(screen.queryByTestId('linked-child-table')).not.toBeNull();
  });

  it('renders the compact tags when the mounted list belongs to another base', () => {
    renderLinkCell({ tables: [{ id: 'tblOtherBase' }], readonly: true });

    expect(screen.queryByTestId('linked-child-table')).toBeNull();
    expect(screen.getByText('苹果')).toBeDefined();
  });

  it('renders the compact tags when the project does not list the linked table', () => {
    renderLinkCell({ tables: [...hostTables, { id: 'tblUnrelated' }] });

    expect(screen.queryByTestId('linked-child-table')).toBeNull();
    expect(screen.getByText('苹果')).toBeDefined();
    expect(screen.getByText('香蕉')).toBeDefined();
  });

  it('renders the embedded child table for a cross-base link whose foreign table is listed', async () => {
    captured.foreignTables = [{ id: 'tblProduct' }];
    renderLinkCell({ field: crossBaseLinkField, tables: [...hostTables, { id: 'tblUnrelated' }] });

    expect(await screen.findByTestId('linked-child-table')).not.toBeNull();
    expect(captured.foreignTableListBaseIds.at(-1)).toBe('bseOther');
  });

  it('renders the compact tags for a cross-base link whose foreign table is not listed', async () => {
    captured.foreignTables = [{ id: 'tblUnrelated' }];
    renderLinkCell({ field: crossBaseLinkField, tables: [...hostTables, { id: 'tblUnrelated' }] });

    expect(await screen.findByText('苹果')).toBeDefined();
    expect(screen.queryByTestId('linked-child-table')).toBeNull();
  });

  it('renders the compact tags until the foreign project answers', async () => {
    captured.foreignTables = [{ id: 'tblProduct' }];
    renderLinkCell({
      field: crossBaseLinkField,
      tables: [...hostTables],
      deferForeignTableList: true,
    });

    expect(screen.getByText('苹果')).toBeDefined();
    expect(screen.queryByTestId('linked-child-table')).toBeNull();

    captured.resolveForeignTableList?.();

    expect(await screen.findByTestId('linked-child-table')).not.toBeNull();
  });

  it('opens the linked record detail when a tag is clicked', () => {
    renderLinkCell({ tables: [...hostTables, { id: 'tblUnrelated' }] });
    fireEvent.click(screen.getByText('苹果'));

    expect(captured.expandedRecordIds.at(-1)).toBe('recApple');
  });

  it('unlinks the record from its tag without opening it', () => {
    const onChange = vi.fn();
    renderLinkCell({ tables: [...hostTables, { id: 'tblUnrelated' }], onChange });
    fireEvent.click(tag('苹果').querySelector('button') as HTMLButtonElement);

    expect(onChange).toHaveBeenCalledWith([{ id: 'recBanana', title: '香蕉' }]);
    expect(captured.expandedRecordIds.at(-1)).toBeUndefined();
  });

  it('renders tags without an unlink control for a readonly record', () => {
    renderLinkCell({ tables: [...hostTables, { id: 'tblUnrelated' }], readonly: true });

    expect(tag('苹果').querySelector('button')).toBeNull();
    fireEvent.click(screen.getByText('苹果'));
    expect(captured.expandedRecordIds.at(-1)).toBeUndefined();
  });

  it('falls back to the untitled label for an empty linked record title', () => {
    renderLinkCell({
      tables: [...hostTables, { id: 'tblUnrelated' }],
      cellValue: [{ id: 'recApple', title: '' }],
    });

    expect(screen.getByText('common.untitled')).toBeDefined();
  });
});
