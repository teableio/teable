import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BaseNodeResourceType, type IGetBaseVo } from '@teable/openapi';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  TemplateHostContext,
  type ITemplateSubmitTerms,
} from '@/features/app/components/space/template/host-context';
import { ROOT_ID } from '../../../base/base-node/hooks';
import { PublishBaseDialog } from './PublishBaseDialog';

const { state, getTemplateByBaseId, toastError } = vi.hoisted(() => ({
  state: { treeItems: {} as Record<string, unknown> },
  getTemplateByBaseId: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock('@teable/openapi', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getTemplateByBaseId,
  getBaseNodeTree: vi.fn(async () => ({ data: { nodes: [], maxFolderDepth: 2 } })),
}));
vi.mock('../../../base/base-node/hooks', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  buildTreeItems: () => state.treeItems,
  filterAutoHiddenFolders: (nodes: unknown) => nodes,
}));
vi.mock('@teable/ui-lib/shadcn/ui/sonner', () => ({
  toast: { error: toastError, success: vi.fn() },
}));
vi.mock('@teable/sdk/components', () => ({ AttachmentManager: class {} }));
vi.mock('next-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('canvas-confetti', () => ({ default: vi.fn() }));
vi.mock('@/features/app/components/emoji/Emoji', () => ({ Emoji: () => null }));
vi.mock('@/features/app/hooks/useIsCloud', () => ({ useIsCloud: () => true }));
vi.mock('@/features/app/hooks/useOrigin', () => ({ useOrigin: () => 'http://localhost' }));
vi.mock('@/features/app/hooks/useShortLink', () => ({
  useShortLink: () => ({ shortUrl: undefined, isFallback: false }),
}));
vi.mock('./NodeSelect', () => ({ NodeSelect: () => null }));
vi.mock('./TemplateSubmissionState', () => ({
  TemplateChangelogField: () => null,
  TemplateReviewPanel: () => null,
}));

const table = {
  id: 'tableA',
  resourceType: BaseNodeResourceType.Table,
  resourceId: 'tableA',
  resourceMeta: { name: 'Node tableA' },
  order: 0,
  parentId: ROOT_ID,
  children: [],
};

const renderSubmission = (useTerms?: () => ITemplateSubmitTerms) => {
  const submission = {
    submit: vi.fn(async () => ({ templateId: 'tplTest', review: null as never })),
    withdraw: vi.fn(),
    useTerms,
  };
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <TemplateHostContext.Provider value={{ submission }}>
        <PublishBaseDialog base={{ id: 'bseTest', name: 'Base' } as IGetBaseVo} onClose={vi.fn()}>
          <button type="button">open-publish</button>
        </PublishBaseDialog>
      </TemplateHostContext.Provider>
    </QueryClientProvider>
  );
  return submission;
};

describe('PublishBaseDialog submission', () => {
  beforeEach(() => {
    toastError.mockReset();
    state.treeItems = {
      [ROOT_ID]: {
        ...table,
        id: ROOT_ID,
        resourceType: BaseNodeResourceType.Folder,
        children: ['tableA'],
      },
      tableA: table,
    };
  });

  it('asks for a cover before sending a template for review: links preview it', async () => {
    getTemplateByBaseId.mockResolvedValue({
      data: {
        id: 'tplTest',
        name: 'Lotus Yoga',
        description: 'Class booking for yoga studios.',
        isPublished: false,
        version: 1,
        review: null,
        publishInfo: { nodes: ['tableA'], includeData: true },
      },
    });
    const submission = renderSubmission();
    fireEvent.click(screen.getByText('open-publish'));
    // the form fills in from the template once it has loaded
    await waitFor(() =>
      expect(screen.getByTitle('Class booking for yoga studios.')).toBeInTheDocument()
    );

    await act(async () => {
      fireEvent.click(screen.getByText('publishBase.submit'));
    });

    expect(toastError).toHaveBeenCalledWith('publishBase.tips.coverRequired');
    expect(submission.submit).not.toHaveBeenCalled();
  });

  const listed = {
    id: 'tplTest',
    name: 'Lotus Yoga',
    description: 'Class booking for yoga studios.',
    isPublished: false,
    version: 1,
    review: null,
    cover: { presignedUrl: 'https://cdn.example/cover.png' },
    publishInfo: { nodes: ['tableA'], includeData: true },
  };

  it("waits for the host's terms before publishing, drawn by the publish button", async () => {
    getTemplateByBaseId.mockResolvedValue({ data: listed });
    renderSubmission(() => ({ panel: <span>terms-panel</span>, blocked: true, agreed: false }));
    fireEvent.click(screen.getByText('open-publish'));
    await waitFor(() =>
      expect(screen.getByTitle('Class booking for yoga studios.')).toBeInTheDocument()
    );

    expect(screen.getByText('terms-panel')).toBeInTheDocument();
    expect(screen.getByText('publishBase.submit').closest('button')).toBeDisabled();
  });

  it('sends the agreement with the submission', async () => {
    getTemplateByBaseId.mockResolvedValue({ data: listed });
    const submission = renderSubmission(() => ({ panel: null, blocked: false, agreed: true }));
    fireEvent.click(screen.getByText('open-publish'));
    await waitFor(() =>
      expect(screen.getByTitle('Class booking for yoga studios.')).toBeInTheDocument()
    );

    await act(async () => {
      fireEvent.click(screen.getByText('publishBase.submit'));
    });

    expect(submission.submit).toHaveBeenCalledWith(
      'bseTest',
      expect.objectContaining({ agreeTerms: true })
    );
  });
});
