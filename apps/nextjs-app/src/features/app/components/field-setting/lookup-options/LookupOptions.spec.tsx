import { FieldType } from '@teable/core';
import type * as SdkContext from '@teable/sdk/context';
import type * as SdkHooks from '@teable/sdk/hooks';
import { render, screen, userEvent } from '@/test-utils';
import { ConditionalLookupOptions } from '../options/ConditionalLookupOptions';
import { LookupOptions } from './LookupOptions';

vi.mock('next-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'en' } }),
  Trans: () => null,
}));

vi.mock('@teable/sdk/hooks', async (importOriginal) => ({
  ...(await importOriginal<typeof SdkHooks>()),
  useBaseId: () => 'bseSource',
  useTableId: () => 'tblSource',
  useTable: () => undefined,
  useTables: () => [],
  useFieldStaticGetter: () => () => ({ Icon: () => null }),
  useFields: () => [
    { id: 'fldLink', type: FieldType.Link, options: { foreignTableId: 'tblForeign' } },
  ],
}));

vi.mock('@teable/sdk/context', async (importOriginal) => ({
  ...(await importOriginal<typeof SdkContext>()),
  StandaloneViewProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock('./LookupFilterOptions', () => ({ LookupFilterOptions: () => null }));
vi.mock('../options/LinkOptions/SelectTable', () => ({ SelectTable: () => null }));
vi.mock('../options/LinkedRecordSortLimitConfig', () => ({
  LinkedRecordSortLimitConfig: () => null,
}));

const options = {
  foreignTableId: 'tblForeign',
  linkFieldId: 'fldLink',
  lookupFieldId: 'fldValue',
};
const switchName = 'table:field.editor.removeDuplicateValues';

describe('lookup unique values option', () => {
  it('defaults off and sends the enabled option', async () => {
    const onChange = vi.fn();
    render(<LookupOptions options={options} enableUniqueValues onChange={onChange} />);
    const toggle = screen.getByRole('switch', { name: switchName });
    expect(toggle).not.toBeChecked();
    await userEvent.click(toggle);
    expect(onChange).toHaveBeenCalledWith({ ...options, isUnique: true }, undefined, undefined);
  });

  it('hydrates a saved enabled option and permits disabling it', async () => {
    const onChange = vi.fn();
    const { rerender } = render(
      <LookupOptions options={options} enableUniqueValues onChange={onChange} />
    );
    rerender(
      <LookupOptions
        options={{ ...options, isUnique: true }}
        enableUniqueValues
        onChange={onChange}
      />
    );
    const toggle = screen.getByRole('switch', { name: switchName });
    expect(toggle).toBeChecked();
    await userEvent.click(toggle);
    expect(onChange).toHaveBeenCalledWith({ ...options, isUnique: false }, undefined, undefined);
  });

  it('does not expose the option to shared rollup configuration', () => {
    render(<LookupOptions options={options} />);
    expect(screen.queryByRole('switch', { name: switchName })).not.toBeInTheDocument();
  });

  it('offers the same switch for conditional lookup fields', async () => {
    const onOptionsChange = vi.fn();
    render(
      <ConditionalLookupOptions
        options={{
          foreignTableId: options.foreignTableId,
          lookupFieldId: options.lookupFieldId,
          filter: { conjunction: 'and', filterSet: [] },
          isUnique: true,
        }}
        onOptionsChange={onOptionsChange}
      />
    );
    const toggle = screen.getByRole('switch', { name: switchName });
    expect(toggle).toBeChecked();
    await userEvent.click(toggle);
    expect(onOptionsChange).toHaveBeenCalledWith({ isUnique: false });
  });
});
