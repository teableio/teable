import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { HttpError, HttpErrorCode } from '@teable/core';
import type { IImportBasePreviewVo, INotifyVo } from '@teable/openapi';
import { BaseNodeResourceType, importBaseStream, previewImportBase } from '@teable/openapi';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { UploadPanelDialog } from './UploadPanelDialog';

vi.mock('next-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { count?: number }) =>
      options?.count === undefined ? key : `${key}:${options.count}`,
  }),
}));
vi.mock('next/router', () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock('@teable/openapi', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  previewImportBase: vi.fn(),
  importBaseStream: vi.fn(),
}));
vi.mock('../../../../hooks/useUpgradeCtaEnabled', () => ({ useUpgradeCtaEnabled: () => true }));

const notify = { path: 'import/demo.tea' } as INotifyVo;

// Stands in for the real upload: one click selects a file and finishes its upload.
vi.mock('./UploadPanel', () => ({
  UploadPanel: (props: {
    onChange: (file: File) => void;
    onFinished: (result: INotifyVo) => void;
  }) => (
    <button
      type="button"
      onClick={() => {
        props.onChange(new File(['tea'], 'demo.tea'));
        props.onFinished(notify);
      }}
    >
      upload
    </button>
  ),
}));

const preview: IImportBasePreviewVo = {
  name: 'Sales CRM',
  groups: [
    { type: BaseNodeResourceType.Folder, count: 1 },
    { type: BaseNodeResourceType.Table, count: 2 },
    { type: BaseNodeResourceType.App, count: 1 },
  ],
  nodes: [
    { id: 'bnoCustomers', parentId: null, type: BaseNodeResourceType.Table, name: 'Customers' },
    { id: 'bnoArchive', parentId: null, type: BaseNodeResourceType.Folder, name: 'Archive' },
    { id: 'bnoOrders', parentId: 'bnoArchive', type: BaseNodeResourceType.Table, name: 'Orders' },
    { id: 'bnoPortal', parentId: 'bnoArchive', type: BaseNodeResourceType.App, name: 'Portal' },
  ],
};

const treeNames = () =>
  Array.from(screen.getByTestId('import-preview-tree').querySelectorAll('li')).map(
    (row) => row.querySelector('span[title]')?.textContent
  );

const renderDialog = () =>
  render(
    <QueryClientProvider client={new QueryClient()}>
      <UploadPanelDialog spaceId="spcTest" open onOpenChange={vi.fn()} />
    </QueryClientProvider>
  );

const confirmButton = () => screen.getByRole('button', { name: 'space:import.confirm' });

describe('UploadPanelDialog import preview', () => {
  beforeEach(() => {
    vi.mocked(previewImportBase).mockReset();
    vi.mocked(importBaseStream).mockReset();
  });

  it('shows the node counts of the uploaded file above the confirm button', async () => {
    vi.mocked(previewImportBase).mockResolvedValue({ data: preview } as never);
    renderDialog();

    expect(screen.queryByText('space:import.preview.analyzing')).toBeNull();
    fireEvent.click(screen.getByText('upload'));

    expect(await screen.findByText('Sales CRM')).toBeTruthy();
    expect(previewImportBase).toHaveBeenCalledWith(
      { spaceId: 'spcTest', notify },
      expect.anything()
    );
    // Folders are shown in the tree only: not counted, not part of the total.
    expect(screen.getByText(/space:import\.preview\.total:3/)).toBeTruthy();
    expect(screen.getByTestId('import-preview-table').textContent).toBe('2');
    expect(screen.getByTestId('import-preview-table').title).toBe('common:noun.table');
    expect(screen.getByTestId('import-preview-app').textContent).toBe('1');
    expect(screen.queryByTestId('import-preview-folder')).toBeNull();
    expect(confirmButton()).toHaveProperty('disabled', false);
  });

  it('shows the nodes in their folders, which start closed and open on click', async () => {
    vi.mocked(previewImportBase).mockResolvedValue({ data: preview } as never);
    renderDialog();
    fireEvent.click(screen.getByText('upload'));

    await screen.findByText('Sales CRM');
    expect(treeNames()).toEqual(['Customers', 'Archive']);

    fireEvent.click(screen.getByRole('button', { name: /Archive/ }));
    expect(treeNames()).toEqual(['Customers', 'Archive', 'Orders', 'Portal']);

    fireEvent.click(screen.getByRole('button', { name: /Archive/ }));
    expect(treeNames()).toEqual(['Customers', 'Archive']);
  });

  it('replaces the file tile with the contents and still lets the file be removed', async () => {
    vi.mocked(previewImportBase).mockResolvedValue({ data: preview } as never);
    renderDialog();
    fireEvent.click(screen.getByText('upload'));

    await screen.findByText('Sales CRM');
    expect(screen.getByText('3 B')).toBeTruthy();
    expect(screen.getByText('upload').parentElement?.className).toContain('hidden');

    fireEvent.click(screen.getByRole('button', { name: 'common:actions.delete' }));
    expect(screen.queryByText('Sales CRM')).toBeNull();
    expect(screen.queryByRole('button', { name: 'space:import.confirm' })).toBeNull();
    expect(screen.getByText('upload').parentElement?.className).not.toContain('hidden');
  });

  it('keeps the import available while the preview is still loading', async () => {
    vi.mocked(previewImportBase).mockReturnValue(new Promise(() => undefined));
    renderDialog();
    fireEvent.click(screen.getByText('upload'));

    expect(await screen.findByText('space:import.preview.analyzing')).toBeTruthy();
    expect(confirmButton()).toHaveProperty('disabled', false);
  });

  it('keeps the import available when the preview itself fails', async () => {
    vi.mocked(previewImportBase).mockRejectedValue(
      new HttpError({ message: 'boom', code: HttpErrorCode.INTERNAL_SERVER_ERROR }, 500)
    );
    vi.mocked(importBaseStream).mockReturnValue(new Promise(() => undefined));
    renderDialog();
    fireEvent.click(screen.getByText('upload'));

    expect(await screen.findByText('space:import.preview.failed')).toBeTruthy();
    expect(confirmButton()).toHaveProperty('disabled', false);

    fireEvent.click(confirmButton());
    await waitFor(() =>
      expect(importBaseStream).toHaveBeenCalledWith(
        { spaceId: 'spcTest', notify },
        expect.any(Function),
        expect.any(Function)
      )
    );
  });

  it('blocks the import only for a file the import would reject', async () => {
    vi.mocked(previewImportBase).mockRejectedValue(
      new HttpError(
        {
          message: 'Invalid .tea file: structure.json not found in dottea file',
          code: HttpErrorCode.VALIDATION_ERROR,
        },
        400
      )
    );
    renderDialog();
    fireEvent.click(screen.getByText('upload'));

    expect(await screen.findByText('space:import.preview.invalid')).toBeTruthy();
    expect(
      screen.getByText('Invalid .tea file: structure.json not found in dottea file')
    ).toBeTruthy();
    expect(confirmButton()).toHaveProperty('disabled', true);
  });
});
