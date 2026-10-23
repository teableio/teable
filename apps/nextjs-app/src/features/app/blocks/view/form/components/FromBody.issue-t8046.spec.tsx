import { CellValueType, DbFieldType, FieldType } from '@teable/core';
import type { IFieldVo } from '@teable/core';
import { LocalStorageKeys } from '@teable/sdk/config';
import type * as SdkHooks from '@teable/sdk/hooks';
import { createFieldInstance } from '@teable/sdk/model';
import type { IFieldInstance } from '@teable/sdk/model';
import { act, fireEvent, render, screen, waitFor } from '@/test-utils';
import { FormBody } from './FromBody';

const sdkHooks = vi.hoisted(() => ({
  useFields: vi.fn(),
  useView: vi.fn(),
  useTableId: vi.fn(),
}));

const router = vi.hoisted(() => ({ query: {} as Record<string, unknown> }));

vi.mock('@teable/sdk/hooks', async (importOriginal) => {
  const actual = await importOriginal<typeof SdkHooks>();
  return {
    ...actual,
    useFields: sdkHooks.useFields,
    useView: sdkHooks.useView,
    useTableId: sdkHooks.useTableId,
  };
});

vi.mock('next/router', () => ({ useRouter: () => router }));

vi.mock('@/features/app/hooks/usePreviewUrl', () => ({
  usePreviewUrl: () => (path: string) => path,
}));

vi.mock('./FormField', () => ({
  FormField: ({
    field,
    value,
    onChange,
  }: {
    field: IFieldInstance;
    value: unknown;
    onChange: (value: unknown) => void;
  }) => (
    <div data-testid={`form-field-${field.id}`} data-value={value == null ? '' : String(value)}>
      <button type="button" onClick={() => onChange(`edited-${field.id}`)}>
        edit-{field.id}
      </button>
    </div>
  ),
}));

const TABLE_ID = 'tblT8046FormBody';
const VIEW_ID = 'viwT8046FormBody';
const TITLE_FIELD_ID = 'fldT8046Title';
const AMOUNT_FIELD_ID = 'fldT8046Amount';
const DEPARTMENT_FIELD_ID = 'fldT8046Department';
const CHECKBOX_FIELD_ID = 'fldT8046Checkbox';
const HIDDEN_FIELD_ID = 'fldT8046Hidden';

const buildField = (
  type: FieldType,
  id: string,
  extra: Record<string, unknown> = {}
): IFieldInstance =>
  createFieldInstance({
    id,
    name: id,
    dbFieldName: id,
    type,
    cellValueType: CellValueType.String,
    dbFieldType: DbFieldType.Text,
    options: {},
    ...extra,
  } as IFieldVo);

const titleField = buildField(FieldType.SingleLineText, TITLE_FIELD_ID);
const amountField = buildField(FieldType.Number, AMOUNT_FIELD_ID);
const departmentField = buildField(FieldType.SingleSelect, DEPARTMENT_FIELD_ID, {
  options: {
    choices: [
      { id: 'choSales', name: 'Sales', color: 'blue' },
      { id: 'choOps', name: 'Ops', color: 'green' },
    ],
  },
});
const checkboxField = buildField(FieldType.Checkbox, CHECKBOX_FIELD_ID, {
  cellValueType: CellValueType.Boolean,
  dbFieldType: DbFieldType.Boolean,
});

const renderForm = (fields: IFieldInstance[], query: Record<string, unknown>) => {
  router.query = query;
  sdkHooks.useTableId.mockReturnValue(TABLE_ID);
  sdkHooks.useFields.mockReturnValue(fields);
  sdkHooks.useView.mockReturnValue({
    id: VIEW_ID,
    name: 'Form',
    description: '',
    columnMeta: Object.fromEntries(fields.map(({ id }) => [id, { visible: true }])),
    options: { submitLabel: 'submit' },
  });
  const submit = vi.fn().mockResolvedValue(undefined);
  render(<FormBody submit={submit} />);
  return submit;
};

const fieldValue = (fieldId: string) =>
  screen.getByTestId(`form-field-${fieldId}`).getAttribute('data-value');

describe('FormBody URL prefill T8046', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.localStorage.clear();
  });

  it('prefills visible fields of several kinds from URL params', async () => {
    const submit = renderForm([titleField, amountField, departmentField, checkboxField], {
      shareId: 'shrIgnored',
      [TITLE_FIELD_ID]: 'Acme onboarding',
      [AMOUNT_FIELD_ID]: '42',
      [DEPARTMENT_FIELD_ID]: 'Sales',
      [CHECKBOX_FIELD_ID]: 'true',
    });

    await waitFor(() => expect(fieldValue(TITLE_FIELD_ID)).toBe('Acme onboarding'));
    expect(fieldValue(AMOUNT_FIELD_ID)).toBe('42');
    expect(fieldValue(DEPARTMENT_FIELD_ID)).toBe('Sales');
    expect(fieldValue(CHECKBOX_FIELD_ID)).toBe('true');

    fireEvent.click(screen.getByRole('button', { name: 'submit' }));

    await waitFor(() => expect(submit).toHaveBeenCalledTimes(1));
    expect(submit.mock.calls[0][0]).toMatchObject({
      [TITLE_FIELD_ID]: 'Acme onboarding',
      [AMOUNT_FIELD_ID]: 42,
      [DEPARTMENT_FIELD_ID]: 'Sales',
      [CHECKBOX_FIELD_ID]: true,
    });
  });

  it('keeps a saved draft value while prefilling the remaining empty fields', async () => {
    window.localStorage.setItem(
      LocalStorageKeys.ViewFromData,
      JSON.stringify({
        [`${TABLE_ID}-${VIEW_ID}`]: { [TITLE_FIELD_ID]: 'draft title' },
      })
    );

    renderForm([titleField, amountField], {
      [TITLE_FIELD_ID]: 'from url',
      [AMOUNT_FIELD_ID]: '7',
    });

    await waitFor(() => expect(fieldValue(AMOUNT_FIELD_ID)).toBe('7'));
    expect(fieldValue(TITLE_FIELD_ID)).toBe('draft title');
  });

  it('ignores an unknown select option and a non-numeric number param', async () => {
    renderForm([amountField, departmentField], {
      [AMOUNT_FIELD_ID]: '12abc',
      [DEPARTMENT_FIELD_ID]: 'Not an option',
    });

    await waitFor(() =>
      expect(screen.getByTestId(`form-field-${AMOUNT_FIELD_ID}`)).toBeInTheDocument()
    );
    expect(fieldValue(AMOUNT_FIELD_ID)).toBe('');
    expect(fieldValue(DEPARTMENT_FIELD_ID)).toBe('');
  });

  it('does not prefill a hidden field that the form does not render', async () => {
    const submit = renderForm([titleField], {
      [HIDDEN_FIELD_ID]: 'hidden value',
      [TITLE_FIELD_ID]: 'from url',
    });

    await waitFor(() => expect(fieldValue(TITLE_FIELD_ID)).toBe('from url'));
    expect(screen.queryByTestId(`form-field-${HIDDEN_FIELD_ID}`)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'submit' }));
    await waitFor(() => expect(submit).toHaveBeenCalledTimes(1));
    expect(submit.mock.calls[0][0]).not.toHaveProperty(HIDDEN_FIELD_ID);
  });

  it('submits a prefilled value after the filler edits it', async () => {
    const submit = renderForm([titleField], { [TITLE_FIELD_ID]: 'from url' });

    await waitFor(() => expect(fieldValue(TITLE_FIELD_ID)).toBe('from url'));

    fireEvent.click(screen.getByRole('button', { name: `edit-${TITLE_FIELD_ID}` }));
    expect(fieldValue(TITLE_FIELD_ID)).toBe(`edited-${TITLE_FIELD_ID}`);

    fireEvent.click(screen.getByRole('button', { name: 'submit' }));
    await waitFor(() => expect(submit).toHaveBeenCalledTimes(1));
    expect(submit.mock.calls[0][0]).toMatchObject({
      [TITLE_FIELD_ID]: `edited-${TITLE_FIELD_ID}`,
    });
  });

  it('restores the URL prefill after a successful submit', async () => {
    const submit = renderForm([titleField], { [TITLE_FIELD_ID]: 'from url' });

    await waitFor(() => expect(fieldValue(TITLE_FIELD_ID)).toBe('from url'));

    fireEvent.click(screen.getByRole('button', { name: `edit-${TITLE_FIELD_ID}` }));
    expect(fieldValue(TITLE_FIELD_ID)).toBe(`edited-${TITLE_FIELD_ID}`);
    await waitFor(() =>
      expect(window.localStorage.getItem(LocalStorageKeys.ViewFromData)).toContain(
        `edited-${TITLE_FIELD_ID}`
      )
    );

    vi.useFakeTimers();
    try {
      fireEvent.click(screen.getByRole('button', { name: 'submit' }));
      await act(async () => {
        await Promise.resolve();
      });
      expect(submit).toHaveBeenCalledTimes(1);
      expect(submit.mock.calls[0][0]).toMatchObject({
        [TITLE_FIELD_ID]: `edited-${TITLE_FIELD_ID}`,
      });

      act(() => {
        vi.advanceTimersByTime(1000);
      });

      expect(fieldValue(TITLE_FIELD_ID)).toBe('from url');
      expect(window.localStorage.getItem(LocalStorageKeys.ViewFromData)).not.toContain(
        TITLE_FIELD_ID
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it('applies the new URL prefill after switching form views', async () => {
    sdkHooks.useTableId.mockReturnValue(TABLE_ID);
    router.query = { [TITLE_FIELD_ID]: 'view a' };
    sdkHooks.useFields.mockReturnValue([titleField]);
    sdkHooks.useView.mockReturnValue({
      id: VIEW_ID,
      name: 'Form A',
      description: '',
      columnMeta: { [TITLE_FIELD_ID]: { visible: true } },
      options: { submitLabel: 'submit' },
    });
    const submit = vi.fn().mockResolvedValue(undefined);
    const { rerender } = render(<FormBody submit={submit} />);
    await waitFor(() => expect(fieldValue(TITLE_FIELD_ID)).toBe('view a'));

    router.query = { [TITLE_FIELD_ID]: 'view b' };
    sdkHooks.useView.mockReturnValue({
      id: 'viwT8046FormBodyB',
      name: 'Form B',
      description: '',
      columnMeta: { [TITLE_FIELD_ID]: { visible: true } },
      options: { submitLabel: 'submit' },
    });
    rerender(<FormBody submit={submit} />);

    // The same field is prefilled in both views; the new view's value must win.
    await waitFor(() => expect(fieldValue(TITLE_FIELD_ID)).toBe('view b'));
  });
});
