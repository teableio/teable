import { vi } from 'vitest';
import { render, screen, userEvent } from '@/test-utils';
import { RecordMenu } from './RecordMenu';

const mocks = vi.hoisted(() => ({
  recordMenu: null as unknown,
  closeRecordMenu: vi.fn(),
}));

vi.mock('@teable/sdk/components', () => ({
  useGridViewStore: () => ({
    recordMenu: mocks.recordMenu,
    closeRecordMenu: mocks.closeRecordMenu,
  }),
}));

vi.mock('@teable/sdk/hooks', () => ({
  useBaseId: () => 'bseTest',
  useTableId: () => 'tblTest',
  useView: () => ({ id: 'viwTest' }),
  useTablePermission: () => ({ 'record|read': true, 'record|delete': true }),
  useCommentPermission: () => ({ commentReadable: false, commentWritable: false }),
}));

vi.mock('@/features/app/hooks/useAI', () => ({ useAI: () => ({ enable: false }) }));
vi.mock('@/features/app/hooks/useBaseUsage', () => ({ useBaseUsage: () => undefined }));
vi.mock('@/features/app/hooks/useArchiveUpsell', () => ({
  useArchiveUpsell: () => ({
    archiveUnlocked: false,
    badge: null,
    needsUpgrade: false,
    handleUpgradeClick: vi.fn(),
  }),
}));

describe('RecordMenu', () => {
  beforeEach(() => {
    mocks.closeRecordMenu.mockReset();
  });

  it('offers Copy for a multi-cell selection and runs it', async () => {
    const copySelection = vi.fn().mockResolvedValue(undefined);
    mocks.recordMenu = {
      position: { x: 0, y: 0 },
      isMultipleSelected: true,
      copySelection,
      deleteRecords: vi.fn(),
    };

    render(<RecordMenu />);

    expect(screen.getByText('table:menu.deleteAllSelectedRecords')).toBeInTheDocument();
    await userEvent.click(screen.getByText('table:menu.copy'));
    expect(copySelection).toHaveBeenCalledTimes(1);
    expect(mocks.closeRecordMenu).toHaveBeenCalled();
  });

  it('hides Copy when the caller cannot copy', () => {
    mocks.recordMenu = {
      position: { x: 0, y: 0 },
      isMultipleSelected: true,
      deleteRecords: vi.fn(),
    };

    render(<RecordMenu />);

    expect(screen.getByText('table:menu.deleteAllSelectedRecords')).toBeInTheDocument();
    expect(screen.queryByText('table:menu.copy')).not.toBeInTheDocument();
  });
});
