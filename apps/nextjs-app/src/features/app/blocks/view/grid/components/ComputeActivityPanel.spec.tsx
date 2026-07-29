import { useComputeActivity, useFields, useFieldStaticGetter } from '@teable/sdk/hooks';
import type { IComputeActivityState } from '@teable/sdk/hooks';
import type { SVGProps } from 'react';
import { vi } from 'vitest';
import { render, screen, userEvent } from '@/test-utils';
import { ComputeActivityPanel } from './ComputeActivityPanel';

const { mockedT } = vi.hoisted(() => ({
  mockedT: vi.fn((key: string, _options?: Record<string, unknown>) => key),
}));

vi.mock('next-i18next', () => ({
  useTranslation: () => ({
    t: mockedT,
    i18n: { language: 'en' },
  }),
}));

vi.mock('@teable/sdk/hooks', () => ({
  useComputeActivity: vi.fn(),
  useFields: vi.fn(),
  useFieldStaticGetter: vi.fn(),
}));

const mockedUseComputeActivity = vi.mocked(useComputeActivity);
const mockedUseFields = vi.mocked(useFields);
const mockedUseFieldStaticGetter = vi.mocked(useFieldStaticGetter);

const FieldTypeIcon = (props: SVGProps<SVGSVGElement>) => (
  <svg data-testid="field-type-icon" {...props} />
);

const setActivity = (
  fieldMetaById: IComputeActivityState['fieldMetaById'],
  tableMeta: IComputeActivityState['tableMeta'] = null
) => {
  const values = Object.values(fieldMetaById);
  const queuedFieldCount = values.filter(({ status }) => status === 'queued').length;
  const calculatingFieldCount = values.filter(({ status }) => status === 'running').length;
  const failedFieldCount = values.filter(({ status }) => status === 'failed').length;
  mockedUseComputeActivity.mockReturnValue({
    snapshot: null,
    tableMeta,
    fieldMetaById,
    diagnostics: {
      computeMode: 'server',
      activeFieldCount: queuedFieldCount + calculatingFieldCount,
      queuedFieldCount,
      calculatingFieldCount,
      failedFieldCount,
      highComplexityFieldCount: 0,
      anomalies: [],
    },
    activeFieldCount: queuedFieldCount + calculatingFieldCount,
    isFetching: false,
    refetch: vi.fn(),
    revision: 1,
  });
};

describe('ComputeActivityPanel', () => {
  beforeEach(() => {
    mockedT.mockClear();
    mockedUseFields.mockReturnValue([]);
    mockedUseFieldStaticGetter.mockReturnValue(vi.fn(() => ({ Icon: FieldTypeIcon })) as never);
    setActivity({});
  });

  it('shows current fields with their icons and batch progress', async () => {
    mockedUseFields.mockReturnValue([
      {
        id: 'fldFormula',
        name: 'Revenue formula',
        type: 'formula',
        canReadFieldRecord: true,
      },
      {
        id: 'fldLookup',
        name: 'Customer lookup',
        type: 'singleLineText',
        isLookup: true,
        canReadFieldRecord: true,
      },
    ] as never);
    setActivity({
      fldFormula: {
        status: 'running',
        activeTaskCount: 3,
        processingTaskCount: 1,
        batchProgress: { total: 5, completed: 2 },
      },
      fldLookup: { status: 'queued', activeTaskCount: 1, processingTaskCount: 0 },
    });

    render(<ComputeActivityPanel />);
    await userEvent.click(screen.getByRole('button'));

    expect(screen.getByText('Revenue formula')).toBeInTheDocument();
    expect(screen.getByText('Customer lookup')).toBeInTheDocument();
    expect(screen.getAllByTestId('field-type-icon')).toHaveLength(2);
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '2');
  });

  it('does not reveal activity for fields without record-read permission', async () => {
    mockedUseFields.mockReturnValue([
      {
        id: 'fldVisible',
        name: 'Visible formula',
        type: 'formula',
        canReadFieldRecord: true,
      },
      {
        id: 'fldSecret',
        name: 'Secret formula',
        type: 'formula',
        canReadFieldRecord: false,
      },
    ] as never);
    setActivity({
      fldVisible: { status: 'running' },
      fldSecret: { status: 'running' },
      fldOtherTable: { status: 'running' },
    });

    render(<ComputeActivityPanel />);
    await userEvent.click(screen.getByRole('button'));

    expect(screen.getByText('Visible formula')).toBeInTheDocument();
    expect(screen.queryByText('Secret formula')).not.toBeInTheDocument();
    expect(mockedT).toHaveBeenCalledWith('computeActivity.fieldsCalculating', { count: 1 });
  });

  it('shows the current failure and ignores idle fields', async () => {
    mockedUseFields.mockReturnValue([
      {
        id: 'fldFailed',
        name: 'Broken rollup',
        type: 'rollup',
        canReadFieldRecord: true,
      },
      {
        id: 'fldIdle',
        name: 'Finished formula',
        type: 'formula',
        canReadFieldRecord: true,
      },
    ] as never);
    setActivity(
      {
        fldFailed: { status: 'failed', lastError: { message: 'Invalid dependency' } },
        fldIdle: { status: 'idle', lastDurationMs: 42 },
      },
      {
        status: 'idle',
        calculatingFieldCount: 0,
        recentCompletions: [
          { fieldId: 'fldIdle', durationMs: 42, completedAt: '2026-07-17T00:00:00.000Z' },
        ],
      }
    );

    render(<ComputeActivityPanel />);
    await userEvent.click(screen.getByRole('button'));

    expect(screen.getByText('Broken rollup')).toBeInTheDocument();
    expect(screen.getByText('Invalid dependency')).toBeInTheDocument();
    expect(screen.queryByText('Finished formula')).not.toBeInTheDocument();
  });

  it('does not reserve a top bar when there is no current activity', () => {
    mockedUseFields.mockReturnValue([
      {
        id: 'fldIdle',
        name: 'Idle formula',
        type: 'formula',
        canReadFieldRecord: true,
      },
    ] as never);
    setActivity({ fldIdle: { status: 'idle' } });

    const { container } = render(<ComputeActivityPanel />);

    expect(container).toBeEmptyDOMElement();
  });
});
