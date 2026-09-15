import { fireEvent, render } from '@testing-library/react';
import { createPortal } from 'react-dom';
import { vi } from 'vitest';
import { gridTheme } from '../../configs';
import type { IScrollState } from '../../interface';
import { SelectionRegionType } from '../../interface';
import { CombinedSelection, CoordinateManager } from '../../managers';
import type { IInnerCell } from '../../renderers';
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
