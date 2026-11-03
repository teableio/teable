import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type {
  IOperationPreviewDto,
  IOperationPreviewRequestDto,
  IOperationPreviewOkResponseDto,
} from '@teable/v2-contract-http/operationPreview';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { PropsWithChildren, ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TableDeleteConfirmDialog } from '../table-delete-confirm-dialog/TableDeleteConfirmDialog';
import { OperationPreviewPanel } from './OperationPreviewPanel';
import { useOperationPreview } from './useOperationPreview';

const { post, locale } = vi.hoisted(() => ({ post: vi.fn(), locale: { language: 'en' } }));
vi.mock('@teable/openapi', () => ({ getAxios: () => ({ post }) }));
vi.mock('@teable/sdk/hooks', () => ({ useBaseId: () => 'bseSource' }));
vi.mock('next-i18next', async () => {
  // Vitest hoists this factory before static imports; load the real translations inside it.
  const { createInstance } = await import('i18next');
  const en = await import('@teable/common-i18n/src/locales/en/common.json');
  const zh = await import('@teable/common-i18n/src/locales/zh/common.json');
  const i18n = createInstance();
  await i18n.init({
    lng: 'en',
    fallbackLng: 'en',
    defaultNS: 'common',
    resources: { en: { common: en.default }, zh: { common: zh.default } },
  });
  return {
    useTranslation: () => ({ t: i18n.getFixedT(locale.language), i18n }),
  };
});
vi.mock('@teable/ui-lib/shadcn', () => ({
  Button: ({ children, onClick }: PropsWithChildren<{ onClick?: () => void }>) => (
    <button onClick={onClick}>{children}</button>
  ),
}));
vi.mock('@teable/ui-lib/base', () => ({
  ConfirmDialog: ({
    content,
    confirmDisabled,
    onConfirm,
  }: {
    content: ReactNode;
    confirmDisabled?: boolean;
    onConfirm: () => void;
  }) => (
    <div>
      {content}
      <button disabled={confirmDisabled} onClick={onConfirm}>
        Confirm
      </button>
    </div>
  ),
}));
vi.mock('../LoginAppWarning', () => ({ LoginAppWarning: () => null }));

const previewFixture = (overrides: Partial<IOperationPreviewDto> = {}): IOperationPreviewDto => ({
  operation: 'table.delete',
  outcome: 'ready',
  effects: [],
  blockers: [],
  warnings: [],
  coverage: { known: ['delete-mode'], unknown: [] },
  complexity: null,
  authorization: 'checked',
  observedAt: '2026-10-27T12:00:00.000Z',
  consistency: 'best-effort',
  requestDigest: `sha256:${'a'.repeat(64)}`,
  implementation: { plannerVersion: 'test-1', executionPath: 'v2' },
  ...overrides,
});
const response = (preview: IOperationPreviewDto): { data: IOperationPreviewOkResponseDto } => ({
  data: { ok: true, data: preview },
});
const clients: QueryClient[] = [];
const wrapper = () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  clients.push(client);
  return ({ children }: PropsWithChildren) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
};
afterEach(() => {
  cleanup();
  clients.forEach((client) => client.clear());
  clients.length = 0;
  vi.resetAllMocks();
  locale.language = 'en';
});

const PendingOperation = ({ request }: { request: IOperationPreviewRequestDto }) => {
  const query = useOperationPreview(request, true);
  return (
    <>
      <OperationPreviewPanel
        preview={query.data}
        error={query.error}
        isLoading={query.isPending || query.isFetching}
        onRetry={() => void query.refetch()}
      />
      <button disabled={!query.canConfirm}>Confirm</button>
    </>
  );
};

describe('operation preview confirmation', () => {
  it('disables delete confirmation on HTTP failure and exposes retry instead of empty dependencies', async () => {
    post.mockRejectedValueOnce(new Error('permission denied'));
    const confirm = vi.fn();
    render(
      <TableDeleteConfirmDialog
        open
        tableId="tblSource"
        tableName="Orders"
        onOpenChange={vi.fn()}
        onConfirm={confirm}
      />,
      { wrapper: wrapper() }
    );
    expect(screen.getByRole('button', { name: 'Confirm' })).toBeDisabled();
    expect(await screen.findByRole('alert')).toHaveTextContent('The preview could not be loaded');
    expect(screen.getByRole('button', { name: 'Confirm' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));
    expect(confirm).not.toHaveBeenCalled();
    expect(screen.queryByText(/Details of this change/)).not.toBeInTheDocument();
    expect(post).toHaveBeenCalledWith(
      '/v2/operations/preview',
      {
        operation: 'table.delete',
        input: { baseId: 'bseSource', tableId: 'tblSource', mode: 'soft' },
        options: { detail: 'full' },
      },
      expect.objectContaining({ signal: expect.any(AbortSignal) })
    );

    post.mockResolvedValueOnce(response(previewFixture()));
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Confirm' })).toBeEnabled());
  });

  it('shows the actual v2 blocked duplicate decision and prevents confirmation', async () => {
    post.mockResolvedValueOnce(
      response(
        previewFixture({
          operation: 'table.duplicate',
          outcome: 'blocked',
          blockers: [
            {
              code: 'table.duplicate.v2_cross_space_blocked',
              message: 'Cross-space references cannot be duplicated on this execution path.',
            },
          ],
          effects: [
            {
              code: 'table.duplicate.link.cross_space_blocked',
              kind: 'dependency.change',
              measures: {},
            },
          ],
        })
      )
    );
    render(
      <PendingOperation
        request={{
          operation: 'table.duplicate',
          input: { baseId: 'bseSource', tableId: 'tblSource', name: 'Copy', includeRecords: true },
        }}
      />,
      { wrapper: wrapper() }
    );
    expect(await screen.findByText(/This table has links to another space/)).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('This operation cannot proceed');
    expect(screen.queryByText('table.duplicate.v2_cross_space_blocked')).not.toBeInTheDocument();
    expect(screen.queryByText('table.duplicate.link.cross_space_blocked')).not.toBeInTheDocument();
    expect(
      screen.queryByText('Cross-space references cannot be duplicated on this execution path.')
    ).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Confirm' })).toBeDisabled();
  });

  it('does not present empty effects as proof of no impact and keeps missing evidence explicit', async () => {
    post.mockResolvedValueOnce(
      response(
        previewFixture({
          outcome: 'incomplete',
          coverage: { known: [], unknown: ['host.trash-retention'] },
          warnings: [{ code: 'table.delete.retention.unknown' }],
        })
      )
    );
    render(
      <TableDeleteConfirmDialog
        open
        tableId="tblSource"
        tableName="Orders"
        onOpenChange={vi.fn()}
        onConfirm={vi.fn()}
      />,
      { wrapper: wrapper() }
    );
    expect(await screen.findByText('Impact details are unavailable.')).toBeInTheDocument();
    expect(screen.getByText('The Trash retention period is not checked.')).toBeInTheDocument();
    expect(screen.queryByText('Storage impact is not checked.')).not.toBeInTheDocument();
    expect(screen.queryByText('host.trash-retention')).not.toBeInTheDocument();
    expect(screen.queryByText('table.delete.retention.unknown')).not.toBeInTheDocument();
    expect(screen.queryByText(/Preview incomplete|Not checked|Warnings/)).not.toBeInTheDocument();
  });

  it('refetches the exact delete mode and disables confirmation while the new input is pending', async () => {
    post.mockResolvedValueOnce(response(previewFixture()));
    const props = {
      open: true,
      tableId: 'tblSource',
      tableName: 'Orders',
      onOpenChange: vi.fn(),
      onConfirm: vi.fn(),
    };
    const view = render(<TableDeleteConfirmDialog {...props} />, { wrapper: wrapper() });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Confirm' })).toBeEnabled());
    const { promise, resolve: complete } = Promise.withResolvers<{
      data: IOperationPreviewOkResponseDto;
    }>();
    post.mockReturnValueOnce(promise);
    view.rerender(<TableDeleteConfirmDialog {...props} mode="permanent" />);
    await waitFor(() =>
      expect(post).toHaveBeenLastCalledWith(
        '/v2/operations/preview',
        expect.objectContaining({
          input: { baseId: 'bseSource', tableId: 'tblSource', mode: 'permanent' },
        }),
        expect.anything()
      )
    );
    expect(screen.getByRole('button', { name: 'Confirm' })).toBeDisabled();
    complete(
      response(
        previewFixture({
          effects: [
            {
              code: 'table.delete.resource.permanently_deleted',
              kind: 'resource.permanent-delete',
              measures: { tables: { basis: 'exact', value: 1, unit: 'tables' } },
            },
          ],
        })
      )
    );
    expect(
      await screen.findByText('Permanently delete this table. It cannot be restored from Trash.')
    ).toBeInTheDocument();
  });

  it.each([
    { name: 'Renamed', includeRecords: true },
    { name: 'Copy', includeRecords: false },
  ])('refetches table duplicate pending write changes: %j', async (input) => {
    post.mockResolvedValue(response(previewFixture({ operation: 'table.duplicate' })));
    const initial = {
      operation: 'table.duplicate',
      input: { baseId: 'bseSource', tableId: 'tblSource', name: 'Copy', includeRecords: true },
    };
    const view = render(<PendingOperation request={initial} />, { wrapper: wrapper() });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Confirm' })).toBeEnabled());
    view.rerender(
      <PendingOperation request={{ ...initial, input: { ...initial.input, ...input } }} />
    );
    await waitFor(() =>
      expect(post).toHaveBeenLastCalledWith(
        '/v2/operations/preview',
        { ...initial, input: { ...initial.input, ...input } },
        expect.anything()
      )
    );
    expect(post).toHaveBeenCalledTimes(2);
  });

  it('includes destination, selected nodes, generated identity and timezone in the base copy request identity', async () => {
    post.mockResolvedValue(response(previewFixture({ operation: 'base.duplicate' })));
    const initial = {
      operation: 'base.duplicate',
      input: {
        fromBaseId: 'bseSource',
        spaceId: 'spcOne',
        name: 'Copy',
        withRecords: true,
        nodes: ['bndOne'],
        baseId: 'bseNew',
        timeZone: 'UTC',
      },
    };
    const view = render(<PendingOperation request={initial} />, { wrapper: wrapper() });
    await waitFor(() => expect(post).toHaveBeenCalledTimes(1));
    const changed = {
      ...initial,
      input: {
        ...initial.input,
        spaceId: 'spcTwo',
        nodes: ['bndTwo'],
        timeZone: 'Asia/Shanghai',
        baseId: 'bseOther',
      },
    };
    view.rerender(<PendingOperation request={changed} />);
    await waitFor(() =>
      expect(post).toHaveBeenLastCalledWith('/v2/operations/preview', changed, expect.anything())
    );
    expect(post).toHaveBeenCalledTimes(2);
  });

  it('summarizes project copy with meaningful counts and one non-coverage note, not diagnostics', () => {
    render(
      <OperationPreviewPanel
        isLoading={false}
        onRetry={vi.fn()}
        preview={previewFixture({
          operation: 'base.duplicate',
          outcome: 'incomplete',
          effects: [
            {
              code: 'base.duplicate.structure.selected',
              kind: 'resource.copy',
              resource: {
                visibility: 'authorized',
                kind: 'base',
                id: 'bseSource',
                name: 'Sales',
              },
              measures: {
                tables: { basis: 'exact', value: 1, unit: 'tables' },
                fields: { basis: 'exact', value: 3, unit: 'fields' },
                views: { basis: 'exact', value: 1, unit: 'views' },
                nodes: { basis: 'exact', value: 1, unit: 'nodes' },
              },
            },
            {
              code: 'base.duplicate.records.copy',
              kind: 'resource.copy',
              measures: {
                records: { basis: 'exact', value: 3, unit: 'records' },
              },
            },
            {
              code: 'base.duplicate.billing.quota.unknown',
              kind: 'host.effect',
              measures: {
                evidence: { basis: 'unknown', unit: 'checks', reason: 'CE read-only preparation' },
              },
            },
          ],
          coverage: { known: [], unknown: ['host.billing.quota', 'host.attachments'] },
          warnings: [
            { code: 'base.duplicate.billing.quota.unknown', message: 'CE read-only preparation' },
            { code: 'base.duplicate.attachments.unknown', message: 'Internal attachment checks' },
          ],
        })}
      />
    );
    expect(screen.getByRole('heading', { name: 'Copy from: Sales' })).toBeInTheDocument();
    expect(screen.getByText('Copy fields, views and records')).toBeInTheDocument();
    for (const [label, value] of [
      ['Tables', '1'],
      ['Fields', '3'],
      ['Views', '1'],
      ['Records', '3'],
    ]) {
      expect(screen.getByText(label).parentElement).toHaveTextContent(`${label}${value}`);
    }
    expect(screen.getAllByText('Not fully checked: execution-time effects.')).toHaveLength(1);
    expect(
      screen.queryByText(/CE|host\.|checks|nodes|resource.copy|base.duplicate/)
    ).not.toBeInTheDocument();
  });

  it.each([
    { basis: 'exact', value: 0, unit: 'records', text: '0' },
    { basis: 'estimate', value: 42, unit: 'records', source: 'internal catalog', text: 'About 42' },
    {
      basis: 'range',
      lower: 7,
      expected: 14,
      upper: 30,
      unit: 'records',
      source: 'internal catalog',
      text: '7–30 (estimated) · About 14 expected',
    },
    {
      basis: 'range',
      lower: null,
      expected: 14,
      upper: null,
      unit: 'records',
      source: 'internal catalog',
      text: 'About 14 expected',
    },
    {
      basis: 'range',
      lower: 7,
      expected: null,
      upper: null,
      unit: 'records',
      source: 'internal catalog',
      text: 'At least 7 (estimated)',
    },
    {
      basis: 'range',
      lower: null,
      expected: null,
      upper: 30,
      unit: 'records',
      source: 'internal catalog',
      text: 'Up to 30 (estimated)',
    },
    {
      basis: 'range',
      lower: null,
      expected: null,
      upper: null,
      unit: 'records',
      source: 'internal catalog',
      text: 'Count unavailable',
    },
    {
      basis: 'unknown',
      unit: 'records',
      reason: 'internal reason',
      text: 'Count unavailable',
    },
  ] as const)(
    'preserves known zero and uncertain record counts: $basis $text',
    ({ text, ...measure }) => {
      render(
        <OperationPreviewPanel
          isLoading={false}
          onRetry={vi.fn()}
          preview={previewFixture({
            operation: 'table.duplicate',
            effects: [
              {
                code: 'table.duplicate.records.copy',
                kind: 'record.insert',
                measures: { records: measure },
              },
            ],
          })}
        />
      );
      expect(screen.getByText('Records').parentElement).toHaveTextContent(text);
      expect(screen.queryByText(/internal catalog|internal reason/)).not.toBeInTheDocument();
    }
  );

  it('states that an omitted-records copy includes structure only, not an unknown count', () => {
    render(
      <OperationPreviewPanel
        isLoading={false}
        onRetry={vi.fn()}
        preview={previewFixture({
          operation: 'table.duplicate',
          effects: [
            {
              code: 'table.duplicate.records.omitted',
              kind: 'record.insert',
              measures: { records: { basis: 'exact', value: 0, unit: 'records' } },
            },
          ],
        })}
      />
    );
    expect(screen.getByText('Copy fields and views without records')).toBeInTheDocument();
    expect(screen.queryByText('Records')).not.toBeInTheDocument();
    expect(screen.queryByText(/unavailable|Determined when this runs/)).not.toBeInTheDocument();
  });

  it('shows delete consequences and authorized names, never IDs or redacted cardinalities', () => {
    render(
      <OperationPreviewPanel
        isLoading={false}
        onRetry={vi.fn()}
        preview={previewFixture({
          effects: [
            {
              code: 'table.delete.resource.trashed',
              kind: 'resource.trash',
              resource: {
                visibility: 'authorized',
                kind: 'table',
                id: 'tblSource',
                name: 'Orders',
              },
              measures: {},
            },
            {
              code: 'table.delete.dependent_field.marked_error',
              kind: 'dependency.change',
              resource: {
                visibility: 'authorized',
                kind: 'field',
                id: 'fldRelated',
                name: 'Order total',
              },
              relatedResources: [
                { visibility: 'authorized', kind: 'table', id: 'tblNameless' },
                {
                  visibility: 'redacted',
                  kind: 'field',
                  quantity: { basis: 'unknown', unit: 'fields', reason: 'secret cardinality' },
                  reason: 'secret reason',
                },
              ],
              measures: {
                fields: { basis: 'unknown', unit: 'fields', reason: 'secret cardinality' },
              },
            },
          ],
        })}
      />
    );
    expect(screen.getByRole('heading', { name: 'Orders' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Orders' }).nextElementSibling).toHaveTextContent(
      'Move to Trash; it can be restored while retained.'
    );
    expect(
      screen.getByText('Move to Trash; it can be restored while retained.')
    ).toBeInTheDocument();
    expect(screen.getByText('Order total')).toBeInTheDocument();
    expect(screen.getByText('Dependent fields will stop calculating')).toBeInTheDocument();
    expect(screen.getByText('Some affected resource details are unavailable.')).toBeInTheDocument();
    expect(
      screen.queryByText(/tblSource|fldRelated|tblNameless|secret|marked_error/)
    ).not.toBeInTheDocument();
  });

  it('names truncated effect details without implying the displayed count is complete', () => {
    render(
      <OperationPreviewPanel
        isLoading={false}
        onRetry={vi.fn()}
        preview={previewFixture({
          warnings: [{ code: 'table.delete.effects_truncated' }],
          effects: [
            {
              code: 'table.delete.resource.trashed',
              kind: 'resource.trash',
              measures: {},
            },
            {
              code: 'table.delete.dependent_field.updated',
              kind: 'dependency.change',
              resource: {
                visibility: 'authorized',
                kind: 'field',
                id: 'fldShown',
                name: 'Shown dependency',
              },
              measures: { fields: { basis: 'exact', value: 1, unit: 'fields' } },
            },
          ],
        })}
      />
    );
    expect(
      screen.getByText('Only part of the affected-resource list is shown.')
    ).toBeInTheDocument();
    expect(screen.queryByText(/Permissions, the recovery period/)).not.toBeInTheDocument();
  });

  it('maps choice-changing link consequences instead of displaying backend prose', () => {
    render(
      <OperationPreviewPanel
        isLoading={false}
        onRetry={vi.fn()}
        preview={previewFixture({
          operation: 'base.duplicate',
          effects: [
            {
              code: 'base.duplicate.link.cross_space_converted',
              kind: 'field.conversion',
              summary: 'INTERNAL raw conversion details',
              resource: {
                visibility: 'authorized',
                kind: 'field',
                id: 'fldLink',
                name: 'Customers',
              },
              measures: { fields: { basis: 'exact', value: 1, unit: 'fields' } },
            },
          ],
        })}
      />
    );
    expect(screen.getByText('Convert cross-space links to text in the copy')).toBeInTheDocument();
    expect(screen.getByText('Customers')).toBeInTheDocument();
    expect(screen.queryByText(/INTERNAL|fldLink|field.conversion/)).not.toBeInTheDocument();
  });

  it.each(['private.machine.diagnostic', 'constructor', 'toString'])(
    'uses safe recovery wording for unknown blocker %s and keeps confirmation disabled',
    async (code) => {
      post.mockResolvedValueOnce(
        response(
          previewFixture({
            outcome: 'blocked',
            blockers: [{ code, message: 'CE secret database error' }],
          })
        )
      );
      render(<PendingOperation request={{ operation: 'table.delete', input: {} }} />, {
        wrapper: wrapper(),
      });
      expect(await screen.findByRole('alert')).toHaveTextContent(
        'Review them or ask a space owner for help'
      );
      expect(screen.queryByText(/private.machine|CE secret/)).not.toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Confirm' })).toBeDisabled();
    }
  );

  it.each([
    ['zh', '复制字段和视图，不含记录'],
    ['fr', 'Copy fields and views without records'],
  ])('localizes summaries with the existing English fallback: %s', (language, heading) => {
    locale.language = language;
    render(
      <OperationPreviewPanel
        isLoading={false}
        onRetry={vi.fn()}
        preview={previewFixture({
          operation: 'base.duplicate',
          effects: [{ code: 'base.duplicate.records.omitted', kind: 'host.effect', measures: {} }],
        })}
      />
    );
    expect(screen.getByText(heading)).toBeInTheDocument();
  });

  it('reports preserved links only when their count is established', () => {
    render(
      <OperationPreviewPanel
        isLoading={false}
        onRetry={vi.fn()}
        preview={previewFixture({
          operation: 'table.duplicate',
          effects: [
            {
              code: 'table.duplicate.link_references.classify',
              kind: 'dependency.change',
              measures: { externalLinksPreserved: { basis: 'exact', value: 2, unit: 'fields' } },
            },
          ],
        })}
      />
    );
    expect(screen.getByText('Keep links to the original tables in this space')).toBeInTheDocument();
    expect(screen.getByText(/Affected fields:/)).toHaveTextContent('2');
    expect(screen.queryByText(/externalLinksPreserved|link_references/)).not.toBeInTheDocument();
  });

  it('does not suggest a recovery period for permanent deletion', () => {
    render(
      <OperationPreviewPanel
        isLoading={false}
        onRetry={vi.fn()}
        preview={previewFixture({
          outcome: 'incomplete',
          coverage: { known: [], unknown: ['host.trash-retention', 'host.usage-effects'] },
          effects: [
            {
              code: 'table.delete.resource.permanently_deleted',
              kind: 'resource.permanent-delete',
              measures: {},
            },
          ],
        })}
      />
    );
    expect(
      screen.getByText('Permanently delete this table. It cannot be restored from Trash.')
    ).toBeInTheDocument();
    expect(screen.getByText('Storage impact is not checked.')).toBeInTheDocument();
    expect(screen.queryByText(/recovery period|host\./)).not.toBeInTheDocument();
  });

  it('omits processing estimates that do not describe actual changes', () => {
    render(
      <OperationPreviewPanel
        isLoading={false}
        onRetry={vi.fn()}
        preview={previewFixture({
          complexity: {
            policyVersion: 'v2-complexity-policy-2',
            level: 'low',
            score: 3,
            headline: 'INTERNAL headline',
            workload: {
              status: 'estimated',
              rows: { status: 'estimated', lower: 7, expected: 14, upper: 30 },
              typicalLevel: 'low',
              worstCaseLevel: 'medium',
              level: 'low',
              basis: 'max-scan-dirty',
              warnings: ['INTERNAL warning'],
            },
            breakdown: { shareBasis: 'path-work', modes: [], paths: [] },
            components: { structural: 1, dataWork: 1, risk: 0 },
            reasonCodes: ['INTERNAL reason'],
            recommendations: [],
            confidence: 'medium',
          },
        })}
      />
    );
    expect(
      screen.queryByText(/Estimated records to process|processing work|7–30/)
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText(/INTERNAL|v2-complexity-policy|score|max-scan-dirty/)
    ).not.toBeInTheDocument();
  });

  it('identifies the operation before relating each side effect to its owning table', () => {
    render(
      <OperationPreviewPanel
        isLoading={false}
        onRetry={vi.fn()}
        preview={previewFixture({
          effects: [
            { code: 'table.delete.resource.trashed', kind: 'resource.trash', measures: {} },
            {
              code: 'table.delete.inbound_link.converted_to_text',
              kind: 'field.conversion',
              resource: { visibility: 'authorized', kind: 'field', id: 'fldLink', name: 'Order' },
              relatedResources: [
                { visibility: 'authorized', kind: 'table', id: 'tblItems', name: 'Line items' },
              ],
              measures: { fields: { basis: 'exact', value: 1, unit: 'fields' } },
            },
          ],
        })}
      />
    );
    const effect = screen.getByText('Order').closest('li');
    expect(effect).toHaveTextContent('Convert linked fields to text');
    expect(effect).toHaveTextContent('In table: Line items');
    expect(effect).toHaveTextContent('links to the deleted table will be lost');
    const region = screen.getByRole('region', { name: 'What will change' });
    expect(region).toHaveAttribute('tabindex', '0');
    region.focus();
    expect(region).toHaveFocus();
  });

  it('groups hidden effects and shows one visibility note without repeating unknown counts', () => {
    const hiddenField = {
      visibility: 'redacted',
      kind: 'field',
      quantity: { basis: 'unknown', unit: 'fields', reason: 'private count' },
      reason: 'private access',
    } as const;
    const conversion = {
      code: 'table.delete.inbound_link.converted_to_text',
      kind: 'field.conversion',
      resource: hiddenField,
      measures: { fields: hiddenField.quantity },
    } as const;
    render(
      <OperationPreviewPanel
        isLoading={false}
        onRetry={vi.fn()}
        preview={previewFixture({
          effects: [
            conversion,
            conversion,
            {
              code: 'table.delete.dependent_field.marked_error',
              kind: 'dependency.change',
              resource: hiddenField,
              measures: { fields: hiddenField.quantity },
            },
          ],
        })}
      />
    );
    expect(
      screen.getAllByText('Convert linked fields to text; links to the deleted table will be lost')
    ).toHaveLength(1);
    expect(screen.getAllByText('Some affected resource details are unavailable.')).toHaveLength(1);
    expect(screen.getAllByText('Fields')).toHaveLength(2);
    expect(
      screen.queryByText(/Affected fields:|Determined when this runs|private/)
    ).not.toBeInTheDocument();
  });

  it('separates preserved links from changed self-links', () => {
    render(
      <OperationPreviewPanel
        isLoading={false}
        onRetry={vi.fn()}
        preview={previewFixture({
          operation: 'table.duplicate',
          effects: [
            {
              code: 'table.duplicate.link_references.classify',
              kind: 'dependency.change',
              measures: {
                selfLinksRemapped: { basis: 'exact', value: 1, unit: 'fields' },
                externalLinksPreserved: { basis: 'exact', value: 2, unit: 'fields' },
              },
            },
            { code: 'table.duplicate.records.omitted', kind: 'record.insert', measures: {} },
          ],
        })}
      />
    );
    expect(screen.getByText('Point self-links to the copied table')).toBeInTheDocument();
    expect(screen.getByText('Keep links to the original tables in this space')).toBeInTheDocument();
    expect(
      screen.getByText('Point self-links to the copied table').closest('li')
    ).not.toHaveTextContent('Keep links');
    expect(screen.queryByText(/selfLinksRemapped|link_references/)).not.toBeInTheDocument();
  });

  it('retains the aggregate count when the available field names are only a partial list', () => {
    render(
      <OperationPreviewPanel
        isLoading={false}
        onRetry={vi.fn()}
        preview={previewFixture({
          operation: 'field.delete',
          effects: [
            {
              code: 'field.delete.dependent_field_changed',
              kind: 'dependency.change',
              relatedResources: [
                { visibility: 'authorized', kind: 'field', id: 'fldTotal', name: 'Order total' },
                { visibility: 'authorized', kind: 'field', id: 'fldCount', name: 'Order count' },
              ],
              measures: { fields: { basis: 'exact', value: 100, unit: 'fields' } },
            },
          ],
          warnings: [{ code: 'preview.items_truncated' }],
        })}
      />
    );
    expect(screen.getByText('Order total, Order count')).toBeInTheDocument();
    expect(screen.getByText('Order total, Order count').closest('li')).toHaveTextContent(
      'Update dependent fields; final values are not specified'
    );
    expect(screen.getByText(/Affected fields:/)).toHaveTextContent('100');
    expect(
      screen.getByText('Only part of the affected-resource list is shown.')
    ).toBeInTheDocument();
  });

  it('keeps the target field alongside its other deletion consequences', () => {
    render(
      <OperationPreviewPanel
        isLoading={false}
        onRetry={vi.fn()}
        preview={previewFixture({
          operation: 'field.delete',
          effects: [
            {
              code: 'field.delete.target',
              kind: 'resource.permanent-delete',
              resource: {
                visibility: 'authorized',
                kind: 'field',
                id: 'fldTarget',
                name: 'Customer',
              },
              measures: {},
            },
            {
              code: 'field.delete.symmetric_link_removed',
              kind: 'dependency.change',
              relatedResources: [
                { visibility: 'authorized', kind: 'field', id: 'fldSymmetric', name: 'Orders' },
              ],
              measures: { fields: { basis: 'exact', value: 1, unit: 'fields' } },
            },
          ],
        })}
      />
    );
    expect(screen.getByText('Orders')).toBeInTheDocument();
    expect(screen.getByText('Delete the corresponding two-way link field')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Customer' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Customer' }).nextElementSibling).toHaveTextContent(
      'Delete this field and its values in all records'
    );
    expect(screen.getByText('Delete this field and its values in all records')).toBeInTheDocument();
  });

  it('uses an already-authorized target field name without treating target redaction as hidden dependencies', () => {
    render(
      <OperationPreviewPanel
        isLoading={false}
        onRetry={vi.fn()}
        targetFieldName="Customer"
        preview={previewFixture({
          operation: 'field.delete',
          effects: [
            {
              code: 'field.delete.target',
              kind: 'resource.permanent-delete',
              resource: {
                visibility: 'redacted',
                kind: 'field',
                reason: 'authorization-scope-unavailable',
                quantity: { basis: 'unknown', unit: 'fields', reason: 'private-cardinality' },
              },
              measures: {},
            },
          ],
          coverage: { known: [], unknown: ['resource authorization and identity visibility'] },
        })}
      />
    );
    expect(screen.getByRole('heading', { level: 3 })).toHaveTextContent('Customer');
    expect(screen.getByText('Delete this field and its values in all records')).toBeInTheDocument();
    expect(screen.getByText('Not fully checked: related-resource details.')).toBeInTheDocument();
    expect(
      screen.queryByText('Some affected resource details are unavailable.')
    ).not.toBeInTheDocument();
    expect(screen.queryByText(/private-cardinality|authorization-scope/)).not.toBeInTheDocument();
  });

  it('prefers authorized DTO target names over the invoking dialog fallback', () => {
    render(
      <OperationPreviewPanel
        isLoading={false}
        onRetry={vi.fn()}
        targetFieldName="Old name"
        preview={previewFixture({
          operation: 'field.delete',
          effects: [
            {
              code: 'field.delete.target',
              kind: 'resource.permanent-delete',
              measures: {},
              resource: {
                visibility: 'authorized',
                kind: 'field',
                id: 'fldTarget',
                name: 'Current name',
              },
            },
          ],
        })}
      />
    );
    expect(screen.getByText('Current name')).toBeInTheDocument();
    expect(screen.queryByText('Old name')).not.toBeInTheDocument();
  });

  it('does not reuse a target field fallback for another operation', () => {
    render(
      <OperationPreviewPanel
        isLoading={false}
        onRetry={vi.fn()}
        targetFieldName="Unrelated field"
        preview={previewFixture({
          effects: [
            { code: 'table.delete.resource.trashed', kind: 'resource.trash', measures: {} },
          ],
        })}
      />
    );
    expect(screen.queryByText('Unrelated field')).not.toBeInTheDocument();
  });

  it('does not infer hidden dependencies from table-delete coverage gaps or a redacted target', () => {
    render(
      <OperationPreviewPanel
        isLoading={false}
        onRetry={vi.fn()}
        preview={previewFixture({
          outcome: 'incomplete',
          effects: [
            {
              code: 'table.delete.resource.trashed',
              kind: 'resource.trash',
              measures: {},
              resource: {
                visibility: 'redacted',
                kind: 'table',
                reason: 'authorization-scope-unavailable',
                quantity: { basis: 'exact', value: 1, unit: 'tables' },
              },
            },
          ],
          coverage: {
            known: [],
            unknown: [
              'inbound-reference-metadata',
              'dependent-resource-authorization',
              'redacted-dependent-resource-cardinality',
              'host.trash-retention',
              'host.usage-effects',
            ],
          },
        })}
      />
    );
    expect(screen.getAllByText('Not fully checked: related-resource details.')).toHaveLength(1);
    expect(
      screen.getByText('The Trash retention period and storage impact are not checked.')
    ).toBeInTheDocument();
    expect(
      screen.getByRole('region', { name: 'What will change' }).querySelectorAll('li')
    ).toHaveLength(2);
    expect(
      screen.queryByText('The Trash retention period is not checked.')
    ).not.toBeInTheDocument();
    expect(screen.queryByText('Storage impact is not checked.')).not.toBeInTheDocument();
    expect(
      screen.queryByText('Some affected resource details are unavailable.')
    ).not.toBeInTheDocument();
    expect(screen.queryByText('Not fully checked: other effects.')).not.toBeInTheDocument();
    expect(screen.queryByText('What else changes')).not.toBeInTheDocument();
  });

  it.each([
    [
      'en',
      'Not fully checked: related-resource details, execution-time effects.',
      'The Trash retention period and storage impact are not checked.',
    ],
    ['zh', '尚未完整检查：关联资源详情、执行时的其他影响。', '回收站期限和存储影响未检查。'],
  ])(
    'combines relation, authorization and execution gaps into two coverage sentences: %s',
    (language, general, recovery) => {
      locale.language = language;
      render(
        <OperationPreviewPanel
          isLoading={false}
          onRetry={vi.fn()}
          preview={previewFixture({
            effects: [
              { code: 'table.delete.resource.trashed', kind: 'resource.trash', measures: {} },
            ],
            coverage: {
              known: [],
              unknown: [
                'inbound-reference-metadata',
                'dependent-resource-authorization',
                'field-operation execution plugins',
                'table-operation-policy',
                'host.billing.quota',
                'host.trash-retention',
                'host.usage-effects',
              ],
            },
          })}
        />
      );
      const disclosure = screen.getByText(
        language === 'zh'
          ? '部分影响尚未确认 · 查看范围'
          : 'Some impacts are unconfirmed · View scope'
      );
      expect(disclosure).toBeVisible();
      expect(disclosure.closest('details')).not.toHaveAttribute('open');
      expect(screen.getByText(general)).not.toBeVisible();
      disclosure.focus();
      expect(disclosure).toHaveFocus();
      fireEvent.click(disclosure);
      expect(disclosure.closest('details')).toHaveAttribute('open');
      expect(screen.getByText(general)).toBeVisible();
      expect(screen.getByText(recovery)).toBeVisible();
      expect(screen.getAllByRole('listitem')).toHaveLength(2);
    }
  );

  it('leaves redaction and specific warnings visible when preview coverage is collapsed', () => {
    render(
      <OperationPreviewPanel
        isLoading={false}
        onRetry={vi.fn()}
        preview={previewFixture({
          effects: [
            {
              code: 'table.delete.inbound_link.converted_to_text',
              kind: 'field.conversion',
              resource: {
                visibility: 'redacted',
                kind: 'field',
                reason: 'permission',
                quantity: { basis: 'unknown', unit: 'field', reason: 'private-count' },
              },
              measures: { fields: { basis: 'unknown', unit: 'field', reason: 'private-count' } },
            },
          ],
          warnings: [{ code: 'table.delete.effects_truncated' }],
          coverage: { known: [], unknown: ['host.trash-retention', 'host.usage-effects'] },
        })}
      />
    );
    const warning = screen.getByText('Only part of the affected-resource list is shown.');
    const redaction = screen.getByText('Some affected resource details are unavailable.');
    expect(warning).toBeVisible();
    expect(redaction).toBeVisible();
    expect(warning.closest('details')).toBeNull();
    expect(redaction.closest('details')).toBeNull();
    expect(
      screen.getByText('Some impacts are unconfirmed · View scope').closest('details')
    ).not.toHaveAttribute('open');
    expect(
      screen.getByText('The Trash retention period and storage impact are not checked.')
    ).not.toBeVisible();
  });

  it('keeps an explicit redacted dependency signal distinct from unknown metadata', () => {
    render(
      <OperationPreviewPanel
        isLoading={false}
        onRetry={vi.fn()}
        preview={previewFixture({
          effects: [
            { code: 'table.delete.resource.trashed', kind: 'resource.trash', measures: {} },
            {
              code: 'table.delete.dependent_resources.redacted',
              kind: 'dependency.change',
              measures: {},
              resource: {
                visibility: 'redacted',
                kind: 'field',
                reason: 'permission',
                quantity: { basis: 'unknown', unit: 'fields', reason: 'private-count' },
              },
            },
          ],
        })}
      />
    );
    expect(screen.getByText('Some affected resource details are unavailable.')).toBeInTheDocument();
    expect(screen.queryByText(/Not fully checked:/)).not.toBeInTheDocument();
  });

  it('does not label missing foreign metadata as permission-hidden dependencies or repeat its coverage note', () => {
    render(
      <OperationPreviewPanel
        isLoading={false}
        onRetry={vi.fn()}
        preview={previewFixture({
          operation: 'field.delete',
          warnings: [
            {
              code: 'field.delete.foreign_metadata_missing',
              resource: {
                visibility: 'redacted',
                kind: 'table',
                reason: 'foreign-table-not-loaded',
                quantity: { basis: 'unknown', unit: 'tables', reason: 'not-loaded' },
              },
            },
          ],
          coverage: {
            known: [],
            unknown: ['cross-table effects for missing foreign table metadata'],
          },
        })}
      />
    );
    expect(screen.getAllByText('Some cross-table impacts could not be checked.')).toHaveLength(1);
    expect(
      screen.queryByText('Some affected resource details are unavailable.')
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText('Not fully checked: related-resource details.')
    ).not.toBeInTheDocument();
  });

  it('reports view-setting updates and view counts without inventing filter, sort or group removal', () => {
    render(
      <OperationPreviewPanel
        isLoading={false}
        onRetry={vi.fn()}
        preview={previewFixture({
          operation: 'field.delete',
          effects: [
            {
              code: 'field.delete.view_changed',
              kind: 'dependency.change',
              relatedResources: [
                { visibility: 'authorized', kind: 'view', id: 'viwOrders', name: 'All orders' },
              ],
              measures: { views: { basis: 'exact', value: 4, unit: 'view' } },
            },
          ],
        })}
      />
    );
    const row = screen.getByText('All orders').closest('li');
    expect(row).toHaveTextContent('Update view settings after deleting the field');
    expect(row).toHaveTextContent('Affected views: 4');
    expect(row).not.toHaveTextContent(/Affected fields|filter|sort|group|Remove reference/);
  });

  it('shows unavailable view counts as unknown rather than omitting their quantity', () => {
    render(
      <OperationPreviewPanel
        isLoading={false}
        onRetry={vi.fn()}
        preview={previewFixture({
          operation: 'field.delete',
          effects: [
            {
              code: 'field.delete.view_changed',
              kind: 'dependency.change',
              measures: { views: { basis: 'unknown', unit: 'view', reason: 'unavailable' } },
            },
          ],
        })}
      />
    );
    expect(screen.getByText(/Affected views:/)).toHaveTextContent('Count unavailable');
    expect(screen.queryByText(/Affected fields:/)).not.toBeInTheDocument();
  });

  it('identifies redacted view effects without claiming permission denial', () => {
    render(
      <OperationPreviewPanel
        isLoading={false}
        onRetry={vi.fn()}
        preview={previewFixture({
          operation: 'field.delete',
          effects: [
            {
              code: 'field.delete.view_changed',
              kind: 'dependency.change',
              relatedResources: [
                {
                  visibility: 'redacted',
                  kind: 'view',
                  reason: 'authorization-scope-unavailable',
                  quantity: {
                    basis: 'unknown',
                    unit: 'view',
                    reason: 'one-or-more-resources-redacted',
                  },
                },
              ],
              measures: {
                views: { basis: 'unknown', unit: 'view', reason: 'one-or-more-resources-redacted' },
              },
            },
          ],
        })}
      />
    );
    expect(screen.getByText('Views').closest('li')).toHaveTextContent(
      'Update view settings after deleting the field'
    );
    expect(screen.getByText('Some affected resource details are unavailable.')).toBeVisible();
    expect(
      screen.queryByText(/permission|access denied|authorization-scope/i)
    ).not.toBeInTheDocument();
  });

  it('identifies records as the unavailable copy count and omits the redundant single-table count', () => {
    render(
      <OperationPreviewPanel
        isLoading={false}
        onRetry={vi.fn()}
        preview={previewFixture({
          operation: 'table.duplicate',
          outcome: 'incomplete',
          effects: [
            {
              code: 'table.duplicate.structure.copy',
              kind: 'resource.copy',
              measures: {
                tables: { basis: 'exact', value: 1, unit: 'tables' },
                fields: { basis: 'exact', value: 3, unit: 'fields' },
                views: { basis: 'exact', value: 1, unit: 'views' },
              },
            },
            {
              code: 'table.duplicate.records.copy',
              kind: 'record.insert',
              measures: { records: { basis: 'unknown', unit: 'records', reason: 'not-counted' } },
            },
          ],
          coverage: { known: [], unknown: ['source-record-count'] },
        })}
      />
    );
    expect(screen.getByText('Records').parentElement).toHaveTextContent('Count unavailable');
    expect(screen.getByText('Fields').parentElement).toHaveTextContent('3');
    expect(screen.getByText('Views').parentElement).toHaveTextContent('1');
    expect(screen.queryByText('Tables')).not.toBeInTheDocument();
    expect(screen.queryByText('Not fully checked: record count.')).not.toBeInTheDocument();
    expect(screen.queryByText('Not fully checked: other effects.')).not.toBeInTheDocument();
    expect(screen.queryByText(/copy still includes|Some copy counts/)).not.toBeInTheDocument();
  });

  it('retains a non-coverage signal for an unrecognized coverage key without exposing diagnostics', () => {
    render(
      <OperationPreviewPanel
        isLoading={false}
        onRetry={vi.fn()}
        preview={previewFixture({
          coverage: { known: [], unknown: ['private.new-planner-check'] },
        })}
      />
    );
    expect(screen.getByText('Not fully checked: other effects.')).toBeInTheDocument();
    expect(
      screen.queryByText(/private\.new-planner-check|no impact|no dependencies/i)
    ).not.toBeInTheDocument();
  });

  it('keeps loading separate from any previous summary or error', () => {
    render(
      <OperationPreviewPanel
        isLoading
        error={new Error('private failure')}
        onRetry={vi.fn()}
        preview={previewFixture()}
      />
    );
    expect(screen.getByRole('status')).toHaveTextContent('Loading details…');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.queryByText(/Details of this change/)).not.toBeInTheDocument();
  });

  it('rejects malformed or mismatched preview responses instead of enabling confirmation', async () => {
    post.mockResolvedValueOnce(response(previewFixture({ operation: 'base.duplicate' })));
    render(<PendingOperation request={{ operation: 'table.delete', input: {} }} />, {
      wrapper: wrapper(),
    });
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Confirm' })).toBeDisabled();
  });
});
