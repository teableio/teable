import {
  TablePermissionContext,
  TablePermissionContextDefaultValue,
} from '@teable/sdk/context/table-permission/TablePermissionContext';
import type * as TablePermissionHook from '@teable/sdk/hooks/use-table-permission';
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

vi.mock('@teable/sdk/hooks', async () => ({
  useBaseId: () => 'bseTest',
  useTableId: () => 'tblTest',
  useView: () => ({ id: 'viwTest' }),
  useTablePermission: (
    await vi.importActual<typeof TablePermissionHook>('@teable/sdk/hooks/use-table-permission')
  ).useTablePermission,
  useCommentPermission: () => ({ commentReadable: false, commentWritable: false }),
}));

vi.mock('next-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
  Trans: ({ i18nKey }: { i18nKey: string }) => i18nKey,
}));

vi.mock('@/features/app/hooks/useAI', () => ({ useAI: () => ({ enable: false }) }));
vi.mock('@/features/app/hooks/useBaseUsage', () => ({ useBaseUsage: () => undefined }));
vi.mock('@/features/app/hooks/useArchiveUpsell', () => ({
  useArchiveUpsell: () => ({
    archiveUnlocked: true,
    badge: null,
    needsUpgrade: false,
    handleUpgradeClick: vi.fn(),
  }),
}));

describe('RecordMenu', () => {
  beforeEach(() => {
    mocks.closeRecordMenu.mockReset();
  });

  const renderMenu = (managed = false) =>
    render(
      <TablePermissionContext.Provider
        value={{
          ...TablePermissionContextDefaultValue,
          record: {
            ...TablePermissionContextDefaultValue.record,
            'record|read': true,
            'record|update': true,
            'record|create': !managed,
            'record|delete': !managed,
            'record|archive': !managed,
            'record|copy': true,
            'record|comment': false,
          },
        }}
      >
        <RecordMenu />
      </TablePermissionContext.Provider>
    );

  it('offers Copy for a multi-cell selection and runs it', async () => {
    const copySelection = vi.fn().mockResolvedValue(undefined);
    mocks.recordMenu = {
      position: { x: 0, y: 0 },
      isMultipleSelected: true,
      copySelection,
      deleteRecords: vi.fn(),
    };

    renderMenu();

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

    renderMenu();

    expect(screen.getByText('table:menu.deleteAllSelectedRecords')).toBeInTheDocument();
    expect(screen.queryByText('table:menu.copy')).not.toBeInTheDocument();
  });

  it.each([false, true])(
    'blocks profile row mutations but preserves Copy (multiple rows: %s)',
    async (isMultipleSelected) => {
      const copySelection = vi.fn().mockResolvedValue(undefined);
      const insertRecord = vi.fn();
      const duplicateRecord = vi.fn();
      const deleteRecords = vi.fn();
      const archiveRecords = vi.fn();
      mocks.recordMenu = {
        position: { x: 0, y: 0 },
        record: { id: 'recProfile', undeletable: false },
        isMultipleSelected,
        copySelection,
        insertRecord,
        duplicateRecord,
        deleteRecords,
        archiveRecords,
      };

      renderMenu(true);

      for (const action of [
        'table:menu.insertRecordAbove',
        'table:menu.insertRecordBelow',
        'sdk:expandRecord.duplicateRecord',
        'table:menu.duplicateRecords',
        'table:menu.deleteRecord',
        'table:menu.deleteAllSelectedRecords',
        'table:menu.archiveRecord',
        'table:menu.archiveAllSelectedRecords',
      ]) {
        expect(
          document.querySelector(`[cmdk-item][data-value="${action}"]`)
        ).not.toBeInTheDocument();
      }
      if (!isMultipleSelected) {
        expect(
          screen.getByText('sdk:expandRecord.recordHistory.showRecordHistory')
        ).toBeInTheDocument();
      }
      await userEvent.click(screen.getByText('table:menu.copy'));
      expect(copySelection).toHaveBeenCalledTimes(1);
      expect(mocks.closeRecordMenu).toHaveBeenCalledTimes(1);
      for (const mutation of [insertRecord, duplicateRecord, deleteRecords, archiveRecords]) {
        expect(mutation).not.toHaveBeenCalled();
      }
    }
  );

  it.each([false, true])(
    'retains ordinary table row actions (multiple rows: %s)',
    (isMultipleSelected) => {
      mocks.recordMenu = {
        position: { x: 0, y: 0 },
        record: { id: 'recOrdinary', undeletable: false },
        isMultipleSelected,
        copySelection: vi.fn(),
        insertRecord: vi.fn(),
        duplicateRecord: vi.fn(),
        deleteRecords: vi.fn(),
        archiveRecords: vi.fn(),
      };

      renderMenu();

      expect(screen.getByText('table:menu.copy')).toBeInTheDocument();
      expect(
        screen.getByText(
          isMultipleSelected ? 'table:menu.duplicateRecords' : 'sdk:expandRecord.duplicateRecord'
        )
      ).toBeInTheDocument();
      expect(
        screen.getByText(
          isMultipleSelected ? 'table:menu.deleteAllSelectedRecords' : 'table:menu.deleteRecord'
        )
      ).toBeInTheDocument();
      expect(
        screen.getByText(
          isMultipleSelected ? 'table:menu.archiveAllSelectedRecords' : 'table:menu.archiveRecord'
        )
      ).toBeInTheDocument();
      if (!isMultipleSelected) {
        expect(
          document.querySelector('[cmdk-item][data-value="table:menu.insertRecordAbove"]')
        ).toBeInTheDocument();
        expect(
          document.querySelector('[cmdk-item][data-value="table:menu.insertRecordBelow"]')
        ).toBeInTheDocument();
      }
    }
  );
});
