import { Colors, convertFieldRoSchema, FieldType } from '@teable/core';
import type { IButtonFieldOptions } from '@teable/core';
import { useState } from 'react';
import { render, screen, userEvent } from '@/test-utils';
import { ButtonOptions } from './ButtonOptions';

vi.mock('@/features/app/hooks/useBaseUsage', () => ({ useBaseUsage: () => undefined }));
vi.mock('@/features/app/automation/workflow-panel/useWorkFlowPaneStore', () => ({
  useWorkFlowPanelStore: () => ({ setModal: vi.fn() }),
}));
vi.mock('@teable/sdk/hooks', () => ({ useFields: () => [] }));

const Editor = ({ save }: { save: (options: Partial<IButtonFieldOptions>) => void }) => {
  const [options, setOptions] = useState<Partial<IButtonFieldOptions>>({
    label: 'Run',
    color: Colors.Teal,
    maxCount: 1,
  });
  return (
    <>
      <ButtonOptions options={options} onChange={setOptions} />
      <button
        onClick={() => {
          if (convertFieldRoSchema.safeParse({ type: FieldType.Button, options }).success)
            save(options);
        }}
      >
        Save limit
      </button>
    </>
  );
};

describe('button click limit input', () => {
  it.each(['', '0', '-1', '1.5'])(
    'does not rewrite %s into a valid count while typing',
    async (value) => {
      const save = vi.fn();
      render(<Editor save={save} />);
      const input = screen.getByRole('spinbutton');
      await userEvent.clear(input);
      if (value) await userEvent.type(input, value);
      expect(input).toHaveValue(value ? Number(value) : null);
      await userEvent.click(screen.getByRole('button', { name: 'Save limit' }));
      expect(save).not.toHaveBeenCalled();
      await userEvent.clear(input);
      await userEvent.type(input, '10');
      await userEvent.click(screen.getByRole('button', { name: 'Save limit' }));
      expect(save).toHaveBeenCalledWith({ label: 'Run', color: Colors.Teal, maxCount: 10 });
    }
  );
  it('synchronizes external limits and disabling without retaining a stale draft', () => {
    const options = { label: 'Run', color: Colors.Teal, maxCount: 3 };
    const { rerender } = render(<ButtonOptions options={options} />);
    expect(screen.getByRole('spinbutton')).toHaveValue(3);
    rerender(<ButtonOptions options={{ ...options, maxCount: 10 }} />);
    expect(screen.getByRole('spinbutton')).toHaveValue(10);
    rerender(<ButtonOptions options={{ ...options, maxCount: null, resetCount: false }} />);
    expect(screen.queryByRole('spinbutton')).not.toBeInTheDocument();
    expect(screen.getAllByRole('switch')[0]).not.toBeChecked();
    rerender(<ButtonOptions options={{ ...options, maxCount: 1 }} />);
    expect(screen.getByRole('spinbutton')).toHaveValue(1);
  });
});
