import { FieldType, NumberFormattingType } from '@teable/core';
import type * as SdkHooks from '@teable/sdk/hooks';
import type { IFieldInstance } from '@teable/sdk/model';
import { fireEvent, render, screen, waitFor } from '@/test-utils';
import { FormBody } from './FromBody';

const sdkHooks = vi.hoisted(() => ({
  useFields: vi.fn(),
  useView: vi.fn(),
  useTableId: vi.fn(),
}));

vi.mock('@teable/sdk/hooks', async (importOriginal) => {
  const actual = await importOriginal<typeof SdkHooks>();
  return {
    ...actual,
    useFields: sdkHooks.useFields,
    useView: sdkHooks.useView,
    useTableId: sdkHooks.useTableId,
  };
});

vi.mock('@/features/app/hooks/usePreviewUrl', () => ({
  usePreviewUrl: () => (path: string) => path,
}));

vi.mock('next/router', () => ({ useRouter: () => ({ query: {} }) }));

vi.mock('./FormField', () => ({
  FormField: ({ field, errors }: { field: IFieldInstance; errors: Set<string> }) => (
    <div data-testid={`form-field-${field.id}`} data-error={String(errors.has(field.id))} />
  ),
}));

const TABLE_ID = 'tblT7731FormBody';
const VIEW_ID = 'viwT7731FormBody';
const TITLE_FIELD_ID = 'fldT7731Title';
const DEFAULT_FIELD_ID = 'fldT7731Default';
const NO_DEFAULT_FIELD_ID = 'fldT7731NoDefault';

const buildField = (
  overrides: Partial<IFieldInstance> & Pick<IFieldInstance, 'id'>
): IFieldInstance =>
  ({
    name: overrides.id,
    type: FieldType.SingleLineText,
    isComputed: false,
    isLookup: false,
    isConditionalLookup: false,
    notNull: false,
    options: {},
    ...overrides,
  }) as unknown as IFieldInstance;

const titleField = buildField({ id: TITLE_FIELD_ID, name: 'title' });
const defaultField = buildField({
  id: DEFAULT_FIELD_ID,
  name: 'dept',
  notNull: true,
  options: { defaultValue: 'default-dept' },
});
const noDefaultField = buildField({
  id: NO_DEFAULT_FIELD_ID,
  name: 'owner',
  notNull: true,
  options: {},
});
const zeroDefaultFieldId = 'fldT7731Zero';
const emptyDefaultFieldId = 'fldT7731Empty';
const zeroDefaultField = buildField({
  id: zeroDefaultFieldId,
  name: 'count',
  notNull: true,
  type: FieldType.Number,
  options: {
    defaultValue: 0,
    formatting: { type: NumberFormattingType.Decimal, precision: 0 },
  },
});
const nullDefaultFieldId = 'fldT7731Null';
const nullDefaultField = buildField({
  id: nullDefaultFieldId,
  name: 'none',
  notNull: true,
  options: { defaultValue: null },
});
const falseDefaultFieldId = 'fldT7731False';
const falseDefaultField = buildField({
  id: falseDefaultFieldId,
  name: 'flag',
  notNull: true,
  type: FieldType.Checkbox,
  options: { defaultValue: false },
});
const emptyDefaultField = buildField({
  id: emptyDefaultFieldId,
  name: 'note',
  notNull: true,
  options: { defaultValue: '' },
});

const renderForm = (fields: IFieldInstance[], columnMeta: Record<string, unknown>) => {
  sdkHooks.useTableId.mockReturnValue(TABLE_ID);
  sdkHooks.useFields.mockReturnValue(fields);
  sdkHooks.useView.mockReturnValue({
    id: VIEW_ID,
    name: 'Form',
    description: '',
    columnMeta,
    options: { submitLabel: 'submit' },
  });
  const submit = vi.fn().mockResolvedValue(undefined);
  render(<FormBody submit={submit} />);
  return submit;
};

const clickSubmit = () => fireEvent.click(screen.getByRole('button', { name: 'submit' }));

describe('FormBody issue T7731', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.localStorage.clear();
  });

  it('submits when a not-null field carries a default value', async () => {
    const submit = renderForm([titleField, defaultField], {
      [TITLE_FIELD_ID]: { visible: true },
      [DEFAULT_FIELD_ID]: { visible: true },
    });

    clickSubmit();

    await waitFor(() => expect(submit).toHaveBeenCalledTimes(1));
    // Empty cells are sent as undefined: JSON drops them from the wire body, so
    // the backend fills the field default.
    expect(submit.mock.calls[0][0]).toStrictEqual({
      [TITLE_FIELD_ID]: undefined,
      [DEFAULT_FIELD_ID]: undefined,
    });
  });

  it('still blocks a not-null field without a default value', () => {
    const submit = renderForm([titleField, noDefaultField], {
      [TITLE_FIELD_ID]: { visible: true },
      [NO_DEFAULT_FIELD_ID]: { visible: true },
    });

    clickSubmit();

    expect(submit).not.toHaveBeenCalled();
    expect(screen.getByTestId(`form-field-${NO_DEFAULT_FIELD_ID}`)).toHaveAttribute(
      'data-error',
      'true'
    );
  });

  it('keeps a default-carrying field required when the form switch enables it', () => {
    const submit = renderForm([titleField, defaultField], {
      [TITLE_FIELD_ID]: { visible: true },
      [DEFAULT_FIELD_ID]: { visible: true, required: true },
    });

    clickSubmit();

    expect(submit).not.toHaveBeenCalled();
    expect(screen.getByTestId(`form-field-${DEFAULT_FIELD_ID}`)).toHaveAttribute(
      'data-error',
      'true'
    );
  });

  it('submits when a field has no column meta entry', async () => {
    const submit = renderForm([titleField, defaultField], {});

    clickSubmit();

    await waitFor(() => expect(submit).toHaveBeenCalledTimes(1));
  });

  it('submits when a not-null field carries a zero default value', async () => {
    const submit = renderForm([titleField, zeroDefaultField], {
      [TITLE_FIELD_ID]: { visible: true },
      [zeroDefaultFieldId]: { visible: true },
    });

    clickSubmit();

    await waitFor(() => expect(submit).toHaveBeenCalledTimes(1));
  });

  it('still blocks a not-null field whose default is an empty string', () => {
    const submit = renderForm([titleField, emptyDefaultField], {
      [TITLE_FIELD_ID]: { visible: true },
      [emptyDefaultFieldId]: { visible: true },
    });

    clickSubmit();

    expect(submit).not.toHaveBeenCalled();
    expect(screen.getByTestId(`form-field-${emptyDefaultFieldId}`)).toHaveAttribute(
      'data-error',
      'true'
    );
  });

  it('still blocks a not-null field whose default is null', () => {
    const submit = renderForm([titleField, nullDefaultField], {
      [TITLE_FIELD_ID]: { visible: true },
      [nullDefaultFieldId]: { visible: true },
    });

    clickSubmit();

    expect(submit).not.toHaveBeenCalled();
    expect(screen.getByTestId(`form-field-${nullDefaultFieldId}`)).toHaveAttribute(
      'data-error',
      'true'
    );
  });

  it('still blocks a not-null checkbox whose default is false', () => {
    const submit = renderForm([titleField, falseDefaultField], {
      [TITLE_FIELD_ID]: { visible: true },
      [falseDefaultFieldId]: { visible: true },
    });

    clickSubmit();

    expect(submit).not.toHaveBeenCalled();
    expect(screen.getByTestId(`form-field-${falseDefaultFieldId}`)).toHaveAttribute(
      'data-error',
      'true'
    );
  });
});
