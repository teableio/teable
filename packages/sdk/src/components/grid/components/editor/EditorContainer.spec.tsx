import { fireEvent, render } from '@testing-library/react';
import { act } from 'react';
import { createPortal } from 'react-dom';
import { vi } from 'vitest';
import { gridTheme } from '../../configs';
import type { IScrollState } from '../../interface';
import { SelectionRegionType } from '../../interface';
import { CombinedSelection, CoordinateManager } from '../../managers';
import type { ICell, IInnerCell } from '../../renderers';
import { CellType } from '../../renderers';
import { EditorContainer } from './EditorContainer';

const coordInstance = new CoordinateManager({
  rowCount: 2,
  pureRowCount: 2,
  columnCount: 2,
  containerWidth: 800,
  containerHeight: 600,
  rowHeight: 32,
  columnWidth: 150,
});

const scrollState: IScrollState = { scrollLeft: 0, scrollTop: 0, isScrolling: false };
const selection = new CombinedSelection(SelectionRegionType.Cells, [
  [0, 0],
  [0, 0],
]);

const customEditor = () => (
  <>
    <div data-testid="custom-editor" />
    {createPortal(<div data-testid="portalled-dialog" />, document.body)}
  </>
);

const renderContainer = ({
  cell,
  isEditing,
}: {
  cell: Partial<IInnerCell>;
  isEditing?: boolean;
}) => {
  const onContextMenu = vi.fn();
  const utils = render(
    <EditorContainer
      theme={gridTheme}
      isEditing={isEditing}
      selection={selection}
      activeCell={[0, 0]}
      scrollState={scrollState}
      coordInstance={coordInstance}
      activeCellBound={null}
      setEditing={vi.fn()}
      setSelection={vi.fn()}
      setActiveCell={vi.fn()}
      getCellContent={() =>
        ({ type: CellType.Text, data: 'x', displayData: 'x', ...cell }) as IInnerCell
      }
      real2RowIndex={(index) => index}
      scrollToItem={vi.fn()}
      scrollBy={vi.fn()}
      onContextMenu={onContextMenu}
    />
  );
  return { ...utils, onContextMenu };
};

const readonlyCell: Partial<IInnerCell> = {
  readonly: true,
  readonlyCustomEditor: true,
  customEditor,
};

describe('EditorContainer context menu', () => {
  it('hands a context menu event on the readonly custom editor to the grid', () => {
    const { getByTestId, onContextMenu } = renderContainer({ cell: readonlyCell });

    const notPrevented = fireEvent.contextMenu(getByTestId('custom-editor'));

    expect(onContextMenu).toHaveBeenCalledTimes(1);
    expect(notPrevented).toBe(false);
  });

  it('ignores context menu events bubbling from portalled editor content', () => {
    const { getByTestId, onContextMenu } = renderContainer({ cell: readonlyCell });

    fireEvent.contextMenu(getByTestId('portalled-dialog'));

    expect(onContextMenu).not.toHaveBeenCalled();
  });

  it('keeps the native context menu while an editable custom editor is open', () => {
    const { getByTestId, onContextMenu } = renderContainer({
      cell: { customEditor },
      isEditing: true,
    });

    const notPrevented = fireEvent.contextMenu(getByTestId('custom-editor'));

    expect(onContextMenu).not.toHaveBeenCalled();
    expect(notPrevented).toBe(true);
  });

  it('hands a context menu event on an idle editable custom editor to the grid', () => {
    const { getByTestId, onContextMenu } = renderContainer({ cell: { customEditor } });

    fireEvent.contextMenu(getByTestId('custom-editor'));

    expect(onContextMenu).toHaveBeenCalledTimes(1);
  });
});

describe('EditorContainer row selection copy', () => {
  it('focuses the hidden input for a row selection without an active cell so copy can fire', async () => {
    const onCopy = vi.fn();
    const onPaste = vi.fn();
    const rowSelection = new CombinedSelection(SelectionRegionType.Rows, [[0, 0]]);
    const { container } = render(
      <div data-t-grid-container role="grid" tabIndex={0}>
        <EditorContainer
          theme={gridTheme}
          isEditing={false}
          selection={rowSelection}
          activeCell={null}
          scrollState={scrollState}
          coordInstance={coordInstance}
          activeCellBound={null}
          setEditing={vi.fn()}
          setSelection={vi.fn()}
          setActiveCell={vi.fn()}
          getCellContent={(): ICell => ({ type: CellType.Loading })}
          real2RowIndex={(index) => index}
          scrollToItem={vi.fn()}
          scrollBy={vi.fn()}
          onCopy={onCopy}
          onPaste={onPaste}
        />
      </div>
    );

    (container.firstElementChild as HTMLElement).focus();

    await act(async () => {
      await new Promise<void>((resolve) => {
        requestAnimationFrame(() => resolve());
      });
    });

    const hiddenInput = container.querySelector('input');
    expect(hiddenInput).not.toBeNull();
    expect(document.activeElement).toBe(hiddenInput);

    fireEvent.copy(hiddenInput as HTMLInputElement);
    fireEvent.paste(hiddenInput as HTMLInputElement);

    expect(onCopy).toHaveBeenCalledTimes(1);
    expect(onCopy.mock.calls[0][0].type).toBe(SelectionRegionType.Rows);
    expect(onPaste).toHaveBeenCalledTimes(1);
    expect(onPaste.mock.calls[0][0].type).toBe(SelectionRegionType.Rows);
  });

  it('keeps focus on another field when a linked grid synchronizes its selected rows', async () => {
    const renderDialog = () => (
      <div role="dialog">
        <button>Member</button>
        <div data-t-grid-container role="grid" tabIndex={0}>
          <EditorContainer
            theme={gridTheme}
            isEditing={false}
            selection={new CombinedSelection(SelectionRegionType.Rows, [[0, 0]])}
            activeCell={null}
            scrollState={scrollState}
            coordInstance={coordInstance}
            activeCellBound={null}
            setEditing={vi.fn()}
            setSelection={vi.fn()}
            setActiveCell={vi.fn()}
            getCellContent={(): ICell => ({ type: CellType.Loading })}
            real2RowIndex={(index) => index}
            scrollToItem={vi.fn()}
            scrollBy={vi.fn()}
          />
        </div>
      </div>
    );
    const { getByRole, rerender } = render(renderDialog());
    const member = getByRole('button', { name: 'Member' });
    member.focus();

    await act(async () => {
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    });
    expect(document.activeElement).toBe(member);

    rerender(renderDialog());
    await act(async () => {
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    });
    expect(document.activeElement).toBe(member);
  });

  it('does not steal focus while the active cell content is still loading', async () => {
    const cellSelection = new CombinedSelection(SelectionRegionType.Cells, [
      [0, 0],
      [0, 0],
    ]);
    const { container } = render(
      <EditorContainer
        theme={gridTheme}
        isEditing={false}
        selection={cellSelection}
        activeCell={[0, 0]}
        scrollState={scrollState}
        coordInstance={coordInstance}
        activeCellBound={null}
        setEditing={vi.fn()}
        setSelection={vi.fn()}
        setActiveCell={vi.fn()}
        getCellContent={(): ICell => ({ type: CellType.Loading })}
        real2RowIndex={(index) => index}
        scrollToItem={vi.fn()}
        scrollBy={vi.fn()}
      />
    );

    await act(async () => {
      await new Promise<void>((resolve) => {
        requestAnimationFrame(() => resolve());
      });
    });

    expect(document.activeElement).not.toBe(container.querySelector('input'));
  });
});
