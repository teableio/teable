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

  it('shows only the last of two panels opened side by side, and goes back to the first', () => {
    const recordClose = vi.fn();
    const Side = () => {
      const [draftOpen, setDraftOpen] = useState(false);
      return (
        <>
          <Panel visible onClose={recordClose}>
            <button onClick={() => setDraftOpen(true)}>add record</button>
          </Panel>
          <Panel visible={draftOpen} onClose={() => setDraftOpen(false)}>
            <input data-testid="draft-field" />
          </Panel>
        </>
      );
    };
    render(
      <ExpandRecordPanelHost>
        <Side />
      </ExpandRecordPanelHost>
    );

    const [record] = panels();
    fireEvent.click(screen.getByText('add record'));
    expect(record.className).toContain('invisible');
    expect(panels()[1].className).not.toContain('invisible');

    // Escape closes the one on top only
    act(() => {
      fireEvent.keyDown(document.body, { key: 'Escape' });
    });
    expect(recordClose).not.toHaveBeenCalled();
    expect(panels()).toHaveLength(1);
    expect(record.className).not.toContain('invisible');
  });

  it('brings an open panel back on top of one opened beside it later', () => {
    const Side = () => {
      const [raiseKey, setRaiseKey] = useState(0);
      const [recordOpen, setRecordOpen] = useState(false);
      return (
        <>
          <button onClick={() => setRaiseKey((key) => key + 1)}>add record</button>
          <button onClick={() => setRecordOpen(true)}>expand record</button>
          <Panel visible raiseKey={raiseKey}>
            <input data-testid="draft-field" defaultValue="typed" />
          </Panel>
          <Panel visible={recordOpen} onClose={() => setRecordOpen(false)}>
            <span>record</span>
          </Panel>
        </>
      );
    };
    render(
      <ExpandRecordPanelHost>
        <Side />
      </ExpandRecordPanelHost>
    );

    const draft = screen.getByTestId('draft-field').closest<HTMLElement>('[role="region"]')!;
    fireEvent.click(screen.getByText('expand record'));
    const record = screen.getByText('record').closest<HTMLElement>('[role="region"]')!;
    expect(draft.className).toContain('invisible');

    fireEvent.click(screen.getByText('add record'));
    expect(draft.className).not.toContain('invisible');
    expect(record.className).toContain('invisible');
    // the draft keeps what was typed into it
    expect(screen.getByTestId<HTMLInputElement>('draft-field').value).toBe('typed');
  });

  it('brings a record panel back on top when another record is opened into it', () => {
    const Side = () => {
      const [recordId, setRecordId] = useState('rec1');
      const [draftOpen, setDraftOpen] = useState(false);
      return (
        <>
          <button onClick={() => setDraftOpen(true)}>add record</button>
          <button onClick={() => setRecordId('rec2')}>expand rec2</button>
          <Panel visible raiseKey={recordId}>
            <span>{recordId}</span>
          </Panel>
          <Panel visible={draftOpen} onClose={() => setDraftOpen(false)}>
            <span>draft</span>
          </Panel>
        </>
      );
    };
    render(
      <ExpandRecordPanelHost>
        <Side />
      </ExpandRecordPanelHost>
    );

    fireEvent.click(screen.getByText('add record'));
    const record = screen.getByText('rec1').closest<HTMLElement>('[role="region"]')!;
    const draft = screen.getByText('draft').closest<HTMLElement>('[role="region"]')!;
    expect(record.className).toContain('invisible');

    fireEvent.click(screen.getByText('expand rec2'));
    expect(record.className).not.toContain('invisible');
    expect(record).toHaveTextContent('rec2');
    // the draft stays open under it
    expect(draft.className).toContain('invisible');
  });

  it('hides a linked record stacked on the first panel too, and gives it Escape back after', () => {
    const linkedClose = vi.fn();
    const Side = () => {
      const [draftOpen, setDraftOpen] = useState(false);
      return (
        <>
          <Panel visible>
            <Panel visible onClose={linkedClose}>
              <button onClick={() => setDraftOpen(true)}>add record</button>
            </Panel>
          </Panel>
          <Panel visible={draftOpen} onClose={() => setDraftOpen(false)}>
            <input data-testid="draft-field" />
          </Panel>
        </>
      );
    };
    render(
      <ExpandRecordPanelHost>
        <Side />
      </ExpandRecordPanelHost>
    );

    const linked = screen.getByText('add record').closest<HTMLElement>('[role="region"]')!;
    fireEvent.click(screen.getByText('add record'));
    expect(linked.className).toContain('invisible');

    act(() => {
      fireEvent.keyDown(document.body, { key: 'Escape' });
    });
    expect(linkedClose).not.toHaveBeenCalled();
    expect(panels()).toHaveLength(2);
    expect(linked.className).not.toContain('invisible');

    fireEvent.keyDown(document.body, { key: 'Escape' });
    expect(linkedClose).toHaveBeenCalledTimes(1);
  });

  it('leaves Escape alone when told to', () => {
    const onClose = vi.fn();
    render(
      <ExpandRecordPanelHost>
        <Panel visible closeOnEscape={false} onClose={onClose} />
      </ExpandRecordPanelHost>
    );
    fireEvent.keyDown(document.body, { key: 'Escape' });
    expect(onClose).not.toHaveBeenCalled();
  });
});
