import { fireEvent, render } from '@testing-library/react';
import type { RefObject } from 'react';
import { act } from 'react';
import type * as ReactUse from 'react-use';
import { vi } from 'vitest';
import { AppContext } from '../../context/app/AppContext';
import { Grid, type IGridRef } from './Grid';
import type { IGridColumn } from './interface';
import type { ICell } from './renderers';
import { CellType } from './renderers';

const pointer = { elX: 0, elY: 0 };

vi.mock('react-use', async () => {
  const actual = await vi.importActual<typeof ReactUse>('react-use');
  return {
    ...actual,
    useMouse: () => ({
      get docX() {
        return pointer.elX;
      },
      get docY() {
        return pointer.elY;
      },
      get posX() {
        return pointer.elX;
      },
      get posY() {
        return pointer.elY;
      },
      get elX() {
        return pointer.elX;
      },
      get elY() {
        return pointer.elY;
      },
      elW: 800,
      elH: 400,
    }),
  };
});

const columns: IGridColumn[] = [
  { id: 'first', name: 'First', width: 150 },
  { id: 'second', name: 'Second', width: 150 },
];

const nextFrame = () => {
  const { promise, resolve } = Promise.withResolvers<void>();
  requestAnimationFrame(() => resolve());
  return promise;
};

const flushFrames = async (count: number) => {
  await act(async () => {
    for (let i = 0; i < count; i++) await nextFrame();
  });
};

const pointAt = async (stage: HTMLElement, x: number, y: number) => {
  pointer.elX = x;
  pointer.elY = y;
  await act(async () => {
    fireEvent.mouseMove(stage);
    await nextFrame();
  });
};

// Renders a 2x2 grid whose cells record every render of their editor, then puts the top-left
// cell into editing mode.
const renderEditingGrid = async () => {
  // Every render of the active cell editor: which cell it is for and whether it edits
  const editorRenders: Array<{ cell: string; isEditing?: boolean }> = [];
  const gridRef: RefObject<IGridRef | null> = { current: null };
  render(
    <AppContext.Provider value={{ locale: {} as never, lang: 'en' }}>
      <Grid
        ref={gridRef}
        style={{ width: 800, height: 400 }}
        columns={columns}
        rowCount={2}
        getCellContent={([columnIndex, rowIndex]) =>
          ({
            type: CellType.Text,
            data: `${columnIndex}:${rowIndex}`,
            displayData: `${columnIndex}:${rowIndex}`,
            customEditor: (props) => {
              editorRenders.push({ cell: props.cell.data as string, isEditing: props.isEditing });
              return <div />;
            },
          }) as ICell
        }
      />
    </AppContext.Provider>
  );
  const stage = document.querySelector('[data-t-grid-stage]') as HTMLElement;

  // The native move listener attaches on the first pointer re-render.
  await act(async () => {
    fireEvent.mouseDown(stage);
    fireEvent.mouseUp(stage);
    await nextFrame();
  });

  const bounds = gridRef.current!.getCellBounds([0, 0])!;
  await pointAt(stage, bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
  await act(async () => {
    fireEvent.mouseDown(stage);
    fireEvent.mouseUp(stage);
    await nextFrame();
    await nextFrame();
    // The grid reads a double click from the click event's detail
    fireEvent.click(stage, { detail: 2 });
    await nextFrame();
  });
  expect(gridRef.current!.isEditing()).toBe(true);
  editorRenders.length = 0;

  return { stage, gridRef, editorRenders };
};

// Leaving editing while the edited cell is still active paints it in its expanded active
// layout for a frame (T2422). Each input is flushed in its own act, apart from the frames
// that move the rAF-backed active cell, so that intermediate render is not batched away.
describe('grid edit exit', () => {
  it('moves the selection on the same frame when clicking another cell', async () => {
    const { stage, gridRef, editorRenders } = await renderEditingGrid();
    const target = gridRef.current!.getCellBounds([0, 1])!;
    await pointAt(stage, target.x + target.width / 2, target.y + target.height / 2);
    editorRenders.length = 0;

    act(() => {
      fireEvent.mouseDown(stage);
    });
    await flushFrames(2);
    act(() => {
      fireEvent.mouseUp(stage);
    });
    await flushFrames(1);

    expect(gridRef.current!.isEditing()).toBe(false);
    expect(gridRef.current!.getActiveCell()).toEqual([0, 1]);
    expect(editorRenders).not.toContainEqual({ cell: '0:0', isEditing: false });
  });

  it('clears the selection on the same frame when clicking the blank area below the rows', async () => {
    const { stage, gridRef, editorRenders } = await renderEditingGrid();
    const lastRow = gridRef.current!.getCellBounds([0, 1])!;
    await pointAt(stage, lastRow.x + lastRow.width / 2, lastRow.y + lastRow.height * 4);
    editorRenders.length = 0;

    act(() => {
      fireEvent.mouseDown(stage);
    });
    await flushFrames(2);
    act(() => {
      fireEvent.mouseUp(stage);
    });
    await flushFrames(1);

    expect(gridRef.current!.isEditing()).toBe(false);
    expect(gridRef.current!.getActiveCell()).toBeNull();
    expect(editorRenders).not.toContainEqual({ cell: '0:0', isEditing: false });
  });

  it('moves the selection on the same frame when pressing Tab', async () => {
    const { gridRef, editorRenders } = await renderEditingGrid();

    act(() => {
      fireEvent.keyDown(document, { key: 'Tab', code: 'Tab' });
    });
    await flushFrames(2);

    expect(gridRef.current!.isEditing()).toBe(false);
    expect(gridRef.current!.getActiveCell()).toEqual([1, 0]);
    expect(editorRenders).not.toContainEqual({ cell: '0:0', isEditing: false });
  });

  it('moves the selection on the same frame when pressing Enter', async () => {
    const { gridRef, editorRenders } = await renderEditingGrid();

    act(() => {
      fireEvent.keyDown(document, { key: 'Enter', code: 'Enter' });
    });
    // Enter defers the move with a timeout before the active cell's frame
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve));
    });
    await flushFrames(2);

    expect(gridRef.current!.isEditing()).toBe(false);
    expect(gridRef.current!.getActiveCell()).toEqual([0, 1]);
    expect(editorRenders).not.toContainEqual({ cell: '0:0', isEditing: false });
  });
});
