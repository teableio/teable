import { act, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import { ExpandRecordPanelHost } from './ExpandRecordPanelHost';
import { Panel } from './Panel';
import { raiseRecordPanel, useRecordPanelRaiseCount } from './raiseRecordPanel';

// A record panel as ExpandRecord builds its raise key, with a new-record draft opened beside it.
const Side = () => {
  const [draftOpen, setDraftOpen] = useState(false);
  const raiseCount = useRecordPanelRaiseCount('tblA', 'recA');
  return (
    <>
      <button onClick={() => setDraftOpen(true)}>add record</button>
      <Panel visible raiseKey={`recA:${raiseCount}`}>
        <span>recA</span>
      </Panel>
      <Panel visible={draftOpen} onClose={() => setDraftOpen(false)}>
        <span>draft</span>
      </Panel>
    </>
  );
};

describe('raiseRecordPanel', () => {
  it('brings the open record back on top when that same record is expanded again', () => {
    render(
      <ExpandRecordPanelHost>
        <Side />
      </ExpandRecordPanelHost>
    );
    fireEvent.click(screen.getByText('add record'));
    const record = screen.getByText('recA').closest<HTMLElement>('[role="region"]')!;
    const draft = screen.getByText('draft').closest<HTMLElement>('[role="region"]')!;
    expect(record.className).toContain('invisible');

    // another table's record of the same id, or another record, leaves it where it is
    act(() => raiseRecordPanel('tblB', 'recA'));
    act(() => raiseRecordPanel('tblA', 'recB'));
    expect(record.className).toContain('invisible');

    act(() => raiseRecordPanel('tblA', 'recA'));
    expect(record.className).not.toContain('invisible');
    // the draft stays open under it
    expect(draft.className).toContain('invisible');
  });
});
