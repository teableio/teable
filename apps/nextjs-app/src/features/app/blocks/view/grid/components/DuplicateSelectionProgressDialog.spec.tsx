import { vi } from 'vitest';
import { render, screen, userEvent } from '@/test-utils';
import { DuplicateSelectionProgressDialog } from './DuplicateSelectionProgressDialog';

describe('DuplicateSelectionProgressDialog', () => {
  it('renders a safe zero-progress state without error details', () => {
    render(
      <DuplicateSelectionProgressDialog
        open
        mode="progress"
        progress={null}
        summary={null}
        errors={[]}
        status="running"
        onOpenChange={() => undefined}
      />
    );

    expect(screen.getByText('table:table.actionTips.duplicating')).toBeInTheDocument();
    expect(
      screen.getByText('table:table.actionTips.duplicateStream.duplicating')
    ).toBeInTheDocument();
    expect(
      screen.getByText('table:table.actionTips.duplicateStream.phaseLabel.preparing')
    ).toBeInTheDocument();
  });

  it('renders a confirmation state and triggers duplicate on confirm', async () => {
    const onConfirm = vi.fn();

    render(
      <DuplicateSelectionProgressDialog
        open
        mode="confirm"
        progress={null}
        summary={null}
        errors={[]}
        status={null}
        confirmRecordCount={320}
        onConfirm={onConfirm}
        onOpenChange={() => undefined}
      />
    );

    expect(
      screen.getByText('table:table.actionTips.duplicateRecordsConfirmTitle')
    ).toBeInTheDocument();
    expect(
      screen.getByText('table:table.actionTips.duplicateRecordsConfirmDescription')
    ).toBeInTheDocument();

    await userEvent.click(
      screen.getByRole('button', { name: 'table:table.actionTips.duplicateRecords' })
    );

    expect(onConfirm).toHaveBeenCalledTimes(1);
  });
});
