import { ConfirmModalProvider, useConfirm } from '@teable/ui-lib/base';
import { useState } from 'react';
import { vi } from 'vitest';
import { render, screen, userEvent, waitFor } from '@/test-utils';
import { PasteSelectionProgressDialog } from './PasteSelectionProgressDialog';

// T1902: pressing Enter in the paste confirmation dialog should confirm the paste
describe('paste confirmation dialog keyboard (T1902)', () => {
  it('confirms the streamed paste dialog on Enter', async () => {
    const onConfirm = vi.fn();
    const onOpenChange = vi.fn();
    render(
      <PasteSelectionProgressDialog
        open
        mode="confirm"
        progress={null}
        summary={null}
        errors={[]}
        status={null}
        confirmRecordCount={60}
        onConfirm={onConfirm}
        onOpenChange={onOpenChange}
      />
    );
    await screen.findByText('table:table.actionTips.pasteConfirmTitle');

    await userEvent.keyboard('{Enter}');

    expect(onOpenChange).not.toHaveBeenCalledWith(false);
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it('confirms the useConfirm paste dialog on Enter', async () => {
    let result: boolean | undefined;
    const Trigger = () => {
      const { confirm } = useConfirm();
      const [, setTick] = useState(0);
      return (
        <button
          onClick={async () => {
            result = await confirm({
              title: 'pasteConfirmTitle',
              confirmText: 'paste',
              cancelText: 'cancel',
              confirmButtonVariant: 'destructive',
              autoFocusConfirm: true,
            });
            setTick((n) => n + 1);
          }}
        >
          open
        </button>
      );
    };
    render(
      <ConfirmModalProvider>
        <Trigger />
      </ConfirmModalProvider>
    );
    await userEvent.click(screen.getByText('open'));
    await screen.findByText('pasteConfirmTitle');

    await userEvent.keyboard('{Enter}');

    await waitFor(() => expect(result).not.toBeUndefined());
    expect(result).toBe(true);
  });
});
