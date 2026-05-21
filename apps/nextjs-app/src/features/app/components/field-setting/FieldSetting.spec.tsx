import {
  CellValueType,
  DbFieldType,
  FieldAIActionType,
  FieldType,
  StatisticsFunc,
} from '@teable/core';
import type * as OpenApi from '@teable/openapi';
import type * as SdkHooks from '@teable/sdk/hooks';
import { act } from 'react';
import { render, screen, TestAnchorProvider, userEvent, waitFor } from '@/test-utils';
import { FieldSetting, FieldSettingBase } from './FieldSetting';
import { FieldOperator } from './type';

const fieldOperationMocks = vi.hoisted(() => ({
  createField: vi.fn(),
  convertField: vi.fn(),
  planFieldCreate: vi.fn(),
  planFieldConvert: vi.fn(),
  autoFillField: vi.fn(),
}));

const openapiMocks = vi.hoisted(() => ({
  getAggregation: vi.fn(),
}));

vi.mock('@teable/openapi', async (importOriginal) => {
  const actual = await importOriginal<typeof OpenApi>();
  return {
    ...actual,
    getAggregation: openapiMocks.getAggregation,
  };
});

vi.mock('@teable/sdk/hooks', async (importOriginal) => {
  const actual = await importOriginal<typeof SdkHooks>();
  return {
    ...actual,
    useTableId: () => 'tblTest0000000001',
    useView: () => ({ id: 'viwTest0000000001' }),
    useRowCount: () => 30,
    useFieldOperations: () => fieldOperationMocks,
  };
});

vi.mock('./DynamicFieldEditor', () => ({
  DynamicFieldEditor: ({
    field,
    onChange,
    onSave,
  }: {
    field: { name?: string; type?: string; isLookup?: boolean };
    onChange?: (field: unknown) => void;
    onSave?: () => void | Promise<void>;
  }) => (
    <div data-testid="dynamic-field-editor">
      <span data-testid="editor-field-name">{field.name ?? ''}</span>
      <span data-testid="editor-field-type">{field.type ?? ''}</span>
      <span data-testid="editor-field-is-lookup">{field.isLookup ? 'true' : 'false'}</span>
      <button
        type="button"
        onClick={() =>
          onChange?.({
            ...field,
            name: 'AI Reply',
            aiConfig: {
              type: FieldAIActionType.Customization,
              modelKey: 'gpt-5.5',
              prompt: 'Write a concise customer-service reply.',
              isAutoFill: true,
            },
          })
        }
      >
        Mock change AI config
      </button>
      <button type="button" onClick={() => onSave?.()}>
        Mock editor save
      </button>
    </div>
  ),
}));

const createDeferred = <T,>() => {
  let resolve: (value: T) => void = () => undefined;
  let reject: (reason?: unknown) => void = () => undefined;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
};

describe('FieldSettingBase', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('disables save when editing target field is not available yet', () => {
    render(
      <FieldSettingBase
        visible
        field={undefined}
        operator={FieldOperator.Edit}
        onCancel={() => undefined}
        onConfirm={() => undefined}
      />
    );

    expect(screen.getByRole('button', { name: 'common:actions.save' })).toBeDisabled();
  });

  it('hydrates local editor state when originField arrives after initial fallback render', () => {
    const lookupField = {
      id: 'fldLookup0000000001',
      name: 'Lookup Child Name',
      type: FieldType.SingleLineText,
      options: {},
      isLookup: true,
      cellValueType: CellValueType.String,
      isMultipleCellValue: false,
      dbFieldType: DbFieldType.Text,
      dbFieldName: 'Lookup_Child_Name',
    } as const;

    const { rerender } = render(
      <FieldSettingBase
        visible
        field={undefined}
        operator={FieldOperator.Edit}
        onCancel={() => undefined}
        onConfirm={() => undefined}
      />
    );

    expect(screen.getByTestId('editor-field-type')).toHaveTextContent(FieldType.SingleLineText);
    expect(screen.getByTestId('editor-field-name')).toHaveTextContent('');
    expect(screen.getByTestId('editor-field-is-lookup')).toHaveTextContent('false');

    rerender(
      <FieldSettingBase
        visible
        field={lookupField}
        operator={FieldOperator.Edit}
        onCancel={() => undefined}
        onConfirm={() => undefined}
      />
    );

    expect(screen.getByTestId('editor-field-name')).toHaveTextContent('Lookup Child Name');
    expect(screen.getByTestId('editor-field-type')).toHaveTextContent(FieldType.SingleLineText);
    expect(screen.getByTestId('editor-field-is-lookup')).toHaveTextContent('true');
  });

  it('keeps the AI apply dialog open until field save succeeds', async () => {
    const field = {
      id: 'fldTest0000000001',
      name: 'Reply',
      type: FieldType.SingleLineText,
      options: {},
      aiConfig: {
        type: FieldAIActionType.Customization,
        modelKey: 'old-model',
        prompt: 'Old prompt',
        isAutoFill: true,
      },
      cellValueType: CellValueType.String,
      isMultipleCellValue: false,
      dbFieldType: DbFieldType.Text,
      dbFieldName: 'Reply',
    } as const;
    const updatedField = {
      ...field,
      name: 'AI Reply',
      aiConfig: {
        type: FieldAIActionType.Customization,
        modelKey: 'gpt-5.5',
        prompt: 'Write a concise customer-service reply.',
        isAutoFill: true,
      },
    };
    const convertDeferred = createDeferred<typeof updatedField>();

    openapiMocks.getAggregation.mockResolvedValue({
      data: {
        aggregations: [
          {
            fieldId: field.id,
            total: { aggFunc: StatisticsFunc.Empty, value: 0 },
          },
          {
            fieldId: field.id,
            total: { aggFunc: StatisticsFunc.Filled, value: 30 },
          },
        ],
      },
    });
    fieldOperationMocks.planFieldConvert.mockResolvedValue({
      estimateTime: 0,
      linkFieldCount: 0,
    });
    fieldOperationMocks.convertField.mockReturnValue(convertDeferred.promise);
    fieldOperationMocks.autoFillField.mockResolvedValue(undefined);

    render(
      <TestAnchorProvider>
        <FieldSetting
          visible
          field={field}
          operator={FieldOperator.Edit}
          onCancel={() => undefined}
          onConfirm={() => undefined}
        />
      </TestAnchorProvider>
    );

    await userEvent.click(screen.getByRole('button', { name: 'Mock change AI config' }));
    await userEvent.click(screen.getByRole('button', { name: 'common:actions.save' }));

    expect(
      await screen.findByText('table:field.aiConfig.autoFillConfirm.title')
    ).toBeInTheDocument();

    await userEvent.click(
      screen.getByRole('button', { name: 'table:field.aiConfig.autoFillConfirm.generateAll' })
    );

    expect(fieldOperationMocks.convertField).toHaveBeenCalled();
    expect(fieldOperationMocks.autoFillField).not.toHaveBeenCalled();
    expect(screen.getByText('table:field.aiConfig.autoFillConfirm.title')).toBeInTheDocument();

    await act(async () => {
      convertDeferred.resolve(updatedField);
      await convertDeferred.promise;
    });

    await waitFor(() => {
      expect(
        screen.queryByText('table:field.aiConfig.autoFillConfirm.title')
      ).not.toBeInTheDocument();
    });
    expect(fieldOperationMocks.autoFillField).toHaveBeenCalledWith({
      tableId: 'tblTest0000000001',
      fieldId: field.id,
      query: { viewId: 'viwTest0000000001', mode: 'all' },
    });
  });
});
