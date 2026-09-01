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

  it('shows compact progress only for running fields', async () => {
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
        estimatedDirtyRecords: 6000,
        batchProgress: { total: 5, completed: 2 },
      },
      fldLookup: {
        status: 'queued',
        activeTaskCount: 4,
        processingTaskCount: 0,
        estimatedDirtyRecords: 12000,
        batchProgress: { total: 4, completed: 2 },
      },
    });

    render(<ComputeActivityPanel />);
    await userEvent.click(screen.getByRole('button'));

    expect(screen.getByText('Revenue formula')).toBeInTheDocument();
    expect(screen.getByText('Customer lookup')).toBeInTheDocument();
    expect(screen.getAllByTestId('field-type-icon')).toHaveLength(2);
    const progressText = screen.getByText('40%');
    expect(progressText).toHaveClass('ms-auto', 'text-muted-foreground');
    expect(progressText.parentElement).toHaveClass('justify-between');
    expect(screen.getByText('computeActivity.calculating')).not.toHaveTextContent('%');
    expect(screen.queryByText('50%')).not.toBeInTheDocument();
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
    const scrollArea = screen.getByText('Revenue formula').closest('.overflow-y-auto');
    expect(scrollArea).toBeInTheDocument();
    expect(scrollArea).not.toContainElement(
      screen.getByText('computeActivity.currentCalculations')
    );
    expect(mockedT).toHaveBeenCalledWith('computeActivity.records', {
      count: 6000,
      formattedCount: '6,000',
    });
    expect(mockedT).not.toHaveBeenCalledWith('computeActivity.batchesRunning', expect.anything());
    expect(mockedT).not.toHaveBeenCalledWith('computeActivity.batchesQueued', expect.anything());
    expect(mockedT).not.toHaveBeenCalledWith('computeActivity.batchesComplete', expect.anything());
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

  it('translates oversized computed cell failures', async () => {
    mockedUseFields.mockReturnValue([
      {
        id: 'fldFailed',
        name: 'Huge formula',
        type: 'formula',
        canReadFieldRecord: true,
      },
    ] as never);
    setActivity({
      fldFailed: {
        status: 'failed',
        lastError: {
          code: 'validation.limit.computed_cell_value_max_bytes',
          message:
            'Computed cell value is too large (312000 / 262144 bytes). Shorten the source data or change the formula.',
          context: { attempted: 312000, max: 262144 },
        },
      },
    });

    render(<ComputeActivityPanel />);
    await userEvent.click(screen.getByRole('button'));

    expect(mockedT).toHaveBeenCalledWith('computeActivity.cellValueTooLarge', {
      attempted: 312000,
      max: 262144,
    });
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
