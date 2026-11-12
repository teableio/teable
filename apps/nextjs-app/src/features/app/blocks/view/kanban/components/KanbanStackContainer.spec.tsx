import { render } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { KanbanStackContainer } from './KanbanStackContainer';

const view = vi.hoisted(() => ({ inView: false }));

vi.mock('@hello-pangea/dnd', () => ({
  Draggable: ({ children }: { children: (...args: unknown[]) => ReactNode }) =>
    children({ innerRef: vi.fn(), draggableProps: {}, dragHandleProps: {} }, { isDragging: false }),
  // only the out-of-view stand-in renders this mock: KanbanStack is mocked below
  Droppable: ({ children }: { children: (...args: unknown[]) => ReactNode }) => (
    <div data-testid="empty-drop-target">
      {children({ innerRef: vi.fn(), droppableProps: {}, placeholder: null }, {})}
    </div>
  ),
}));
vi.mock('@teable/sdk/components', () => ({
  CreateRecordModal: () => null,
  generateLocalId: () => 'local',
}));
vi.mock('@teable/sdk/hooks', () => ({
  useTableId: () => 'tblTest',
  useViewId: () => 'viwTest',
}));
vi.mock('../hooks', () => ({
  useInView: () => [{ current: null }, view.inView],
  useKanban: () => ({
    permission: { stackDraggable: false, cardCreatable: false },
    stackField: { id: 'fldStack', isComputed: false },
  }),
}));
vi.mock('../store', () => ({
  useKanbanStackCollapsedStore: () => ({ collapsedStackMap: {}, setCollapsedStackMap: vi.fn() }),
}));
vi.mock('./KanbanStack', () => ({ KanbanStack: () => <div data-testid="stack-body" /> }));
vi.mock('./KanbanStackHeader', () => ({ KanbanStackHeader: () => null }));
vi.mock('./KanbanStackTitle', () => ({ KanbanStackTitle: () => null }));

const renderStack = (isBoardDragging: boolean) => (
  <KanbanStackContainer
    index={0}
    stack={{ id: 'choA', data: 'A', count: 1 }}
    cards={[]}
    isBoardDragging={isBoardDragging}
  />
);

describe('KanbanStackContainer', () => {
  it('keeps an empty drop target for a stack out of view', () => {
    view.inView = false;
    const { queryByTestId } = render(renderStack(false));

    expect(queryByTestId('empty-drop-target')).not.toBeNull();
    expect(queryByTestId('stack-body')).toBeNull();
  });

  it('swaps the drop target and the card list only after a drag ends', () => {
    view.inView = false;
    const { queryByTestId, rerender } = render(renderStack(true));

    // board auto-scroll brings the stack into view mid-drag: its Droppable stays
    view.inView = true;
    rerender(renderStack(true));
    expect(queryByTestId('empty-drop-target')).not.toBeNull();
    expect(queryByTestId('stack-body')).toBeNull();

    rerender(renderStack(false));
    expect(queryByTestId('stack-body')).not.toBeNull();

    // and scrolling it out of view mid-drag must not unmount the card list
    rerender(renderStack(true));
    view.inView = false;
    rerender(renderStack(true));
    expect(queryByTestId('stack-body')).not.toBeNull();

    rerender(renderStack(false));
    expect(queryByTestId('empty-drop-target')).not.toBeNull();
  });
});
