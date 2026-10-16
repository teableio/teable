import { fireEvent, render } from '@testing-library/react';
import type { RefObject } from 'react';
import { act } from 'react';
import type * as ReactUse from 'react-use';
import { vi } from 'vitest';
import { AppContext } from '../../context/app/AppContext';
import { findUrls } from '../../utils/find-urls';
import { GRID_DEFAULT } from './configs';
import { Grid, type IGridRef } from './Grid';
import type { IGridColumn } from './interface';
import type { ICell } from './renderers';
import { CellType } from './renderers';

const pointer = { elX: 0, elY: 0 };
const CHAR_WIDTH = 8;

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

vi.mock('./utils/measure', () => ({
  measuredCanvas: {
    ctx: {
      font: '',
      measureText: (text: string) => ({ width: text.length * CHAR_WIDTH }),
    },
    reset: () => undefined,
    setFontSize: () => undefined,
  },
}));

const columns: IGridColumn[] = [{ id: 'note', name: 'Note', width: 320 }];
const displayData = 'see https://example.com';
const nextFrame = () => {
  const { promise, resolve } = Promise.withResolvers<void>();
  requestAnimationFrame(() => resolve());
  return promise;
};

// A held press selects the cell on mousedown. The click is dispatched from mouseup,
// before that ActiveCell region is committed, matching a real browser click.
const press = async (stage: HTMLElement, x: number, y: number) => {
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
  onLinkClick,
}: {
  gridRef: RefObject<IGridRef | null>;
  onLinkClick: (url: string) => void;
}) => (
  <AppContext.Provider value={{ locale: {} as never, lang: 'en' }}>
    <Grid
      ref={gridRef}
      style={{ width: 800, height: 400 }}
      columns={columns}
      rowCount={1}
      getCellContent={() =>
        ({
          type: CellType.Text,
          data: displayData,
          displayData,
          links: findUrls(displayData),
          onLinkClick,
        }) as ICell
      }
    />
  </AppContext.Provider>
);

describe('grid text URL first click', () => {
  it('opens a detected URL on the first click of an unselected text cell', async () => {
    const onLinkClick = vi.fn();
    const gridRef: RefObject<IGridRef | null> = { current: null };
    render(<Harness gridRef={gridRef} onLinkClick={onLinkClick} />);
    const stage = document.querySelector('[data-t-grid-stage]') as HTMLElement;
    const bounds = gridRef.current?.getCellBounds([0, 0]);
    expect(bounds).toBeTruthy();

    await act(async () => {
      fireEvent.mouseDown(stage);
      fireEvent.mouseUp(stage);
      await nextFrame();
    });

    const { cellHorizontalPadding, cellVerticalPaddingMD } = GRID_DEFAULT;
    const linkX = bounds!.x + cellHorizontalPadding + 'see '.length * CHAR_WIDTH + CHAR_WIDTH;
    const linkY = bounds!.y + cellVerticalPaddingMD + 4;

    await press(stage, linkX, linkY);
    expect(onLinkClick).toHaveBeenCalledTimes(1);
    expect(onLinkClick).toHaveBeenCalledWith('https://example.com');

    await press(stage, linkX, linkY);
    expect(onLinkClick).toHaveBeenCalledTimes(2);
  });
});
