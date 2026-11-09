import type { DragEndEvent } from '@teable/ui-lib';
import type * as UiLib from '@teable/ui-lib';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { ComponentProps } from 'react';
import type { Mock } from 'vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createAppContext } from '../../context/__tests__/createAppContext';
import type * as I18n from '../../context/app/i18n';
import type { IFieldInstance } from '../../model';
import { VisibleFields } from './VisibleFields';

const state = vi.hoisted(() => ({
  fields: [] as { id: string; name: string; isPrimary?: boolean }[],
  view: undefined as
    | {
        id: string;
        columnMeta: Record<string, { order: number; visible?: boolean }>;
        updateColumnMeta: Mock;
      }
    | undefined,
  dragEnd: undefined as ((event: DragEndEvent) => void) | undefined,
}));

vi.mock('../../hooks', () => ({
  useViewId: () => state.view?.id,
  useFields: () => state.fields as IFieldInstance[],
  useView: () => state.view,
  useFieldStaticGetter: () => () => ({ Icon: () => null }),
  useIsMobile: () => false,
  useIsHydrated: () => true,
}));

vi.mock('../../context/app/i18n', async (importOriginal) => ({
  ...(await importOriginal<typeof I18n>()),
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('../ReadOnlyTip', () => ({ ReadOnlyTip: () => null }));

vi.mock('@teable/ui-lib', async (importOriginal) => {
  const actual = await importOriginal<typeof UiLib>();
  return {
    ...actual,
    DndKitContext: (props: ComponentProps<typeof UiLib.DndKitContext>) => {
      state.dragEnd = props.onDragEnd;
      return <actual.DndKitContext {...props} />;
    },
  };
});

const openPanel = () => {
  render(<VisibleFields>{() => <button type="button">Fields</button>}</VisibleFields>, {
    wrapper: createAppContext(),
  });
  fireEvent.click(screen.getByRole('button', { name: 'Fields' }));
};

const drag = (from: number, to: number) => {
  act(() =>
    state.dragEnd!({
      activatorEvent: new MouseEvent('mouseup'),
      collisions: [],
      delta: { x: 0, y: 0 },
      active: {
        id: state.fields[from].id,
        data: { current: { sortable: { index: from } } },
        rect: { current: { initial: null, translated: null } },
      },
      over: {
        id: state.fields[to].id,
        data: { current: { sortable: { index: to } } },
        rect: { top: 0, left: 0, bottom: 1, right: 1, width: 1, height: 1 },
        disabled: false,
      },
    } as DragEndEvent)
  );
};

describe('VisibleFields ordering', () => {
  beforeEach(() => {
    state.fields = [
      { id: 'fldTitle', name: 'Title' },
      { id: 'fldNotes', name: 'Notes' },
      { id: 'fldNew', name: 'New' },
    ];
    state.view = {
      id: 'viwKanban',
      columnMeta: { fldTitle: { order: 0 }, fldNotes: { order: 1, visible: false } },
      updateColumnMeta: vi.fn().mockResolvedValue(undefined),
    };
    state.dragEnd = undefined;
  });

  afterEach(cleanup);

  it('moves a newly received field before existing fields while its column meta is absent', () => {
    openPanel();

    drag(2, 0);

    expect(state.view!.updateColumnMeta).toHaveBeenCalledExactlyOnceWith([
      { fieldId: 'fldNew', columnMeta: { order: -1 } },
    ]);
    expect(screen.getAllByRole('option').map((item) => item.textContent)).toEqual([
      'New',
      'Title',
      'Notes',
    ]);
  });

  it('does not submit a non-finite order while a destination neighbor has no column meta', () => {
    openPanel();

    drag(0, 2);

    expect(state.view!.updateColumnMeta).not.toHaveBeenCalled();
  });

  it('keeps fractional neighbor ordering when moving a hidden field past the last column', () => {
    state.view!.columnMeta.fldNew = { order: 4.5 };
    openPanel();

    drag(1, 2);

    expect(state.view!.updateColumnMeta).toHaveBeenCalledExactlyOnceWith([
      { fieldId: 'fldNotes', columnMeta: { order: 5.5 } },
    ]);
    expect(screen.getAllByRole('option').map((item) => item.textContent)).toEqual([
      'Title',
      'New',
      'Notes',
    ]);
  });
});
