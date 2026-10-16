import { fireEvent, render } from '@testing-library/react';
import type { RefObject } from 'react';
import { act, useState } from 'react';
import type * as ReactUse from 'react-use';
import { vi } from 'vitest';
import { AppContext } from '../../context/app/AppContext';
import { GRID_DEFAULT, gridTheme } from './configs';
import { Grid, type IGridRef } from './Grid';
import type { ICellItem, IGridColumn } from './interface';
import type { ICell, IInnerCell } from './renderers';
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
  { id: 'rating', name: 'Rating', width: 150 },
  { id: 'done', name: 'Done', width: 150 },
];

const nextFrame = () => {
  const { promise, resolve } = Promise.withResolvers<void>();
  requestAnimationFrame(() => resolve());
  return promise;
};

// A held press selects the cell on mousedown. The click is dispatched from mouseup,
// before that ActiveCell region is committed, matching a real browser click.
const pressIcon = async (stage: HTMLElement, x: number, y: number) => {
  pointer.elX = x;
  pointer.elY = y;
  await act(async () => {
    fireEvent.mouseMove(stage);
    await nextFrame();
    fireEvent.mouseDown(stage);
    await nextFrame();
  });
  const clicked = Promise.withResolvers<void>();
  const onMouseUp = () => {
    stage.dispatchEvent(
      new MouseEvent('click', {
        bubbles: true,
        detail: 1,
        clientX: pointer.elX,
        clientY: pointer.elY,
      })
    );
    clicked.resolve();
  };
  stage.addEventListener('mouseup', onMouseUp);
  await act(async () => {
    fireEvent.mouseUp(stage);
    await clicked.promise;
    await nextFrame();
  });
  stage.removeEventListener('mouseup', onMouseUp);
};

const Harness = ({
  gridRef,
  onCellEdited,
}: {
  gridRef: RefObject<IGridRef | null>;
  onCellEdited: (cell: ICellItem, value: IInnerCell) => void;
}) => {
  const [rating, setRating] = useState<number | null>(null);
  const [checked, setChecked] = useState<boolean | null>(null);

  return (
    <AppContext.Provider value={{ locale: {} as never, lang: 'en' }}>
      <Grid
        ref={gridRef}
        style={{ width: 800, height: 400 }}
        columns={columns}
        rowCount={1}
        onCellEdited={(cell, value) => {
          onCellEdited(cell, value);
          if (cell[0] === 0) setRating((value.data as number | null) ?? null);
          if (cell[0] === 1) setChecked((value.data as boolean | null) ?? null);
        }}
        getCellContent={(cell) => {
          const [columnIndex] = cell;
          if (columnIndex === 0) {
            return {
              type: CellType.Rating,
              data: rating ?? 0,
              icon: 'star',
              color: '#f5a623',
              max: 5,
            } as ICell;
          }
          return {
            type: CellType.Boolean,
            data: Boolean(checked),
          } as ICell;
        }}
      />
    </AppContext.Provider>
  );
};

describe('grid icon first click', () => {
  it('sets a rating and a checkbox on the first icon click without a prior selection', async () => {
    const onCellEdited = vi.fn();
    const gridRef: RefObject<IGridRef | null> = { current: null };
    render(<Harness gridRef={gridRef} onCellEdited={onCellEdited} />);
    const stage = document.querySelector('[data-t-grid-stage]') as HTMLElement;
    const ratingBounds = gridRef.current?.getCellBounds([0, 0]);
    const checkboxBounds = gridRef.current?.getCellBounds([1, 0]);
    expect(ratingBounds).toBeTruthy();
    expect(checkboxBounds).toBeTruthy();

    // The native move listener attaches on the first pointer re-render.
    await act(async () => {
      fireEvent.mouseDown(stage);
      fireEvent.mouseUp(stage);
      await nextFrame();
    });

    const { iconSizeXS } = gridTheme;
    const gap = 3;
    const ratingX =
      ratingBounds!.x +
      GRID_DEFAULT.cellHorizontalPadding +
      2 * (iconSizeXS + gap) +
      iconSizeXS / 2;
    const ratingY = ratingBounds!.y + ratingBounds!.height / 2;
    const checkboxX = checkboxBounds!.x + checkboxBounds!.width / 2;
    const checkboxY = checkboxBounds!.y + checkboxBounds!.height / 2;

    await pressIcon(stage, ratingX, ratingY);
    expect(onCellEdited.mock.calls.map((call) => call[1].data)).toEqual([3]);

    await pressIcon(stage, ratingX, ratingY);
    expect(onCellEdited.mock.calls.map((call) => call[1].data)).toEqual([3, null]);

    await pressIcon(stage, checkboxX, checkboxY);
    expect(onCellEdited.mock.calls.map((call) => call[1].data)).toEqual([3, null, true]);

    await pressIcon(stage, checkboxX, checkboxY);
    expect(onCellEdited.mock.calls.map((call) => call[1].data)).toEqual([3, null, true, null]);
  });
});
