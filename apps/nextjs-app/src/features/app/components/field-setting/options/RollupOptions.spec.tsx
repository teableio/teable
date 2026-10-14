import type { IRollupFieldOptions } from '@teable/core';
import { CellValueType } from '@teable/core';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { render, screen } from '@/test-utils';
import { RollupOptions } from './RollupOptions';

const availableExpressions: IRollupFieldOptions['expression'][] = [
  'countall({values})',
  'sum({values})',
];

function NewRollupEditor() {
  const [options, setOptions] = useState<Partial<IRollupFieldOptions>>({});
  return (
    <RollupOptions
      options={options}
      cellValueType={CellValueType.Number}
      availableExpressions={availableExpressions}
      onChange={(partial) => setOptions((current) => ({ ...current, ...partial }))}
    />
  );
}

describe('RollupOptions creation defaults', () => {
  it('T7750 keeps the function blank and formatting hidden until the user chooses SUM', async () => {
    const user = userEvent.setup();
    render(<NewRollupEditor />);

    expect(screen.getByText('field.default.rollup.selectAnRollupFunction')).toBeInTheDocument();
    expect(screen.queryByText('field.default.number.precision')).not.toBeInTheDocument();

    await user.click(screen.getByRole('combobox'));
    await user.click(screen.getByRole('option', { name: /field.default.rollup.func.sum/ }));

    expect(screen.getByText('field.default.rollup.func.sum')).toBeInTheDocument();
    expect(screen.getByText('field.default.number.precision')).toBeInTheDocument();
  });

  it('still replaces an existing expression that is unavailable for the source type', () => {
    const onChange = vi.fn();
    render(
      <RollupOptions
        options={{ expression: 'array_join({values})' }}
        cellValueType={CellValueType.Number}
        availableExpressions={availableExpressions}
        onChange={onChange}
      />
    );
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ expression: 'countall({values})' })
    );
  });
});
