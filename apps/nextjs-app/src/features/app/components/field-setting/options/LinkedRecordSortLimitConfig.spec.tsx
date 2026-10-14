import {
  CONDITIONAL_QUERY_DEFAULT_LIMIT,
  CONDITIONAL_QUERY_MAX_LIMIT,
  SortFunc,
} from '@teable/core';
import { useState } from 'react';
import { render, screen, userEvent } from '@/test-utils';
import type { ISortOrderValue } from './LinkedRecordSortLimitConfig';
import { LinkedRecordSortLimitConfig } from './LinkedRecordSortLimitConfig';

vi.mock('@teable/sdk/hooks', () => ({ useFields: () => [] }));
vi.mock('@teable/sdk', () => ({
  FieldCommand: () => null,
  FieldSelector: () => null,
  OrderSelect: () => null,
}));
vi.mock('next-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, values?: { limit: number }) =>
      values ? `Matching record limit: ${values.limit}` : key,
  }),
}));

const placeholder = 'table:field.editor.conditionalLookup.limitPlaceholder';

const Config = ({ initialLimit, sorted = false }: { initialLimit?: number; sorted?: boolean }) => {
  const [limit, setLimit] = useState(initialLimit);
  const [sort, setSort] = useState<ISortOrderValue | undefined>(
    sorted ? { fieldId: 'fldPrice', order: SortFunc.Asc } : undefined
  );
  return (
    <>
      <LinkedRecordSortLimitConfig
        sort={sort}
        limit={limit}
        onSortChange={setSort}
        onLimitChange={setLimit}
        onDisable={() => {
          setSort(undefined);
          setLimit(undefined);
        }}
      />
      <output aria-label="Saved options">{JSON.stringify({ sort, limit })}</output>
    </>
  );
};

describe('conditional lookup sort and limit settings', () => {
  it('enables sorting without silently adding a limit', async () => {
    render(<Config />);
    await userEvent.click(screen.getByRole('switch'));
    expect(screen.getByPlaceholderText(placeholder)).toHaveValue('');
    expect(screen.getByLabelText('Saved options')).toHaveTextContent('{}');
    expect(screen.getByRole('switch')).toBeChecked();
  });

  it('updates the effective hint while typing, after blur, and after clearing', async () => {
    render(<Config />);
    await userEvent.click(screen.getByRole('switch'));
    const input = screen.getByPlaceholderText(placeholder);
    await userEvent.clear(input);
    await userEvent.type(input, '3');
    expect(screen.getByText('Matching record limit: 3')).toBeInTheDocument();
    await userEvent.tab();
    expect(screen.getByText('Matching record limit: 3')).toBeInTheDocument();
    expect(screen.getByLabelText('Saved options')).toHaveTextContent('{"limit":3}');
    await userEvent.clear(input);
    expect(
      screen.getByText(`Matching record limit: ${CONDITIONAL_QUERY_DEFAULT_LIMIT}`)
    ).toBeInTheDocument();
    expect(screen.getByLabelText('Saved options')).toHaveTextContent('{}');
    expect(screen.getByRole('switch')).toBeChecked();
  });

  it('reopens a sorting-only configuration with a blank limit', () => {
    render(<Config sorted />);
    expect(screen.getByRole('switch')).toBeChecked();
    expect(screen.getByPlaceholderText(placeholder)).toHaveValue('');
    expect(screen.getByLabelText('Saved options')).not.toHaveTextContent('limit');
  });

  it('preserves an explicit saved limit and clears it when disabled', async () => {
    render(<Config initialLimit={3} sorted />);
    expect(screen.getByPlaceholderText(placeholder)).toHaveValue('3');
    expect(screen.getByText('Matching record limit: 3')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('switch'));
    expect(screen.queryByPlaceholderText(placeholder)).not.toBeInTheDocument();
    expect(screen.getByLabelText('Saved options')).toHaveTextContent('{}');
    await userEvent.click(screen.getByRole('switch'));
    expect(screen.getByPlaceholderText(placeholder)).toHaveValue('');
  });

  it('keeps the hint aligned with a clamped input', async () => {
    render(<Config />);
    await userEvent.click(screen.getByRole('switch'));
    const input = screen.getByPlaceholderText(placeholder);
    await userEvent.clear(input);
    await userEvent.type(input, String(CONDITIONAL_QUERY_MAX_LIMIT + 1));
    expect(input).toHaveValue(String(CONDITIONAL_QUERY_MAX_LIMIT));
    expect(
      screen.getByText(`Matching record limit: ${CONDITIONAL_QUERY_MAX_LIMIT}`)
    ).toBeInTheDocument();
  });
});
