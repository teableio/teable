import type { IGetRecordsRo } from '@teable/openapi';
import { act, render, screen, waitFor } from '@testing-library/react';
import type { Ref } from 'react';
import { createRef, forwardRef, useImperativeHandle, useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import type * as GridModule from '../../grid';
import type { CombinedSelection, IRange } from '../../grid';
import { RowControlType } from '../../grid';
import { LinkListType } from './interface';
import type { ILinkListRef } from './LinkList';
import { LinkList } from './LinkList';

const captured = vi.hoisted(() => ({
  recordMap: {
    0: { id: 'recY3', name: 'Y3' },
    1: { id: 'recY4', name: 'Y4' },
  } as Record<number, { id: string; name: string } | undefined>,
  isQuerying: false,
  onRowControlClick: undefined as GridModule.IGridProps['onRowControlClick'],
  onRowExpand: undefined as GridModule.IGridProps['onRowExpand'],
  recordsQuery: {
    filterLinkCellCandidate: ['fldLink', 'recHost'],
  } as IGetRecordsRo,
}));

vi.mock('../../../hooks', () => ({
  useTableId: () => 'tblForeign',
  useViewId: () => undefined,
}));

vi.mock('../../../context/app/i18n', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('../../grid-enhancements', () => ({
  GridTooltip: () => null,
  useGridIcons: () => ({}),
  useGridTheme: () => ({}),
  useGridColumns: () => ({
    columns: [{ id: 'fldName', name: 'Name', width: 120 }],
    cellValue2GridDisplay: (record: { name: string }) => ({ type: 'text', data: record.name }),
  }),
  useGridAsyncRecordsQuery: () => ({
    recordMap: captured.recordMap,
    recordsQuery: captured.recordsQuery,
    isQuerying: captured.isQuerying,
    onReset: () => {
      captured.recordMap = {};
    },
    onForceUpdate: () => undefined,
    onVisibleRegionChanged: () => undefined,
  }),
  useGridTooltipStore: () => ({
    openTooltip: () => undefined,
    closeTooltip: () => undefined,
  }),
}));

vi.mock('../../grid', async (importOriginal) => {
  const actual = await importOriginal<typeof GridModule>();
  interface MockGridProps {
    rowCount?: number;
    onRowControlClick?: GridModule.IGridProps['onRowControlClick'];
    onRowExpand?: GridModule.IGridProps['onRowExpand'];
    getCellContent: (cell: [number, number]) => unknown;
  }
  const Grid = forwardRef((props: MockGridProps, ref) => {
    captured.onRowControlClick = props.onRowControlClick;
    captured.onRowExpand = props.onRowExpand;
    const [ranges, setRanges] = useState<IRange[]>([]);
    useImperativeHandle(ref, () => ({
      setSelection: (selection: CombinedSelection) => {
        setRanges(selection.ranges);
      },
      scrollToItem: () => undefined,
      resetState: () => undefined,
      forceUpdate: () => undefined,
      getActiveCell: () => null,
      getRowOffset: () => 0,
      getScrollState: () => ({ scrollTop: 0, scrollLeft: 0, isScrolling: false }),
      scrollBy: () => undefined,
      scrollTo: () => undefined,
      setActiveCell: () => undefined,
      getCellIndicesAtPosition: () => null,
      getContainer: () => null,
      getCellBounds: () => null,
      getFreezeColumnState: () => ({
        effectiveFreezeColumnCount: 0,
        maxFreezeColumnCount: 0,
      }),
      setCellLoading: () => undefined,
      setColumnLoadings: () => undefined,
      setCellErrors: () => undefined,
      isEditing: () => false,
    }));
    return (
      <div
        data-testid="link-grid"
        data-row-count={props.rowCount}
        data-cells={JSON.stringify(
          Array.from({ length: props.rowCount ?? 0 }, (_, index) =>
            props.getCellContent([0, index])
          )
        )}
        data-selected-ranges={JSON.stringify(ranges)}
      />
    );
  });
  Grid.displayName = 'GridMock';
  return {
    ...actual,
    Grid,
  };
});

const selectedRecord = [{ id: 'recY3', title: 'Y3' }];

const renderList = (type: LinkListType, rowCount: number, listRef?: Ref<ILinkListRef>) => {
  return render(
    <LinkList
      ref={listRef}
      type={type}
      rowCount={rowCount}
      isMultiple
      cellValue={selectedRecord}
      recordQuery={captured.recordsQuery}
    />
  );
};

const expectSelectedRanges = async (ranges: IRange[]) => {
  await waitFor(() => {
    expect(screen.getByTestId('link-grid')).toHaveAttribute(
      'data-selected-ranges',
      JSON.stringify(ranges)
    );
  });
};

describe('LinkList tab switch selection (T7055)', () => {
  it('does not paint cached unselected records when the selected tab query is catching up', () => {
    captured.isQuerying = false;
    captured.recordMap = {
      0: { id: 'recY4', name: 'Y4' },
      1: { id: 'recY3', name: 'Y3' },
    };
    captured.recordsQuery = { filterLinkCellCandidate: ['fldLink', 'recHost'] };
    const view = renderList(LinkListType.All, 2);
    const grid = screen.getByTestId('link-grid');
    expect(grid.getAttribute('data-cells')).toContain('Y4');
    const onChange = vi.fn();
    const onExpand = vi.fn();

    view.rerender(
      <LinkList
        type={LinkListType.Selected}
        rowCount={2}
        isMultiple
        cellValue={selectedRecord}
        onChange={onChange}
        onExpand={onExpand}
        recordQuery={{ filterLinkCellSelected: ['fldLink', 'recHost'] }}
      />
    );

    // The canvas stays mounted, but the previous tab's unselected rows must not paint.
    expect(screen.getByTestId('link-grid')).toBe(grid);
    expect(grid.getAttribute('data-cells')).not.toContain('Y4');
    expect(grid.getAttribute('data-cells')).toContain('Y3');
    act(() => {
      captured.onRowControlClick?.(0, RowControlType.Checkbox, false);
      captured.onRowExpand?.(0);
    });
    expect(onChange).not.toHaveBeenCalled();
    expect(onExpand).not.toHaveBeenCalled();
  });

  it('keeps the selected record checked after switching to the selected tab', async () => {
    captured.isQuerying = false;
    captured.recordMap = {
      0: { id: 'recY4', name: 'Y4' },
      1: { id: 'recY3', name: 'Y3' },
    };
    captured.recordsQuery = { filterLinkCellCandidate: ['fldLink', 'recHost'] };

    const listRef = createRef<ILinkListRef>();
    const view = renderList(LinkListType.All, 2, listRef);
    await expectSelectedRanges([[1, 1]]);

    captured.recordsQuery = { filterLinkCellSelected: ['fldLink', 'recHost'] };
    captured.recordMap = {
      0: { id: 'recY3', name: 'Y3' },
    };

    view.rerender(
      <LinkList
        ref={listRef}
        type={LinkListType.Selected}
        rowCount={1}
        isMultiple
        cellValue={selectedRecord}
        recordQuery={captured.recordsQuery}
      />
    );

    await expectSelectedRanges([[0, 0]]);
  });

  it('reapplies All-tab checkboxes after switching back from the selected tab', async () => {
    captured.isQuerying = false;
    captured.recordMap = {
      0: { id: 'recY3', name: 'Y3' },
    };
    captured.recordsQuery = { filterLinkCellSelected: ['fldLink', 'recHost'] };

    const listRef = createRef<ILinkListRef>();
    const view = renderList(LinkListType.Selected, 1, listRef);
    await expectSelectedRanges([[0, 0]]);

    captured.recordsQuery = { filterLinkCellCandidate: ['fldLink', 'recHost'] };
    captured.recordMap = {
      0: { id: 'recY4', name: 'Y4' },
      1: { id: 'recY3', name: 'Y3' },
    };

    view.rerender(
      <LinkList
        ref={listRef}
        type={LinkListType.All}
        rowCount={2}
        isMultiple
        cellValue={selectedRecord}
        recordQuery={captured.recordsQuery}
      />
    );

    await expectSelectedRanges([[1, 1]]);
  });
});
