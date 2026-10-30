import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { IGetBaseVo } from '@teable/openapi';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { PublishBaseDialog } from './PublishBaseDialog';

vi.mock('next-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('canvas-confetti', () => ({ default: vi.fn() }));
vi.mock('@teable/openapi', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  // A base that has never been published has no template yet.
  getTemplateByBaseId: vi.fn().mockResolvedValue({ data: null }),
  getBaseNodeTree: vi.fn().mockResolvedValue({ data: { nodes: [], maxFolderDepth: 2 } }),
}));
vi.mock('@teable/sdk/components', () => ({
  AttachmentManager: class {
    upload(
      _files: unknown,
      _type: unknown,
      callbacks: { successCallback: (file: unknown, result: object) => void }
    ) {
      callbacks.successCallback(undefined, { presignedUrl: 'blob:uploaded-cover', token: 'tok' });
    }
  },
}));
vi.mock('@/features/app/hooks/useIsCloud', () => ({ useIsCloud: () => false }));
vi.mock('@/features/app/hooks/useOrigin', () => ({ useOrigin: () => '' }));
vi.mock('@/features/app/hooks/useShortLink', () => ({
  useShortLink: () => ({ shortUrl: undefined, isFallback: false }),
}));
vi.mock('../../../base/base-node/hooks', () => ({
  ROOT_ID: 'root',
  buildTreeItems: () => ({}),
  filterAutoHiddenFolders: (nodes: unknown) => nodes,
}));
vi.mock('./AppPublishContext', () => ({ useAppPublishContext: () => ({ publishApp: vi.fn() }) }));
vi.mock('./NodeSelect', () => ({ NodeSelect: () => null }));
vi.mock('./NodeTreeSelect', () => ({ NodeTreeSelect: () => null }));
vi.mock('./TemplateSubmissionState', () => ({
  TemplateChangelogField: () => null,
  TemplateReviewPanel: () => null,
}));
vi.mock('./UnpublishedAppsDialog', () => ({
  UnpublishedAppsDialog: () => null,
  getUnpublishedAppNodes: () => [],
}));

const testBase = { id: 'bseTest', name: 'Test base' } as IGetBaseVo;

// Controlled usage, as in the base dropdown, where the dialog stays mounted between openings.
const Harness = () => {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button onClick={() => setOpen(true)}>open publish</button>
      <PublishBaseDialog base={testBase} open={open} onOpenChange={setOpen} onClose={vi.fn()} />
    </>
  );
};

const coverPreview = () => screen.queryByAltText('published project preview');

describe('PublishBaseDialog cover', () => {
  it('drops an unpublished cover preview when the dialog is closed and reopened T7195', async () => {
    render(
      <QueryClientProvider client={new QueryClient()}>
        <Harness />
      </QueryClientProvider>
    );

    fireEvent.click(screen.getByText('open publish'));
    const input = await waitFor(() => {
      const el = document.querySelector<HTMLInputElement>('input[type="file"]');
      expect(el).toBeTruthy();
      return el!;
    });
    fireEvent.change(input, {
      target: { files: [new File(['x'], 'cover.png', { type: 'image/png' })] },
    });
    expect(coverPreview()?.getAttribute('src')).toBe('blob:uploaded-cover');

    // Close without publishing: the upload is discarded, so its preview must go too,
    // otherwise the next publish shows a cover but submits none.
    act(() => {
      fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' });
    });
    await waitFor(() => expect(screen.queryByText('publishBase.title')).toBeNull());

    fireEvent.click(screen.getByText('open publish'));
    await screen.findByText('publishBase.title');
    expect(coverPreview()).toBeNull();
  });
});
