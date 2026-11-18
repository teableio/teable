import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Button, Popover, PopoverContent, PopoverTrigger } from '@teable/ui-lib';
import { fireEvent, render as rtlRender, screen } from '@testing-library/react';
import type { ReactElement } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ExpandRecordPanelHost } from '../expand-record/ExpandRecordPanelHost';
import { ExpandRecordPanelHostContext, OUTSIDE_PANEL_HOST } from '../expand-record/PanelContext';
import { CreateRecordModal } from './CreateRecordModal';

// The popover's own content is a dialog too: the record dialog is the other one.
const recordDialog = () =>
  document.querySelector<HTMLElement>('[role="dialog"]:not([data-testid="option-list"])');

const render = (node: ReactElement) =>
  rtlRender(<QueryClientProvider client={new QueryClient()}>{node}</QueryClientProvider>);

const mocks = vi.hoisted(() => ({ isMobile: false, optionListOpen: true }));

vi.mock('../../hooks', () => ({
  useBaseId: () => 'bse1',
  useTableId: () => 'tbl1',
  useViewId: () => undefined,
  useView: () => undefined,
  useFields: () => [],
  useSession: () => ({ user: { id: 'usr1' } }),
  useIsMobile: () => mocks.isMobile,
}));

vi.mock('../../context/app/i18n', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('../../utils/filterWithDefaultValue', () => ({
  extractDefaultFieldsFromFilters: async () => ({}),
}));

// A field editor with an option list, as the single select's is.
vi.mock('../expand-record/RecordEditor', () => ({
  RecordEditor: () => (
    <Popover open={mocks.optionListOpen}>
      <PopoverTrigger>options</PopoverTrigger>
      <PopoverContent data-testid="option-list">option</PopoverContent>
    </Popover>
  ),
}));

const trigger = (
  <CreateRecordModal>
    <Button>add</Button>
  </CreateRecordModal>
);

afterEach(() => {
  mocks.isMobile = false;
  mocks.optionListOpen = true;
  localStorage.clear();
});

describe('CreateRecordModal', () => {
  it('comes out as the record side panel inside a table node', () => {
    // an open list would take Escape for itself
    mocks.optionListOpen = false;
    render(<ExpandRecordPanelHost>{trigger}</ExpandRecordPanelHost>);
    fireEvent.click(screen.getByRole('button', { name: 'add' }));

    expect(screen.getByRole('region')).toHaveTextContent('editor.link.create');
    expect(recordDialog()).toBeNull();
    expect(screen.getByRole('button', { name: 'common.create' })).toBeInTheDocument();

    // Escape would throw the draft away: only Cancel (or the X) closes it, as the dialog did.
    // jsdom lays nothing out; a panel only takes Escape while it is on screen.
    const rects = vi
      .spyOn(Element.prototype, 'getClientRects')
      .mockReturnValue([new DOMRect()] as unknown as DOMRectList);
    try {
      fireEvent.keyDown(document.body, { key: 'Escape' });
      expect(screen.getByRole('region')).toBeInTheDocument();
    } finally {
      rects.mockRestore();
    }

    fireEvent.click(screen.getByRole('button', { name: 'common.cancel' }));
    expect(screen.queryByRole('region')).not.toBeInTheDocument();
  });

  it.each([
    ['outside a table node', (node: ReactElement) => node],
    [
      'inside a dialog in a table node',
      (node: ReactElement) => (
        <ExpandRecordPanelHost>
          <ExpandRecordPanelHostContext.Provider value={OUTSIDE_PANEL_HOST}>
            {node}
          </ExpandRecordPanelHostContext.Provider>
        </ExpandRecordPanelHost>
      ),
    ],
  ])('stays a dialog %s, and its option lists still scroll (T8535)', (_case, wrap) => {
    render(wrap(trigger));
    fireEvent.click(screen.getByRole('button', { name: 'add' }));

    expect(recordDialog()).not.toBeNull();
    expect(screen.queryByRole('region')).not.toBeInTheDocument();

    // the dialog's scroll lock cancels wheels on `document`: the list's never get there
    const lock = vi.fn();
    document.addEventListener('wheel', lock);
    try {
      fireEvent.wheel(screen.getByTestId('option-list'), { deltaY: 40 });
      fireEvent.touchMove(screen.getByTestId('option-list'));
      expect(lock).not.toHaveBeenCalled();
    } finally {
      document.removeEventListener('wheel', lock);
    }
  });

  it('stays a dialog on a phone', () => {
    mocks.isMobile = true;
    render(<ExpandRecordPanelHost>{trigger}</ExpandRecordPanelHost>);
    fireEvent.click(screen.getByRole('button', { name: 'add' }));
    expect(recordDialog()).not.toBeNull();
  });
});
