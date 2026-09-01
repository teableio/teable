import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createAppContext } from '../../context/__tests__/createAppContext';
import { AdaptivePanel } from './AdaptivePanel';
import { NestedDrawer } from './NestedDrawer';

type Listener = (event: MediaQueryListEvent) => void;

/**
 * A settable matchMedia with real listener bookkeeping, so a test can actually
 * cross the breakpoint. A stub whose `addEventListener` is a bare spy can
 * never fire `change`, which would leave the shell's central claim - that an
 * open panel survives the crossing - untested.
 */
const createViewport = (initiallyNarrow: boolean) => {
  const listeners = new Set<Listener>();
  let narrow = initiallyNarrow;

  window.matchMedia = ((query: string) => ({
    get matches() {
      return narrow && query.includes('max-width');
    },
    media: query,
    onchange: null,
    addEventListener: (_: string, listener: Listener) => listeners.add(listener),
    removeEventListener: (_: string, listener: Listener) => listeners.delete(listener),
    addListener: (listener: Listener) => listeners.add(listener),
    removeListener: (listener: Listener) => listeners.delete(listener),
    dispatchEvent: () => true,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  })) as any;

  return {
    set: (next: boolean) => {
      narrow = next;
      listeners.forEach((listener) => listener({ matches: next } as MediaQueryListEvent));
    },
  };
};

const setViewport = (isNarrow: boolean) => createViewport(isNarrow);

const wrapper = createAppContext();

const renderPanel = (props: Partial<React.ComponentProps<typeof AdaptivePanel>> = {}) =>
  render(
    <AdaptivePanel
      responsive
      defaultOpen
      title="Sort by"
      content={<div data-testid="panel-body">body</div>}
      {...props}
    >
      <button type="button">open</button>
    </AdaptivePanel>,
    { wrapper }
  );

describe('AdaptivePanel', () => {
  const originalMatchMedia = window.matchMedia;

  afterEach(() => {
    window.matchMedia = originalMatchMedia;
    vi.restoreAllMocks();
  });

  describe('wide viewport', () => {
    beforeEach(() => setViewport(false));

    it('renders the panel as a popover, with no drawer heading', () => {
      renderPanel();

      expect(screen.getByTestId('panel-body')).toBeDefined();
      // The title belongs to the drawer only; the popover keeps whatever the
      // caller put in `content`.
      expect(screen.queryByText('Sort by')).toBeNull();
    });

    it('renders the trigger exactly once', () => {
      renderPanel();
      expect(screen.getAllByRole('button', { name: 'open' })).toHaveLength(1);
    });
  });

  describe('narrow viewport', () => {
    beforeEach(() => setViewport(true));

    it('renders the panel as a titled drawer', async () => {
      await act(async () => {
        renderPanel();
      });

      expect(screen.getByRole('dialog')).toBeDefined();
      expect(screen.getByText('Sort by')).toBeDefined();
      expect(screen.getByTestId('panel-body')).toBeDefined();
    });

    it('renders a single trigger that opens the drawer when clicked', async () => {
      // The toolbar stores a ref to this button and clicks it programmatically
      // from the column header menu. If the shell rendered a trigger per
      // branch, that ref would point at an unmounted node.
      await act(async () => {
        renderPanel({ defaultOpen: false });
      });

      const triggers = screen.getAllByRole('button', { name: 'open' });
      expect(triggers).toHaveLength(1);
      expect(screen.queryByRole('dialog')).toBeNull();

      await act(async () => {
        triggers[0].click();
      });

      expect(screen.getByRole('dialog')).toBeDefined();
    });

    it('gives the close button a localised accessible name', async () => {
      await act(async () => {
        renderPanel();
      });

      const close = screen.getByRole('button', { name: 'Close' });
      expect(close.getAttribute('type')).toBe('button');
    });

    it('renders no close control at all when the drawer cannot be dismissed', async () => {
      // Regression guard: the shadcn Sheet always renders its corner Close and
      // only hides the icon inside it, leaving an invisible tap target in the
      // corner of an undismissable panel. The drawer must render nothing.
      await act(async () => {
        renderPanel({ dismissible: false });
      });

      expect(screen.queryByRole('button', { name: 'Close' })).toBeNull();
    });

    it('reports a dismissal attempt instead of closing when not dismissible', async () => {
      const onDismissAttempt = vi.fn();
      const onOpenChange = vi.fn();

      await act(async () => {
        renderPanel({ dismissible: false, onDismissAttempt, onOpenChange });
      });

      await act(async () => {
        fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' });
      });

      expect(onDismissAttempt).toHaveBeenCalled();
      expect(onOpenChange).not.toHaveBeenCalledWith(false);
    });

    it('declares no description when none was supplied', async () => {
      await act(async () => {
        renderPanel();
      });

      expect(screen.getByRole('dialog').getAttribute('aria-describedby')).toBeNull();
    });

    it('keeps an open panel open across the breakpoint, as a popover', async () => {
      // The reason every panel goes through this shell: crossing 640px must
      // change the shape, not close the panel.
      const viewport = setViewport(true);

      await act(async () => {
        renderPanel();
      });
      expect(screen.getByRole('dialog')).toBeDefined();

      await act(async () => {
        viewport.set(false);
      });

      // No longer a drawer - the scrim and the drawer heading are both gone.
      // (`role="dialog"` cannot tell the two apart: Radix gives its popover
      // content that role too.)
      expect(document.querySelectorAll('[data-slot="drawer-overlay"]')).toHaveLength(0);
      expect(screen.queryByText('Sort by')).toBeNull();
      // ...but the panel is still open, now as the popover body.
      expect(screen.getByTestId('panel-body')).toBeDefined();
    });

    it('links the description when one is supplied', async () => {
      await act(async () => {
        renderPanel({ description: 'Pick a stacking field' });
      });

      const dialog = screen.getByRole('dialog');
      const describedBy = dialog.getAttribute('aria-describedby');
      expect(describedBy).toBeTruthy();
      expect(document.getElementById(describedBy as string)?.textContent).toBe(
        'Pick a stacking field'
      );
    });
  });
});

describe('NestedDrawer', () => {
  it('renders its own scrim, so a stacked selector dims the drawer beneath it', async () => {
    await act(async () => {
      render(
        <NestedDrawer
          open
          onOpenChange={() => undefined}
          title="Select operator"
          content={<div>options</div>}
        >
          <button type="button">trigger</button>
        </NestedDrawer>,
        { wrapper }
      );
    });

    const overlays = document.querySelectorAll('[data-slot="drawer-overlay"]');
    expect(overlays).toHaveLength(1);
    // A transparent scrim here would leave the parent drawer looking active,
    // and dropping the overlay entirely takes `RemoveScroll` with it, which
    // leaves this panel unable to scroll.
    expect(overlays[0].className).toContain('bg-black/20');
    expect(overlays[0].className).not.toContain('bg-transparent');
  });

  it('paints one scrim per layer when actually stacked under a panel', async () => {
    // The single-drawer case above cannot show stacking. Render the nested
    // drawer inside an open AdaptivePanel so there really are two layers.
    setViewport(true);

    await act(async () => {
      render(
        <AdaptivePanel
          responsive
          defaultOpen
          title="Filter"
          content={
            <NestedDrawer
              open
              onOpenChange={() => undefined}
              title="Select operator"
              content={<div>options</div>}
            >
              <button type="button">trigger</button>
            </NestedDrawer>
          }
        >
          <button type="button">open</button>
        </AdaptivePanel>,
        { wrapper }
      );
    });

    const overlays = document.querySelectorAll('[data-slot="drawer-overlay"]');
    expect(overlays).toHaveLength(2);
    overlays.forEach((overlay) => expect(overlay.className).toContain('bg-black/20'));
  });
});
