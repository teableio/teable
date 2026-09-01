import type { IConditionalRollupFieldOptions, IDatetimeFormatting } from '@teable/core';
import { CellValueType } from '@teable/core';
import type * as SdkContext from '@teable/sdk/context';
import type * as SdkHooks from '@teable/sdk/hooks';
import type { IFieldInstance } from '@teable/sdk/model';
import { render, screen } from '@/test-utils';
import { ConditionalRollupOptions } from './ConditionalRollupOptions';

const sdkMocks = vi.hoisted(() => ({
  useBaseId: vi.fn(),
  useFields: vi.fn(),
  useTable: vi.fn(),
  useTableId: vi.fn(),
}));

vi.mock('next-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key.replace(/^[a-z]+:/, ''),
    i18n: { language: 'en' },
  }),
  Trans: ({ i18nKey }: { i18nKey?: string }) => <>{i18nKey}</>,
}));

vi.mock('@teable/sdk/hooks', async (importOriginal) => {
  const actual = await importOriginal<typeof SdkHooks>();
  return {
    ...actual,
    useBaseId: sdkMocks.useBaseId,
    useFields: sdkMocks.useFields,
    useTable: sdkMocks.useTable,
    useTableId: sdkMocks.useTableId,
  };
});

vi.mock('@teable/sdk/context', async (importOriginal) => {
  const actual = await importOriginal<typeof SdkContext>();
  return {
    ...actual,
    StandaloneViewProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  };
});

vi.mock('../lookup-options/LookupFilterOptions', () => ({
  LookupFilterOptions: () => <div data-testid="lookup-filter-options" />,
}));

vi.mock('../lookup-options/LookupOptions', () => ({
  SelectFieldByTableId: () => <div data-testid="select-field-by-table-id" />,
  LookupOptions: () => <div data-testid="lookup-options" />,
}));

vi.mock('./LinkOptions/SelectTable', () => ({
  SelectTable: () => <div data-testid="select-table" />,
}));

vi.mock('./LinkedRecordSortLimitConfig', () => ({
  LinkedRecordSortLimitConfig: () => <div data-testid="linked-record-sort-limit-config" />,
}));

const persistedDatetimeFormatting: IDatetimeFormatting = {
  date: 'YYYY-MM-DD',
  time: 'HH:mm',
  timeZone: 'Asia/Shanghai',
} as IDatetimeFormatting;

// Mirrors a saved conditional rollup: min() over a date field of another table.
// The persisted formatting is the datetime shape, and the field's own
// cellValueType (computed server-side) is dateTime.
const persistedOptions: Partial<IConditionalRollupFieldOptions> = {
  foreignTableId: 'tblForeignB',
  lookupFieldId: 'fldSignUpDate',
  expression: 'min({values})',
  formatting: persistedDatetimeFormatting,
};

describe('ConditionalRollupOptions issue T6607', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sdkMocks.useBaseId.mockReturnValue('bseA');
    sdkMocks.useTableId.mockReturnValue('tblA');
    sdkMocks.useTable.mockReturnValue(undefined);
  });

  it('does not crash when foreign fields are not loaded yet (hard refresh cold start)', () => {
    // Cold start: foreign table fields have not arrived, useFields() is empty.
    sdkMocks.useFields.mockReturnValue([]);

    render(
      <ConditionalRollupOptions
        fieldId="fldConditionalRollup"
        options={persistedOptions}
        cellValueType={CellValueType.DateTime}
        isMultipleCellValue={false}
        onChange={vi.fn()}
      />
    );

    expect(screen.getByTestId('conditional-rollup-options')).toBeInTheDocument();
    // The persisted datetime formatting must keep the datetime formatting editor,
    // not degrade to the number formatting editor.
    expect(screen.getByText('field.default.date.dateFormatting')).toBeInTheDocument();
    expect(screen.queryByText('field.default.number.precision')).not.toBeInTheDocument();
  });

  it('renders datetime formatting once foreign fields have loaded', () => {
    sdkMocks.useFields.mockReturnValue([
      {
        id: 'fldSignUpDate',
        cellValueType: CellValueType.DateTime,
        isMultipleCellValue: false,
      } as IFieldInstance,
    ]);

    render(
      <ConditionalRollupOptions
        fieldId="fldConditionalRollup"
        options={persistedOptions}
        cellValueType={CellValueType.DateTime}
        isMultipleCellValue={false}
        onChange={vi.fn()}
      />
    );

    expect(screen.getByText('field.default.date.dateFormatting')).toBeInTheDocument();
    expect(screen.queryByText('field.default.number.precision')).not.toBeInTheDocument();
  });
});
