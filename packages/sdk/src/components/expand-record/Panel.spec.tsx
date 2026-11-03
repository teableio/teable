import { act, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ExpandRecordPanelHost } from './ExpandRecordPanelHost';
import { Panel } from './Panel';

const panels = () => [...document.querySelectorAll<HTMLElement>('[role="region"]')];

describe('Panel (ExpandRecord side panel)', () => {
  let hostWidth = 1000;
  let originalClientWidth: PropertyDescriptor | undefined;
  const originalGetClientRects = Element.prototype.getClientRects;

  beforeEach(() => {
    hostWidth = 1000;
    // jsdom lays nothing out; the panel only takes Escape while it is on screen
    Element.prototype.getClientRects = () => [new DOMRect()] as unknown as DOMRectList;
    originalClientWidth = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientWidth');
    Object.defineProperty(HTMLElement.prototype, 'clientWidth', {
      configurable: true,
      get() {
        return hostWidth;
      },
    });
  });

  afterEach(() => {
    if (originalClientWidth) {
      Object.defineProperty(HTMLElement.prototype, 'clientWidth', originalClientWidth);
    }
    Element.prototype.getClientRects = originalGetClientRects;
    localStorage.clear();
  });

  it('docks into the table node', () => {
    render(
      <ExpandRecordPanelHost>
        <div data-testid="table" />
        <Panel visible>
          <div>record</div>
        </Panel>
      </ExpandRecordPanelHost>
    );

    const [panel] = panels();
    expect(panel.parentElement?.parentElement).toBe(screen.getByTestId('table').parentElement);
  });

  it('widens by the comment column but never past the table node', () => {
    const { rerender } = render(
      <ExpandRecordPanelHost>
        <Panel visible extraWidth={0} />
      </ExpandRecordPanelHost>
    );
    expect(panels()[0].style.width).toBe('560px');

    rerender(
      <ExpandRecordPanelHost>
        <Panel visible extraWidth={320} />
      </ExpandRecordPanelHost>
    );
    expect(panels()[0].style.width).toBe('880px');

    hostWidth = 700;
    rerender(
      <ExpandRecordPanelHost key="narrow">
        <Panel visible extraWidth={320} />
      </ExpandRecordPanelHost>
    );
    expect(panels()[0].style.width).toBe('700px');
  });

  it('closes on Escape wherever focus is, unless an open layer owns the key', () => {
    const onClose = vi.fn();
    render(
      <ExpandRecordPanelHost>
        <input data-testid="table-cell" />
        <Panel visible onClose={onClose}>
          <input data-testid="field" />
        </Panel>
      </ExpandRecordPanelHost>
    );

    const layer = document.createElement('div');
    layer.setAttribute('role', 'dialog');
    layer.dataset.state = 'open';
    document.body.appendChild(layer);
    fireEvent.keyDown(screen.getByTestId('field'), { key: 'Escape' });
    expect(onClose).not.toHaveBeenCalled();

    layer.remove();
    fireEvent.keyDown(screen.getByTestId('table-cell'), { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(screen.getByTestId('field'), { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it('stacks a linked record over the panel and goes back to it', () => {
    const rootClose = vi.fn();
    const Stack = () => {
      const [childOpen, setChildOpen] = useState(false);
      return (
        <Panel visible onClose={rootClose}>
          <button onClick={() => setChildOpen(true)}>open linked</button>
          {childOpen && (
            <Panel visible onClose={() => setChildOpen(false)}>
              <input data-testid="child-field" />
            </Panel>
          )}
        </Panel>
      );
    };
    render(
      <ExpandRecordPanelHost>
        <Stack />
      </ExpandRecordPanelHost>
    );

    const [root] = panels();
    fireEvent.click(screen.getByText('open linked'));
    expect(root.className).toContain('invisible');

    act(() => {
      fireEvent.keyDown(document.body, { key: 'Escape' });
    });
    expect(rootClose).not.toHaveBeenCalled();
    expect(panels()).toHaveLength(1);
    expect(root.className).not.toContain('invisible');

    fireEvent.keyDown(document.body, { key: 'Escape' });
    expect(rootClose).toHaveBeenCalledTimes(1);
  });
});
