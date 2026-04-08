import { act } from 'react';
import { vi } from 'vitest';
import { render, screen, userEvent } from '@/test-utils';
import { DeleteSelectionProgressDialog } from './DeleteSelectionProgressDialog';

describe('DeleteSelectionProgressDialog', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders a safe zero-progress state without error details', () => {
    render(
      <DeleteSelectionProgressDialog
        open
        mode="progress"
        progress={null}
        summary={null}
        errors={[]}
        status="running"
        onOpenChange={() => undefined}
      />
    );

    expect(screen.getByText('table:table.actionTips.deleting')).toBeInTheDocument();
    expect(screen.getByText('table:table.actionTips.deleteStream.deleting')).toBeInTheDocument();
    expect(
      screen.getByText('table:table.actionTips.deleteStream.phaseLabel.preparing')
    ).toBeInTheDocument();
    expect(screen.queryByText('0%')).not.toBeInTheDocument();
    expect(
      screen.queryByText('table:table.actionTips.deleteStream.chunkFailureTitle')
    ).not.toBeInTheDocument();
  });

  it('reveals chunk failure details when the collapsible is expanded', async () => {
    render(
      <DeleteSelectionProgressDialog
        open
        mode="progress"
        progress={{
          id: 'progress',
          phase: 'deleting',
          batchIndex: 1,
          totalCount: 3,
          deletedCount: 2,
          batchDeletedCount: 1,
        }}
        summary={{
          id: 'done',
          totalCount: 3,
          deletedCount: 2,
          data: {
            deletedCount: 2,
            deletedRecordIds: ['rec1', 'rec2'],
          },
        }}
        errors={[
          {
            id: 'error',
            phase: 'deleting',
            batchIndex: 1,
            totalCount: 3,
            deletedCount: 1,
            recordIds: ['rec3'],
            message: 'delete failed',
          },
        ]}
        status="partial"
      />
    );

    expect(
      screen.getByText('table:table.actionTips.deleteStream.completedWithIssues')
    ).toBeInTheDocument();

    const trigger = screen
      .getByText('table:table.actionTips.deleteStream.chunkFailureTitle')
      .closest('button');

    expect(trigger).not.toBeNull();
    expect(screen.queryByText('delete failed')).not.toBeInTheDocument();

    await userEvent.click(trigger!);

    expect(screen.getByText('delete failed')).toBeVisible();
    expect(screen.getByText('rec3')).toBeVisible();
  });

  it('stays dismissible when the request finishes with errors but without a summary', () => {
    render(
      <DeleteSelectionProgressDialog
        open
        mode="progress"
        progress={{
          id: 'progress',
          phase: 'deleting',
          batchIndex: 1,
          totalCount: 3,
          deletedCount: 1,
          batchDeletedCount: 1,
        }}
        summary={null}
        errors={[
          {
            id: 'error',
            phase: 'deleting',
            batchIndex: 1,
            totalCount: 3,
            deletedCount: 1,
            recordIds: [],
            message: 'delete failed',
          },
        ]}
        status="error"
        onOpenChange={() => undefined}
      />
    );

    expect(screen.getByRole('button', { name: 'common:actions.close' })).toBeInTheDocument();
  });

  it('shows a completed success state without the deleting copy', () => {
    render(
      <DeleteSelectionProgressDialog
        open
        mode="progress"
        progress={{
          id: 'progress',
          phase: 'finalizing',
          batchIndex: 4,
          totalCount: 1000,
          deletedCount: 1000,
          batchDeletedCount: 200,
        }}
        summary={{
          id: 'done',
          totalCount: 1000,
          deletedCount: 1000,
          data: {
            deletedCount: 1000,
            deletedRecordIds: ['rec1'],
          },
        }}
        errors={[]}
        status="success"
        onOpenChange={() => undefined}
      />
    );

    expect(screen.getAllByText('table:table.actionTips.deleteSuccessful')).not.toHaveLength(0);
    expect(
      screen.queryByText('table:table.actionTips.deleteStream.deleting')
    ).not.toBeInTheDocument();
    expect(screen.queryByText('+200')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'common:actions.close' })).toBeInTheDocument();
  });

  it('renders a confirmation state and triggers delete on confirm', async () => {
    const onConfirm = vi.fn();

    render(
      <DeleteSelectionProgressDialog
        open
        mode="confirm"
        progress={null}
        summary={null}
        errors={[]}
        status={null}
        confirmRecordCount={1200}
        onConfirm={onConfirm}
        onOpenChange={() => undefined}
      />
    );

    expect(screen.getByText('table:table.actionTips.deleteRecordConfirmTitle')).toBeInTheDocument();
    expect(
      screen.getByText('table:table.actionTips.deleteRecordConfirmDescription')
    ).toBeInTheDocument();

    await userEvent.click(
      screen.getByRole('button', { name: 'table:table.actionTips.deleteRecord' })
    );

    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it('smooths displayed progress between backend chunk checkpoints', () => {
    vi.useFakeTimers();

    const { rerender } = render(
      <DeleteSelectionProgressDialog
        open
        mode="progress"
        progress={{
          id: 'progress',
          phase: 'preparing',
          batchIndex: -1,
          totalCount: 10000,
          deletedCount: 0,
          batchDeletedCount: 0,
        }}
        summary={null}
        errors={[]}
        status="running"
        onOpenChange={() => undefined}
      />
    );

    act(() => {
      vi.advanceTimersByTime(10000);
    });

    rerender(
      <DeleteSelectionProgressDialog
        open
        mode="progress"
        progress={{
          id: 'progress',
          phase: 'deleting',
          batchIndex: 0,
          totalCount: 10000,
          deletedCount: 1000,
          batchDeletedCount: 1000,
        }}
        summary={null}
        errors={[]}
        status="running"
        onOpenChange={() => undefined}
      />
    );

    expect(screen.getByText('10%')).toBeInTheDocument();
    expect(screen.getByText((_, node) => node?.textContent === '1,000 / 10,000')).toBeTruthy();

    act(() => {
      vi.advanceTimersByTime(5000);
    });

    expect(screen.getByText('15%')).toBeInTheDocument();
    expect(screen.getByText((_, node) => node?.textContent === '1,500 / 10,000')).toBeTruthy();
    expect(screen.getByText('15.0s')).toBeInTheDocument();
    expect(
      screen.queryByText('table:table.actionTips.deleteStream.rowsLabel')
    ).not.toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(5000);
    });

    rerender(
      <DeleteSelectionProgressDialog
        open
        mode="progress"
        progress={{
          id: 'progress',
          phase: 'deleting',
          batchIndex: 1,
          totalCount: 10000,
          deletedCount: 2000,
          batchDeletedCount: 1000,
        }}
        summary={null}
        errors={[]}
        status="running"
        onOpenChange={() => undefined}
      />
    );

    expect(screen.getByText('20%')).toBeInTheDocument();
    expect(screen.getByText((_, node) => node?.textContent === '2,000 / 10,000')).toBeTruthy();

    act(() => {
      vi.advanceTimersByTime(3000);
    });

    expect(screen.getByText('23%')).toBeInTheDocument();
    expect(screen.getByText((_, node) => node?.textContent === '2,300 / 10,000')).toBeTruthy();
    expect(screen.getByText('23.0s')).toBeInTheDocument();
  });
});
