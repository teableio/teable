import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type * as OpenApi from '@teable/openapi';
import type {
  IOperationPreviewDto,
  IOperationPreviewOkResponseDto,
} from '@teable/v2-contract-http/operationPreview';
import { cleanup, render, screen } from '@testing-library/react';
import type { PropsWithChildren, ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FolderDeleteConfirmDialog } from './FolderDeleteConfirmDialog';

const { post } = vi.hoisted(() => ({ post: vi.fn() }));
vi.mock('@teable/openapi', async (importOriginal) => ({
  ...(await importOriginal<typeof OpenApi>()),
  getAxios: () => ({ post }),
}));
vi.mock('@teable/sdk/hooks', () => ({ useBaseId: () => 'bseSource' }));
const publicFile = vi.hoisted(() => ({ enabled: false }));
vi.mock('../../hooks/usePublicFileEnabled', () => ({
  usePublicFileEnabled: () => publicFile.enabled,
}));
vi.mock('next-i18next', async () => {
  // Vitest hoists this factory before static imports; load the real translations inside it.
  const { createInstance } = await import('i18next');
  const en = await import('@teable/common-i18n/src/locales/en/common.json');
  const i18n = createInstance();
  await i18n.init({ lng: 'en', defaultNS: 'common', resources: { en: { common: en.default } } });
  return { useTranslation: () => ({ t: i18n.getFixedT('en'), i18n }) };
});
vi.mock('@teable/ui-lib/base', () => ({
  ConfirmDialog: ({
    content,
    confirmText,
    confirmDisabled,
  }: {
    content: ReactNode;
    confirmText: string;
    confirmDisabled?: boolean;
  }) => (
    <div>
      {content}
      <button disabled={confirmDisabled}>{confirmText}</button>
    </div>
  ),
}));

const app = { visibility: 'authorized', kind: 'app', id: 'appPortal', name: 'Portal' } as const;
const folder = { visibility: 'authorized', kind: 'host', id: 'bnoApps', name: 'Apps' } as const;

const generatingFolder: IOperationPreviewDto = {
  operation: 'folder.delete',
  outcome: 'ready',
  effects: [
    { code: 'folder.delete.item.folder', kind: 'resource.trash', resource: folder, measures: {} },
    { code: 'folder.delete.item.app', kind: 'resource.trash', resource: app, measures: {} },
    { code: 'folder.delete.app.generating', kind: 'host.effect', resource: app, measures: {} },
  ],
  blockers: [],
  warnings: [],
  coverage: { known: [], unknown: [] },
  complexity: null,
  authorization: 'checked',
  observedAt: '2026-11-17T00:00:00.000Z',
  consistency: 'best-effort',
  requestDigest: `sha256:${'a'.repeat(64)}`,
  implementation: { plannerVersion: 'test-1', executionPath: 'BaseNodeService.delete' },
};

const answered = (preview: IOperationPreviewDto) => ({
  data: { ok: true, data: preview } satisfies IOperationPreviewOkResponseDto,
});
const newClient = () =>
  new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 60_000 } } });

const renderDialog = (client: QueryClient) =>
  render(
    <FolderDeleteConfirmDialog
      open
      nodeId="bnoApps"
      folderName="Apps"
      onOpenChange={vi.fn()}
      onConfirm={vi.fn()}
    />,
    {
      wrapper: ({ children }: PropsWithChildren) => (
        <QueryClientProvider client={client}>{children}</QueryClientProvider>
      ),
    }
  );

afterEach(() => {
  cleanup();
  vi.resetAllMocks();
  publicFile.enabled = false;
});

describe('FolderDeleteConfirmDialog', () => {
  it('says public links go off where the deployment serves public files', async () => {
    const offLine =
      'Attachment fields with public links lose them right away. After a restore, they have to be turned on again.';
    post.mockResolvedValue(answered(generatingFolder));
    const first = renderDialog(newClient());
    await screen.findByRole('button', { name: 'Close sandbox and delete' });
    expect(screen.queryByText(offLine)).toBeNull();
    first.unmount();

    publicFile.enabled = true;
    renderDialog(newClient());
    expect(await screen.findByText(offLine)).toBeInTheDocument();
  });

  it('names its button from this check, not from the answer of an earlier opening', async () => {
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: 60_000 } },
    });
    post.mockResolvedValueOnce({
      data: { ok: true, data: generatingFolder } satisfies IOperationPreviewOkResponseDto,
    });
    const first = renderDialog(client);
    expect(await screen.findByRole('button', { name: 'Close sandbox and delete' })).toBeEnabled();
    first.unmount();

    post.mockReturnValueOnce(new Promise(() => undefined));
    renderDialog(client);

    expect(await screen.findByText('Loading details…')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Move to trash' })).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Close sandbox and delete' })).toBeNull();
  });

  it('does not keep the answer of an earlier opening when checking again fails', async () => {
    const client = newClient();
    post.mockResolvedValueOnce(answered(generatingFolder));
    const first = renderDialog(client);
    expect(await screen.findByRole('button', { name: 'Close sandbox and delete' })).toBeEnabled();
    first.unmount();

    post.mockRejectedValueOnce(new Error('preview failed'));
    renderDialog(client);

    expect(await screen.findByRole('button', { name: 'Retry' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Move to trash' })).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Close sandbox and delete' })).toBeNull();
  });

  it('does not name the button for closing a sandbox when the delete is blocked', async () => {
    post.mockResolvedValueOnce(
      answered({
        ...generatingFolder,
        outcome: 'blocked',
        blockers: [
          {
            code: 'folder.delete.permission_denied',
            message: 'You cannot delete this item.',
            resource: { visibility: 'authorized', kind: 'table', id: 'tblLocked', name: 'Locked' },
          },
        ],
      })
    );
    renderDialog(newClient());

    expect(await screen.findByText('Locked')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Move to trash' })).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Close sandbox and delete' })).toBeNull();
  });
});
